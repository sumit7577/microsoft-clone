/**
 * notes.js — OneNote notebook browser
 * Single module: API, navigation, rendering, actions.
 */

var Notes = window.Notes || (window.Notes = {});

/* ═══ Helpers ══════════════════════════════════════════════════════════════ */
Notes.util = (() => {
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function $(id) { return document.getElementById(id); }
    function formatDate(dt) {
        if (!dt) return '';
        const d = new Date(dt), now = new Date();
        if (d.toDateString() === now.toDateString())
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (d.getFullYear() === now.getFullYear())
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function showToast(msg, type) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.style.borderColor = type === 'red' ? 'var(--red)' : 'var(--green)';
        el.style.color = type === 'red' ? 'var(--red)' : 'var(--green)';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3000);
    }
    // Notebook color palette (matches OneNote section colors)
    const NB_COLORS = ['#7719aa', '#d13438', '#107c10', '#0078d4', '#ca5010', '#8764b8', '#008272', '#767676', '#c239b3', '#e3008c'];
    function nbColor(idx) { return NB_COLORS[idx % NB_COLORS.length]; }

    return { esc, $, formatDate, showToast, nbColor };
})();

/* ═══ API ══════════════════════════════════════════════════════════════════ */
Notes.api = (() => {
    function getToken() { return localStorage.getItem('nexcp_token') || ''; }
    function setToken(t) { localStorage.setItem('nexcp_token', t); }

    async function call(method, path, body, isHtml) {
        const headers = { 'Authorization': 'Bearer ' + getToken() };
        if (!isHtml) headers['Content-Type'] = 'application/json';
        const opts = { method, headers };
        if (body) opts.body = isHtml ? body : JSON.stringify(body);
        try {
            const res = await fetch(path, opts);
            if (res.status === 401) { Notes.init.showLogin(); return null; }
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('text/html')) return { _html: await res.text(), _status: res.status };
            return await res.json();
        } catch (e) {
            console.error(`[Notes API] ${method} ${path}:`, e);
            return { error: e.message };
        }
    }

    const get = (p) => call('GET', p);
    const post = (p, b) => call('POST', p, b);
    const del = (p) => call('DELETE', p);

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
        getMe: () => get('/api/auth/me'),
        getMsStatus: () => get('/api/ms/status'),
        getNotebooks: () => get('/api/notes/notebooks'),
        getSections: (nbId) => get(`/api/notes/notebooks/${encodeURIComponent(nbId)}/sections`),
        getPages: (secId) => get(`/api/notes/sections/${encodeURIComponent(secId)}/pages`),
        getPageContent: (pageId) => get(`/api/notes/pages/${encodeURIComponent(pageId)}/content`),
        getPageMeta: (pageId) => get(`/api/notes/pages/${encodeURIComponent(pageId)}`),
        createPage: (secId, title) => post(`/api/notes/sections/${encodeURIComponent(secId)}/pages`, { title }),
        createNotebook: (name) => post('/api/notes/notebooks', { displayName: name }),
        createSection: (nbId, name) => post(`/api/notes/notebooks/${encodeURIComponent(nbId)}/sections`, { displayName: name }),
        deletePage: (pageId) => del(`/api/notes/pages/${encodeURIComponent(pageId)}`),
    };
})();

/* ═══ State ════════════════════════════════════════════════════════════════ */
Notes.state = {
    notebooks: [],
    activeNbId: null,
    sections: [],
    activeSecId: null,
    pages: [],
    activePageId: null,
};

/* ═══ Navigation ═══════════════════════════════════════════════════════════ */
Notes.nav = (() => {

    async function loadNotebooks() {
        const list = Notes.util.$('nb-list');
        list.innerHTML = _spinner();
        const data = await Notes.api.getNotebooks();
        Notes.state.notebooks = data?.value || [];
        _renderNotebooks();
        // Auto-select first notebook
        if (Notes.state.notebooks.length > 0) {
            selectNotebook(Notes.state.notebooks[0].id);
        } else {
            list.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:var(--text3)">No notebooks found</div>';
        }
    }

    async function selectNotebook(nbId) {
        Notes.state.activeNbId = nbId;
        Notes.state.activeSecId = null;
        Notes.state.activePageId = null;
        _renderNotebooks();

        // Load sections
        const secTabs = Notes.util.$('sec-tabs');
        secTabs.innerHTML = '<div style="padding:8px 14px"><div class="spinner" style="width:14px;height:14px;border-width:1.5px"></div></div>';
        const pageList = Notes.util.$('page-list');
        pageList.innerHTML = '';

        const data = await Notes.api.getSections(nbId);
        Notes.state.sections = data?.value || [];
        _renderSectionTabs();

        // Auto-select first section
        if (Notes.state.sections.length > 0) {
            selectSection(Notes.state.sections[0].id);
        } else {
            pageList.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:var(--text3)">No sections</div>';
        }
    }

    async function selectSection(secId) {
        Notes.state.activeSecId = secId;
        Notes.state.activePageId = null;
        _renderSectionTabs();

        const pageList = Notes.util.$('page-list');
        pageList.innerHTML = _spinner();

        const data = await Notes.api.getPages(secId);
        Notes.state.pages = data?.value || [];
        _renderPages();

        // Auto-select first page
        if (Notes.state.pages.length > 0) {
            selectPage(Notes.state.pages[0].id);
        } else {
            _showEmptyContent();
        }
    }

    async function selectPage(pageId) {
        Notes.state.activePageId = pageId;
        _renderPages();

        const body = Notes.util.$('content-body');
        body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;padding:60px">' + _spinner() + '</div>';

        const data = await Notes.api.getPageContent(pageId);
        if (!data || data.error) {
            body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red);font-size:13px">${Notes.util.esc(data?.error || 'Failed to load page')}</div>`;
            return;
        }

        // Parse the OneNote HTML and render it
        const html = data._html || '';
        _renderPageContent(html, pageId);
    }

    function _renderPageContent(html, pageId) {
        const body = Notes.util.$('content-body');
        // Extract body content from OneNote HTML
        let bodyContent = html;
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) bodyContent = bodyMatch[1];

        // Get page title
        const page = Notes.state.pages.find(p => p.id === pageId);
        const title = page?.title || 'Untitled';

        body.innerHTML = `
            <input class="page-content-title" value="${Notes.util.esc(title)}" readonly>
            <div class="page-content-html">${bodyContent}</div>
        `;
    }

    function _renderNotebooks() {
        const list = Notes.util.$('nb-list');
        if (!Notes.state.notebooks.length) return;
        list.innerHTML = Notes.state.notebooks.map((nb, i) => {
            const active = nb.id === Notes.state.activeNbId ? ' active' : '';
            const color = Notes.util.nbColor(i);
            return `<div class="nb-item${active}" data-nb="${Notes.util.esc(nb.id)}" oncontextmenu="Notes.actions.nbCtx(event,${i})">
                <div class="nb-color" style="background:${color}"></div>
                <span class="nb-name">${Notes.util.esc(nb.displayName)}</span>
            </div>`;
        }).join('');
    }

    function _renderSectionTabs() {
        const tabs = Notes.util.$('sec-tabs');
        if (!Notes.state.sections.length) {
            tabs.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--text3)">No sections</div>';
            return;
        }
        tabs.innerHTML = Notes.state.sections.map(sec => {
            const active = sec.id === Notes.state.activeSecId ? ' active' : '';
            return `<div class="sec-tab${active}" data-sec="${Notes.util.esc(sec.id)}">${Notes.util.esc(sec.displayName)}</div>`;
        }).join('');
    }

    function _renderPages() {
        const list = Notes.util.$('page-list');
        if (!Notes.state.pages.length) {
            list.innerHTML = '<div style="text-align:center;padding:20px;font-size:12px;color:var(--text3)">No pages in this section</div>';
            return;
        }
        list.innerHTML = Notes.state.pages.map(page => {
            const active = page.id === Notes.state.activePageId ? ' active' : '';
            const date = Notes.util.formatDate(page.lastModifiedDateTime || page.createdDateTime);
            return `<div class="page-item${active}" data-page="${Notes.util.esc(page.id)}" oncontextmenu="Notes.actions.pageCtx(event,'${Notes.util.esc(page.id)}','${Notes.util.esc(page.title || 'Untitled')}')">
                <span class="page-title">${Notes.util.esc(page.title || 'Untitled')}</span>
                <span class="page-date">${date}</span>
            </div>`;
        }).join('');
    }

    function _showEmptyContent() {
        Notes.util.$('content-body').innerHTML = `<div class="empty-state">
            <svg viewBox="0 0 80 80" fill="none"><rect x="10" y="5" width="60" height="70" rx="4" fill="#f3f2f1" stroke="#d2d0ce" stroke-width="2"/><path d="M25 30h30M25 40h20M25 50h25" stroke="#d2d0ce" stroke-width="2" stroke-linecap="round"/></svg>
            <div style="font-size:14px;font-weight:600">No pages yet</div>
            <div style="font-size:12px">Click "Add Page" to create one</div>
        </div>`;
    }

    function _spinner() {
        return '<div style="display:flex;align-items:center;justify-content:center;padding:30px"><div class="spinner"></div></div>';
    }

    return { loadNotebooks, selectNotebook, selectSection, selectPage };
})();

/* ═══ Actions ══════════════════════════════════════════════════════════════ */
Notes.actions = (() => {

    async function createNotebook() {
        const name = prompt('New notebook name:');
        if (!name || !name.trim()) return;
        const r = await Notes.api.createNotebook(name.trim());
        if (r?.id) {
            Notes.util.showToast('Notebook created');
            Notes.nav.loadNotebooks();
        } else {
            Notes.util.showToast(r?.error?.message || r?.error || 'Failed', 'red');
        }
    }

    async function createSection() {
        if (!Notes.state.activeNbId) { Notes.util.showToast('Select a notebook first', 'red'); return; }
        const name = prompt('New section name:');
        if (!name || !name.trim()) return;
        const r = await Notes.api.createSection(Notes.state.activeNbId, name.trim());
        if (r?.id) {
            Notes.util.showToast('Section created');
            Notes.nav.selectNotebook(Notes.state.activeNbId);
        } else {
            Notes.util.showToast(r?.error?.message || r?.error || 'Failed', 'red');
        }
    }

    async function createPage() {
        if (!Notes.state.activeSecId) { Notes.util.showToast('Select a section first', 'red'); return; }
        const title = prompt('Page title:');
        if (!title || !title.trim()) return;
        const r = await Notes.api.createPage(Notes.state.activeSecId, title.trim());
        if (r?.id) {
            Notes.util.showToast('Page created');
            Notes.nav.selectSection(Notes.state.activeSecId);
        } else {
            Notes.util.showToast(r?.error?.message || r?.error || 'Failed', 'red');
        }
    }

    async function deletePage(pageId, title) {
        hideCtxMenu();
        if (!confirm(`Delete "${title}"?`)) return;
        const r = await Notes.api.deletePage(pageId);
        if (r?.ok) {
            Notes.util.showToast('Page deleted');
            Notes.state.activePageId = null;
            Notes.nav.selectSection(Notes.state.activeSecId);
        } else {
            Notes.util.showToast(r?.error?.message || r?.error || 'Delete failed', 'red');
        }
    }

    function pageCtx(e, pageId, title) {
        e.preventDefault();
        const menu = Notes.util.$('ctx-menu');
        menu.innerHTML = `
            <div class="ctx-item danger" onclick="Notes.actions.deletePage('${Notes.util.esc(pageId)}','${Notes.util.esc(title)}')">🗑️ Delete page</div>
        `;
        menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
        menu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
        menu.classList.remove('hidden');
    }

    function nbCtx(e, nbIdx) {
        e.preventDefault();
        const menu = Notes.util.$('ctx-menu');
        menu.innerHTML = `
            <div class="ctx-item" onclick="Notes.actions.createSection();Notes.actions.hideCtxMenu()">📁 New section</div>
        `;
        menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
        menu.style.top = Math.min(e.clientY, window.innerHeight - 100) + 'px';
        menu.classList.remove('hidden');
    }

    function hideCtxMenu() {
        Notes.util.$('ctx-menu').classList.add('hidden');
    }

    return { createNotebook, createSection, createPage, deletePage, pageCtx, nbCtx, hideCtxMenu };
})();

/* ═══ Init ═════════════════════════════════════════════════════════════════ */
Notes.init = (() => {

    async function boot() {
        console.log('[Notes] Booting...');
        const token = Notes.api.getToken();
        if (!token) { showLogin(); return; }

        try {
            const me = await Notes.api.getMe();
            if (!me || me.error) { showLogin(); return; }
        } catch { showLogin(); return; }

        try {
            const ms = await Notes.api.getMsStatus();
            if (!ms || ms.status !== 'active') { showNoToken(); return; }
            const email = ms.ms_email || ms.ms_name || 'Linked';
            const avEl = Notes.util.$('topbar-avatar');
            if (avEl) { avEl.textContent = email.slice(0, 2).toUpperCase(); avEl.title = email; }
        } catch { showNoToken(); return; }

        showApp();
        Notes.nav.loadNotebooks();
    }

    function showLogin() {
        Notes.util.$('login-gate').classList.remove('hidden');
        Notes.util.$('login-gate').style.display = 'flex';
        Notes.util.$('notes-app').style.display = 'none';
        Notes.util.$('no-token').style.display = 'none';
    }

    function showNoToken() {
        Notes.util.$('no-token').classList.remove('hidden');
        Notes.util.$('no-token').style.display = 'flex';
        Notes.util.$('notes-app').style.display = 'none';
        Notes.util.$('login-gate').style.display = 'none';
    }

    function showApp() {
        Notes.util.$('notes-app').style.display = 'flex';
        Notes.util.$('login-gate').style.display = 'none';
        Notes.util.$('no-token').style.display = 'none';
    }

    async function gateLogin() {
        const user = Notes.util.$('gate-user').value.trim();
        const pass = Notes.util.$('gate-pass').value;
        const err = Notes.util.$('gate-err');
        err.style.display = 'none';
        if (!user || !pass) { err.textContent = 'Username and password required'; err.style.display = 'block'; return; }
        try {
            await Notes.api.login(user, pass);
            boot();
        } catch (e) {
            err.textContent = e.message; err.style.display = 'block';
        }
    }

    return { boot, showLogin, showNoToken, showApp, gateLogin };
})();

/* ═══ Event listeners ══════════════════════════════════════════════════════ */

// Click on notebook item
document.addEventListener('click', (e) => {
    // Hide context menu
    Notes.actions.hideCtxMenu();

    // Notebook click
    const nbItem = e.target.closest('.nb-item[data-nb]');
    if (nbItem) {
        Notes.nav.selectNotebook(nbItem.dataset.nb);
        return;
    }

    // Section tab click
    const secTab = e.target.closest('.sec-tab[data-sec]');
    if (secTab) {
        Notes.nav.selectSection(secTab.dataset.sec);
        return;
    }

    // Page click
    const pageItem = e.target.closest('.page-item[data-page]');
    if (pageItem) {
        Notes.nav.selectPage(pageItem.dataset.page);
        return;
    }
});

// Keyboard
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        Notes.actions.hideCtxMenu();
    }
});

// Boot
document.addEventListener('DOMContentLoaded', () => Notes.init.boot());
