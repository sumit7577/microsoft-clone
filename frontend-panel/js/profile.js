/**
 * profile.js — Microsoft Account profile page
 */

var Profile = window.Profile || (window.Profile = {});

/* ═══ Helpers ══════════════════════════════════════════════════════════════ */
Profile.util = (() => {
    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function $(id) { return document.getElementById(id); }
    function formatDate(dt) {
        if (!dt) return '—';
        const d = new Date(dt);
        return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
    }
    function initials(name) {
        if (!name) return '?';
        return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }
    return { esc, $, formatDate, initials };
})();

/* ═══ API ══════════════════════════════════════════════════════════════════ */
Profile.api = (() => {
    function getToken() { return localStorage.getItem('nexcp_token') || ''; }
    function setToken(t) { localStorage.setItem('nexcp_token', t); }

    async function call(method, path) {
        const headers = { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
        try {
            const res = await fetch(path, { method, headers });
            if (res.status === 401) { Profile.init.showLogin(); return null; }
            return await res.json();
        } catch (e) {
            console.error(`[Profile API] ${method} ${path}:`, e);
            return { error: e.message };
        }
    }

    return {
        getToken, setToken,
        login: async (u, p) => {
            const res = await fetch('/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Login failed');
            setToken(d.token); return d;
        },
        getMe: () => call('GET', '/api/auth/me'),
        getMsStatus: () => call('GET', '/api/ms/status'),
        getProfile: () => call('GET', '/api/profile/me'),
        getOrganization: () => call('GET', '/api/profile/organization'),
        getDevices: () => call('GET', '/api/profile/devices'),
        getGroups: () => call('GET', '/api/profile/groups'),
        getPhoto: () => call('GET', '/api/profile/photo'),
        getActivity: () => call('GET', '/api/profile/activity'),
    };
})();

/* ═══ State ════════════════════════════════════════════════════════════════ */
Profile.state = {
    profile: null,
    activeView: 'overview',
    sidebarOpen: true,
};

/* ═══ Navigation ═══════════════════════════════════════════════════════════ */
Profile.nav = (() => {

    function show(view) {
        Profile.state.activeView = view;

        // Update sidebar active states
        document.querySelectorAll('.side-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === view);
        });

        // Show/hide detail sections
        document.querySelectorAll('.detail-section').forEach(el => {
            el.classList.toggle('active', el.id === 'view-' + view);
        });

        // Lazy-load data for sections
        if (view === 'devices') loadDevices();
        if (view === 'organizations') loadOrganizations();
        if (view === 'activity') loadActivity();
    }

    async function loadProfile() {
        const $ = Profile.util.$;
        const data = await Profile.api.getProfile();
        if (!data || data.error) return;

        Profile.state.profile = data;
        const name = data.displayName || 'User';
        const email = data.mail || data.userPrincipalName || '';
        const ini = Profile.util.initials(name);

        // Topbar avatar
        $('topbar-avatar').textContent = ini;
        $('topbar-avatar').title = email;

        // Sidebar
        $('side-avatar').textContent = ini;
        $('side-name').textContent = name;
        $('side-email').textContent = email;

        // Welcome heading
        $('welcome-heading').textContent = 'Welcome back, ' + name;

        // Profile card
        $('profile-avatar').textContent = ini;
        $('profile-name').textContent = name;
        $('profile-email').textContent = email;

        // Security info
        $('sec-status').textContent = data.accountEnabled === false ? 'Disabled' : 'Active';
        $('sec-created').textContent = Profile.util.formatDate(data.createdDateTime);
        $('sec-upn').textContent = data.userPrincipalName || '—';

        // Settings & Privacy
        $('priv-display').textContent = data.displayName || '—';
        $('priv-job').textContent = data.jobTitle || '—';
        $('priv-dept').textContent = data.department || '—';
        $('priv-office').textContent = data.officeLocation || '—';
        $('priv-phone').textContent = data.mobilePhone || (data.businessPhones && data.businessPhones[0]) || '—';
        $('priv-city').textContent = [data.city, data.state].filter(Boolean).join(', ') || '—';
        $('priv-country').textContent = data.country || '—';
        $('priv-company').textContent = data.companyName || '—';

        // Try loading photo
        const photo = await Profile.api.getPhoto();
        if (photo && photo.hasPhoto) {
            $('profile-avatar').innerHTML = `<img src="${Profile.util.esc(photo.data)}" alt="Profile photo">`;
        }
    }

    async function loadDevices() {
        const container = Profile.util.$('devices-content');
        if (container.dataset.loaded) return;
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px"><div class="spinner"></div></div>';

        const data = await Profile.api.getDevices();
        container.dataset.loaded = '1';
        const devices = data?.value || [];

        if (!devices.length) {
            container.innerHTML = '<div class="detail-empty">No devices found connected to this account.</div>';
            return;
        }

        container.innerHTML = `<table class="detail-table">
            <thead><tr><th>Device</th><th>OS</th><th>Trust Type</th><th>Last Sign-in</th></tr></thead>
            <tbody>${devices.map(d => `<tr>
                <td>${Profile.util.esc(d.displayName || 'Unknown')}</td>
                <td>${Profile.util.esc((d.operatingSystem || '') + ' ' + (d.operatingSystemVersion || ''))}</td>
                <td>${Profile.util.esc(d.trustType || '—')}</td>
                <td>${Profile.util.formatDate(d.approximateLastSignInDateTime)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }

    async function loadOrganizations() {
        const container = Profile.util.$('org-content');
        if (container.dataset.loaded) return;
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px"><div class="spinner"></div></div>';

        const data = await Profile.api.getOrganization();
        container.dataset.loaded = '1';
        const orgs = data?.value || [];

        if (!orgs.length) {
            container.innerHTML = '<div class="detail-empty">No organization information available.</div>';
            return;
        }

        container.innerHTML = orgs.map(org => `
            <div style="padding:12px 0;border-bottom:1px solid var(--border)">
                <div class="detail-row"><div class="detail-label">Name</div><div class="detail-value">${Profile.util.esc(org.displayName)}</div></div>
                ${org.verifiedDomains ? org.verifiedDomains.map(d => `<div class="detail-row"><div class="detail-label">Domain</div><div class="detail-value">${Profile.util.esc(d.name)}${d.isDefault ? ' (default)' : ''}</div></div>`).join('') : ''}
                ${org.city ? `<div class="detail-row"><div class="detail-label">Location</div><div class="detail-value">${Profile.util.esc([org.city, org.state, org.country].filter(Boolean).join(', '))}</div></div>` : ''}
            </div>
        `).join('');
    }

    async function loadActivity() {
        const container = Profile.util.$('activity-content');
        if (container.dataset.loaded) return;
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:40px"><div class="spinner"></div></div>';

        const data = await Profile.api.getActivity();
        container.dataset.loaded = '1';
        const items = data?.value || [];

        if (!items.length) {
            container.innerHTML = '<div class="detail-empty">No recent activity found.</div>';
            return;
        }

        container.innerHTML = `<table class="detail-table">
            <thead><tr><th>Activity</th><th>App</th><th>Date</th></tr></thead>
            <tbody>${items.map(a => `<tr>
                <td>${Profile.util.esc(a.visualElements?.displayText || a.activitySourceHost || '—')}</td>
                <td>${Profile.util.esc(a.visualElements?.attribution?.alternateText || a.appActivityId || '—')}</td>
                <td>${Profile.util.formatDate(a.lastModifiedDateTime || a.createdDateTime)}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    }

    async function loadGroups() {
        const container = Profile.util.$('groups-list');
        const data = await Profile.api.getGroups();
        const groups = (data?.value || []).filter(g => g['@odata.type'] === '#microsoft.graph.group');

        if (!groups.length) {
            container.innerHTML = '<div style="padding:8px 48px;font-size:12px;color:var(--text3)">No groups</div>';
            return;
        }

        container.innerHTML = groups.map(g =>
            `<div class="side-item" style="font-size:12px">${Profile.util.esc(g.displayName)}</div>`
        ).join('');
    }

    return { show, loadProfile, loadDevices, loadOrganizations, loadActivity, loadGroups };
})();

/* ═══ Actions ══════════════════════════════════════════════════════════════ */
Profile.actions = (() => {

    function toggleSection(name) {
        const items = Profile.util.$('items-' + name);
        const chev = Profile.util.$('chev-' + name);
        items.classList.toggle('hidden');
        chev.classList.toggle('collapsed');
    }

    function toggleSidebar() {
        const sidebar = Profile.util.$('sidebar');
        Profile.state.sidebarOpen = !Profile.state.sidebarOpen;
        sidebar.style.display = Profile.state.sidebarOpen ? '' : 'none';
    }

    return { toggleSection, toggleSidebar };
})();

/* ═══ Init ═════════════════════════════════════════════════════════════════ */
Profile.init = (() => {

    async function boot() {
        console.log('[Profile] Booting...');
        const token = Profile.api.getToken();
        if (!token) { showLogin(); return; }

        try {
            const me = await Profile.api.getMe();
            if (!me || me.error) { showLogin(); return; }
        } catch { showLogin(); return; }

        try {
            const ms = await Profile.api.getMsStatus();
            if (!ms || ms.status !== 'active') { showNoToken(); return; }
        } catch { showNoToken(); return; }

        showApp();
        Profile.nav.loadProfile();
        Profile.nav.loadGroups();
    }

    function showLogin() {
        Profile.util.$('login-gate').classList.remove('hidden');
        Profile.util.$('login-gate').style.display = 'flex';
        Profile.util.$('profile-app').style.display = 'none';
        Profile.util.$('no-token').style.display = 'none';
    }

    function showNoToken() {
        Profile.util.$('no-token').classList.remove('hidden');
        Profile.util.$('no-token').style.display = 'flex';
        Profile.util.$('profile-app').style.display = 'none';
        Profile.util.$('login-gate').style.display = 'none';
    }

    function showApp() {
        Profile.util.$('profile-app').style.display = 'flex';
        Profile.util.$('login-gate').style.display = 'none';
        Profile.util.$('no-token').style.display = 'none';
    }

    async function gateLogin() {
        const user = Profile.util.$('gate-user').value.trim();
        const pass = Profile.util.$('gate-pass').value;
        const err = Profile.util.$('gate-err');
        err.style.display = 'none';
        if (!user || !pass) { err.textContent = 'Username and password required'; err.style.display = 'block'; return; }
        try {
            await Profile.api.login(user, pass);
            boot();
        } catch (e) {
            err.textContent = e.message; err.style.display = 'block';
        }
    }

    return { boot, showLogin, showNoToken, showApp, gateLogin };
})();

/* ═══ Boot ═════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => Profile.init.boot());
