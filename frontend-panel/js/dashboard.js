/**
 * dashboard.js — NexCP cyberpunk dashboard
 */

var Dashboard = window.Dashboard || (window.Dashboard = {});

/* ═══ Helpers ══════════════════════════════════════════════════════════════ */
Dashboard.util = (() => {
    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function $(id) { return document.getElementById(id); }
    function toast(msg, type) {
        const el = document.createElement('div');
        el.className = 'toast' + (type === 'red' ? ' red' : '');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3000);
    }
    return { esc, $, toast };
})();

/* ═══ Auth ═════════════════════════════════════════════════════════════════ */
Dashboard.auth = (() => {
    function getToken() { return localStorage.getItem('nexcp_token') || ''; }
    function setToken(t) { localStorage.setItem('nexcp_token', t); }

    async function login() {
        const btn = Dashboard.util.$('lbtn');
        const err = Dashboard.util.$('lerr');
        const u = Dashboard.util.$('lu').value.trim();
        const p = Dashboard.util.$('lp').value;
        err.style.display = 'none';
        btn.disabled = true; btn.textContent = 'Signing in...';
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Login failed');
            setToken(d.token);
            Dashboard.init.boot();
        } catch (e) {
            err.textContent = e.message;
            err.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sign in';
        }
    }

    async function call(method, path) {
        const headers = { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
        try {
            const res = await fetch(path, { method, headers });
            if (res.status === 401) {
                localStorage.removeItem('nexcp_token');
                location.reload();
                return null;
            }
            return await res.json();
        } catch (e) {
            console.error(`[Dashboard] ${method} ${path}:`, e);
            return null;
        }
    }

    return { getToken, setToken, login, call };
})();

/* ═══ State ════════════════════════════════════════════════════════════════ */
Dashboard.state = {
    stats: null,
    allTokens: [],
    uptimeBase: 0,
    uptimeTimer: null,
};

/* ═══ Tokens Table ═════════════════════════════════════════════════════════ */
Dashboard.tokens = (() => {
    let page = 1;

    function render() {
        const tokens = Dashboard.state.allTokens;
        const search = (Dashboard.util.$('tok-search')?.value || '').toLowerCase();
        const limit = parseInt(Dashboard.util.$('tok-limit')?.value || '10');

        let filtered = tokens;
        if (search) {
            filtered = tokens.filter(t =>
                (t.ms_email || '').toLowerCase().includes(search) ||
                (t.ms_name || '').toLowerCase().includes(search)
            );
        }

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        if (page > totalPages) page = totalPages;
        const start = (page - 1) * limit;
        const pageItems = filtered.slice(start, start + limit);

        const tbody = Dashboard.util.$('tok-body');
        if (!pageItems.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text2)">No tokens found</td></tr>`;
        } else {
            tbody.innerHTML = pageItems.map((t, i) => {
                const idx = start + i + 1;
                const email = Dashboard.util.esc(t.ms_email);
                const name = Dashboard.util.esc(t.ms_name || 'Unknown');
                const date = t.linked_at ? new Date(t.linked_at).toLocaleString('en-US', {
                    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit', second: '2-digit'
                }) : '—';

                return `<tr>
                    <td style="font-family:var(--mono);color:var(--text2)">${idx}</td>
                    <td><span class="tok-email">${email}</span></td>
                    <td class="tok-name">${name}</td>
                    <td>
                        <div class="tok-actions">
                            <a class="tok-btn" href="/mail" target="_blank">Open Outlook</a>
                            <a class="tok-btn" href="/drive" target="_blank">Open Onedrive</a>
                            <a class="tok-btn" href="/notes" target="_blank">Open OneNote</a>
                            <a class="tok-btn" href="/profile" target="_blank">Open Profile Info</a>
                        </div>
                    </td>
                    <td class="tok-browser">chrome</td>
                    <td class="tok-ip">—</td>
                    <td class="tok-country">🇺🇸</td>
                    <td class="tok-date">${date}</td>
                </tr>`;
            }).join('');
        }

        // Info
        const showStart = total ? start + 1 : 0;
        const showEnd = Math.min(start + limit, total);
        Dashboard.util.$('tok-info').textContent = `Showing ${showStart} to ${showEnd} of ${total} entries`;

        // Pagination
        const pagEl = Dashboard.util.$('tok-pag');
        let pagHtml = `<span class="pag-btn" onclick="Dashboard.tokens.setPage(${Math.max(1, page - 1)})">Previous</span>`;
        for (let i = 1; i <= totalPages; i++) {
            pagHtml += `<span class="pag-btn${i === page ? ' active' : ''}" onclick="Dashboard.tokens.setPage(${i})">${i}</span>`;
        }
        pagHtml += `<span class="pag-btn" onclick="Dashboard.tokens.setPage(${Math.min(totalPages, page + 1)})">Next</span>`;
        pagEl.innerHTML = pagHtml;
    }

    function setPage(p) {
        page = p;
        render();
    }

    return { render, setPage };
})();

/* ═══ Uptime ═══════════════════════════════════════════════════════════════ */
Dashboard.uptime = (() => {
    function start(seconds) {
        Dashboard.state.uptimeBase = seconds;
        if (Dashboard.state.uptimeTimer) clearInterval(Dashboard.state.uptimeTimer);
        Dashboard.state.uptimeTimer = setInterval(tick, 1000);
        tick();
    }

    function tick() {
        Dashboard.state.uptimeBase++;
        const s = Dashboard.state.uptimeBase;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        Dashboard.util.$('d-uptime').textContent =
            `${h} Hours & ${m} Minutes & ${sec} Seconds Has Passed`;
    }

    return { start };
})();

/* ═══ Dashboard Load ═══════════════════════════════════════════════════════ */
Dashboard.load = (() => {

    async function fetchStats() {
        const data = await Dashboard.auth.call('GET', '/api/dashboard/stats');
        if (!data) return;

        Dashboard.state.stats = data;
        Dashboard.state.allTokens = data.tokens || [];

        // Token count
        Dashboard.util.$('d-count').textContent = data.active_tokens || 0;

        // Latency
        const lat = data.latency_ms;
        if (lat >= 0) {
            Dashboard.util.$('d-latency').innerHTML =
                `${(lat / 1000).toFixed(3)}ms <span class="stat-dot yellow"></span>`;
        } else {
            Dashboard.util.$('d-latency').innerHTML =
                `offline <span class="stat-dot" style="background:var(--red)"></span>`;
        }

        // Status
        Dashboard.util.$('d-status').textContent = 'All Nodes Active';

        // Processing power (simulate from latency / token count)
        const power = Math.min(99.9, 85 + Math.random() * 14).toFixed(1);
        Dashboard.util.$('d-power').textContent = power + '%';
        Dashboard.util.$('d-power-bar').style.width = power + '%';

        // Uptime
        Dashboard.uptime.start(data.uptime_seconds || 0);

        // Link name
        const linkHost = location.hostname;
        Dashboard.util.$('d-link').textContent = linkHost === 'localhost' || linkHost === '127.0.0.1'
            ? 'welcome' : linkHost.split('.')[0];

        // Render tokens table
        Dashboard.tokens.render();
    }

    return { fetchStats };
})();

/* ═══ Init ═════════════════════════════════════════════════════════════════ */
Dashboard.init = (() => {

    async function boot() {
        const token = Dashboard.auth.getToken();
        if (!token) { showLogin(); return; }

        try {
            const me = await Dashboard.auth.call('GET', '/api/auth/me');
            if (!me || me.error) { showLogin(); return; }
        } catch { showLogin(); return; }

        showApp();
        Dashboard.load.fetchStats();
    }

    function showLogin() {
        Dashboard.util.$('login-screen').style.display = 'flex';
        Dashboard.util.$('app').style.display = 'none';
        Dashboard.util.$('app').classList.add('hidden');
        Dashboard.util.$('vis-icon').style.display = 'none';
        Dashboard.util.$('top-icons').style.display = 'none';
    }

    function showApp() {
        Dashboard.util.$('login-screen').style.display = 'none';
        Dashboard.util.$('app').style.display = 'flex';
        Dashboard.util.$('app').classList.remove('hidden');
        Dashboard.util.$('vis-icon').style.display = 'block';
        Dashboard.util.$('top-icons').style.display = 'flex';
    }

    return { boot, showLogin, showApp };
})();

/* ═══ Keyboard ═════════════════════════════════════════════════════════════ */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && Dashboard.util.$('login-screen').style.display === 'flex') {
        Dashboard.auth.login();
    }
});

/* ═══ Boot ═════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => Dashboard.init.boot());
