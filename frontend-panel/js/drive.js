/**
 * drive.js — OneDrive file browser
 * Single module: API, navigation, rendering, actions.
 */

var Drive = window.Drive || (window.Drive = {});

/* ═══ Helpers ══════════════════════════════════════════════════════════════ */
Drive.util = (() => {
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function $(id) { return document.getElementById(id); }
    function formatDate(dt) {
        if (!dt) return '';
        const d = new Date(dt), now = new Date();
        if (d.toDateString() === now.toDateString())
            return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (d.getFullYear() === now.getFullYear())
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function formatSize(bytes) {
        if (bytes == null) return '';
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
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

    /* SVG-based file icons matching OneDrive */
    function fileIcon(item) {
        if (item.folder) return {
            svg: `<svg class="folder-svg" viewBox="0 0 32 32" fill="#f0c040"><path d="M2 6a2 2 0 012-2h8l3 3h13a2 2 0 012 2v17a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>`,
            color: '#f0c040'
        };
        const name = (item.name || '').toLowerCase();
        const ext = name.split('.').pop();
        const types = {
            doc: { letter: 'W', bg: '#185abd' },
            docx: { letter: 'W', bg: '#185abd' },
            xls: { letter: 'X', bg: '#107c10' },
            xlsx: { letter: 'X', bg: '#107c10' },
            csv: { letter: 'X', bg: '#107c10' },
            ppt: { letter: 'P', bg: '#c43e1c' },
            pptx: { letter: 'P', bg: '#c43e1c' },
            pdf: { letter: 'PDF', bg: '#d13438' },
            odt: { letter: 'W', bg: '#185abd' },
            ods: { letter: 'X', bg: '#107c10' },
            odp: { letter: 'P', bg: '#c43e1c' },
            one: { letter: 'N', bg: '#7719aa' },
        };
        const t = types[ext];
        if (t) {
            const fs = t.letter.length > 1 ? '10' : '14';
            return {
                svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><rect x="4" y="2" width="12" height="28" rx="2" fill="${t.bg}"/><text x="10" y="20" font-family="Segoe UI,sans-serif" font-size="${fs}" font-weight="700" fill="#fff" text-anchor="middle">${t.letter}</text></svg>`,
                color: t.bg
            };
        }
        const img = { jpg: 1, jpeg: 1, png: 1, gif: 1, bmp: 1, svg: 1, webp: 1, ico: 1, tiff: 1 };
        if (img[ext]) return {
            svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><circle cx="13" cy="12" r="3" fill="#0078d4"/><path d="M4 22l7-6 4 3 5-4 8 6v5a2 2 0 01-2 2H6a2 2 0 01-2-2z" fill="#0078d4" opacity=".3"/></svg>`,
            color: '#0078d4'
        };
        const vid = { mp4: 1, mov: 1, avi: 1, mkv: 1, wmv: 1, flv: 1, webm: 1 };
        if (vid[ext]) return {
            svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><polygon points="13,11 13,23 23,17" fill="#d13438"/></svg>`,
            color: '#d13438'
        };
        const aud = { mp3: 1, wav: 1, flac: 1, ogg: 1, m4a: 1, aac: 1, wma: 1 };
        if (aud[ext]) return {
            svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><path d="M12 22v-8l8-3v8" fill="none" stroke="#7719aa" stroke-width="1.5"/><circle cx="12" cy="22" r="2" fill="#7719aa"/><circle cx="20" cy="19" r="2" fill="#7719aa"/></svg>`,
            color: '#7719aa'
        };
        const zip = { zip: 1, rar: 1, '7z': 1, tar: 1, gz: 1, bz2: 1 };
        if (zip[ext]) return {
            svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><rect x="13" y="5" width="6" height="3" rx="1" fill="#8a8886"/><rect x="13" y="10" width="6" height="3" rx="1" fill="#8a8886"/><rect x="13" y="15" width="6" height="3" rx="1" fill="#8a8886"/><rect x="13" y="20" width="6" height="5" rx="1" fill="#8a8886"/></svg>`,
            color: '#8a8886'
        };
        const code = { js: 1, ts: 1, py: 1, html: 1, css: 1, json: 1, xml: 1, md: 1, yml: 1, yaml: 1, sh: 1, rb: 1, go: 1, rs: 1, java: 1, c: 1, cpp: 1, h: 1 };
        if (code[ext]) return {
            svg: `<svg viewBox="0 0 32 32"><rect x="4" y="2" width="24" height="28" rx="2" fill="#fff" stroke="#e1dfdd"/><path d="M12 12l-4 5 4 5M20 12l4 5-4 5" fill="none" stroke="#0078d4" stroke-width="1.5" stroke-linecap="round"/></svg>`,
            color: '#0078d4'
        };
        // default generic file
        return {
            svg: `<svg viewBox="0 0 32 32"><path d="M6 2h14l6 6v20a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="#fff" stroke="#e1dfdd"/><path d="M20 2v6h6" fill="#e1dfdd"/></svg>`,
            color: '#605e5c'
        };
    }
    return { esc, $, formatDate, formatSize, showToast, fileIcon };
})();

/* ═══ API ══════════════════════════════════════════════════════════════════ */
Drive.api = (() => {
    function getToken() { return localStorage.getItem('nexcp_token') || ''; }
    function setToken(t) { localStorage.setItem('nexcp_token', t); }

    async function call(method, path, body) {
        const opts = {
            method,
            headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
        };
        if (body) opts.body = JSON.stringify(body);
        try {
            const res = await fetch(path, opts);
            if (res.status === 401) { Drive.init.showLogin(); return null; }
            return await res.json();
        } catch (e) {
            console.error(`[Drive API] ${method} ${path}:`, e);
            return { error: e.message };
        }
    }

    const get = (p) => call('GET', p);
    const post = (p, b) => call('POST', p, b);
    const del = (p) => call('DELETE', p);
    const patch = (p, b) => call('PATCH', p, b);

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
        getRootItems: (top = 200) => get(`/api/drive/root?top=${top}`),
        getFolderItems: (id, top = 200) => get(`/api/drive/folder/${encodeURIComponent(id)}?top=${top}`),
        getItem: (id) => get(`/api/drive/item/${encodeURIComponent(id)}`),
        getDownloadUrl: (id) => get(`/api/drive/download/${encodeURIComponent(id)}`),
        searchFiles: (q) => get(`/api/drive/search?q=${encodeURIComponent(q)}`),
        deleteItem: (id) => del(`/api/drive/item/${encodeURIComponent(id)}`),
        createFolder: (name, parentId) => post('/api/drive/folder', { name, parentId }),
        renameItem: (id, name) => patch(`/api/drive/item/${encodeURIComponent(id)}`, { name }),
        moveItem: (id, parentId) => patch(`/api/drive/item/${encodeURIComponent(id)}`, { parentId }),
        getQuota: () => get('/api/drive/quota'),
    };
})();

/* ═══ Navigation ═══════════════════════════════════════════════════════════ */
Drive.nav = (() => {
    let crumbs = [{ id: null, name: 'My files' }];
    let items = [];
    let selectedId = null;

    async function goRoot() {
        crumbs = [{ id: null, name: 'My files' }];
        selectedId = null;
        _setSidebarActive('files');
        await _load();
    }

    async function openFolder(id, name) {
        crumbs.push({ id, name });
        selectedId = null;
        _setSidebarActive('files');
        await _load();
    }

    async function goToCrumb(idx) {
        crumbs = crumbs.slice(0, idx + 1);
        selectedId = null;
        await _load();
    }

    async function goRecent() {
        _setSidebarActive('recent');
        crumbs = [{ id: null, name: 'Recent' }];
        const list = Drive.util.$('file-list');
        list.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text2)">Recent files not available via Graph API basic scope.<br>Browse My files instead.</div>';
        _renderBreadcrumb();
    }

    async function refresh() {
        await _load();
    }

    async function search(q) {
        if (!q || !q.trim()) { await goRoot(); return; }
        crumbs = [{ id: null, name: 'My files' }, { id: null, name: `Search: "${q}"` }];
        const list = Drive.util.$('file-list');
        list.innerHTML = _spinner();
        _renderBreadcrumb();
        const data = await Drive.api.searchFiles(q.trim());
        items = data?.value || [];
        _renderItems();
    }

    async function _load() {
        const list = Drive.util.$('file-list');
        list.innerHTML = _spinner();
        _renderBreadcrumb();

        const current = crumbs[crumbs.length - 1];
        let data;
        if (current.id) {
            data = await Drive.api.getFolderItems(current.id);
        } else {
            data = await Drive.api.getRootItems();
        }

        if (!data || data.error) {
            list.innerHTML = `<div style="text-align:center;padding:60px;color:var(--red);font-size:13px">${Drive.util.esc(data?.error?.message || data?.error || 'Failed to load')}</div>`;
            return;
        }

        items = data.value || [];
        items.sort((a, b) => {
            if (a.folder && !b.folder) return -1;
            if (!a.folder && b.folder) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        _renderItems();
    }

    function _renderItems() {
        const list = Drive.util.$('file-list');
        if (!items.length) {
            list.innerHTML = `<div class="empty-state">
                <svg viewBox="0 0 80 80" fill="none"><rect x="10" y="5" width="60" height="70" rx="4" fill="#f3f2f1" stroke="#d2d0ce" stroke-width="2"/><path d="M30 35h20M30 45h14" stroke="#d2d0ce" stroke-width="2" stroke-linecap="round"/></svg>
                <div style="font-size:14px;font-weight:600">This folder is empty</div>
                <div style="font-size:12px">Drag and drop files here or use Add new</div>
            </div>`;
            return;
        }

        list.innerHTML = items.map((item, idx) => {
            const fi = Drive.util.fileIcon(item);
            const size = item.folder
                ? (item.folder.childCount != null ? item.folder.childCount + ' items' : '')
                : Drive.util.formatSize(item.size);
            const mod = Drive.util.formatDate(item.lastModifiedDateTime);
            const sharing = item.shared ? 'Shared' : 'Only you';
            const rawPath = item.parentReference?.path
                ? item.parentReference.path.replace('/drive/root:', '')
                : '';
            const path = rawPath && rawPath !== '/' ? rawPath : '';
            return `<div class="file-item" data-idx="${idx}" data-id="${Drive.util.esc(item.id)}">
                <div class="file-icon-wrap">${fi.svg}</div>
                <div class="col-name">
                    <span class="file-name">${Drive.util.esc(item.name)}</span>
                    ${path ? `<span class="file-path">${Drive.util.esc(path)}</span>` : ''}
                </div>
                <div class="col-modified">${mod}</div>
                <div class="col-sharing">${sharing}</div>
                <div class="col-size">${size}</div>
                <div class="col-actions"><button class="action-dot" data-ctx="${idx}" title="More">⋯</button></div>
            </div>`;
        }).join('');
    }

    function _renderBreadcrumb() {
        const bc = Drive.util.$('breadcrumb');
        bc.innerHTML = crumbs.map((c, i) => {
            if (i === crumbs.length - 1) return `<span class="bc-current">${Drive.util.esc(c.name)}</span>`;
            return `<span class="bc-item" onclick="Drive.nav.goToCrumb(${i})">${Drive.util.esc(c.name)}</span><span class="bc-sep">›</span>`;
        }).join('');
    }

    function _setSidebarActive(view) {
        document.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === view);
        });
    }

    function _spinner() {
        return '<div style="display:flex;align-items:center;justify-content:center;padding:60px"><div class="spinner"></div></div>';
    }

    function getItems() { return items; }
    function getByIndex(idx) { return items[idx]; }
    function getSelected() { return selectedId; }
    function setSelected(id) { selectedId = id; }

    return { goRoot, openFolder, goToCrumb, goRecent, refresh, search, getItems, getByIndex, getSelected, setSelected };
})();

/* ═══ Actions ══════════════════════════════════════════════════════════════ */
Drive.actions = (() => {
    let renameTargetId = null;

    async function downloadSelected() {
        const sel = _getSelectedItem();
        if (!sel) { Drive.util.showToast('Select a file first', 'red'); return; }
        if (sel.folder) { Drive.util.showToast('Cannot download folders', 'red'); return; }
        try {
            const data = await Drive.api.getDownloadUrl(sel.id);
            if (data?.downloadUrl) {
                const a = document.createElement('a');
                a.href = data.downloadUrl; a.download = data.name || sel.name;
                a.target = '_blank'; a.rel = 'noopener';
                document.body.appendChild(a); a.click(); a.remove();
                Drive.util.showToast('Download started');
            } else {
                Drive.util.showToast(data?.error || 'Download failed', 'red');
            }
        } catch (e) { Drive.util.showToast(e.message, 'red'); }
    }

    async function deleteSelected() {
        const sel = _getSelectedItem();
        if (!sel) { Drive.util.showToast('Select an item first', 'red'); return; }
        if (!confirm(`Delete "${sel.name}"?`)) return;
        const r = await Drive.api.deleteItem(sel.id);
        if (r?.ok) {
            Drive.util.showToast('Deleted');
            Drive.nav.setSelected(null);
            Drive.nav.refresh();
        } else {
            Drive.util.showToast(r?.error?.message || r?.error || 'Delete failed', 'red');
        }
    }

    function renameSelected() {
        const sel = _getSelectedItem();
        if (!sel) { Drive.util.showToast('Select an item first', 'red'); return; }
        _openRename(sel.id, sel.name);
    }

    async function newFolder() {
        const name = prompt('New folder name:');
        if (!name || !name.trim()) return;
        let parentId = null;
        const r = await Drive.api.createFolder(name.trim(), parentId);
        if (r?.id) {
            Drive.util.showToast('Folder created');
            Drive.nav.refresh();
        } else {
            Drive.util.showToast(r?.error?.message || r?.error || 'Failed to create folder', 'red');
        }
    }

    function _openRename(id, currentName) {
        renameTargetId = id;
        Drive.util.$('rename-input').value = currentName;
        Drive.util.$('rename-title').textContent = 'Rename "' + currentName + '"';
        Drive.util.$('rename-overlay').classList.remove('hidden');
        Drive.util.$('rename-input').focus();
        Drive.util.$('rename-input').select();
    }

    function closeRename() {
        Drive.util.$('rename-overlay').classList.add('hidden');
        renameTargetId = null;
    }

    async function submitRename() {
        if (!renameTargetId) return;
        const name = Drive.util.$('rename-input').value.trim();
        if (!name) return;
        const r = await Drive.api.renameItem(renameTargetId, name);
        if (r?.id) {
            Drive.util.showToast('Renamed');
            closeRename();
            Drive.nav.refresh();
        } else {
            Drive.util.showToast(r?.error?.message || r?.error || 'Rename failed', 'red');
        }
    }

    function showCtxMenu(idx, x, y) {
        const item = Drive.nav.getByIndex(idx);
        if (!item) return;
        const menu = Drive.util.$('ctx-menu');
        let html = '';

        if (item.folder) {
            html += `<div class="ctx-item" onclick="Drive.nav.openFolder('${Drive.util.esc(item.id)}','${Drive.util.esc(item.name)}');Drive.actions.hideCtxMenu()">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 3h5l2 2h7v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"/></svg> Open
            </div>`;
        } else {
            html += `<div class="ctx-item" onclick="Drive.actions._dlItem('${Drive.util.esc(item.id)}','${Drive.util.esc(item.name)}')">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg> Download
            </div>`;
            if (item.webUrl) {
                html += `<div class="ctx-item" onclick="window.open('${Drive.util.esc(item.webUrl)}','_blank');Drive.actions.hideCtxMenu()">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 10l4-4M10 6h-3M10 6v3M3 8v4a2 2 0 002 2h4"/></svg> Open in browser
                </div>`;
            }
        }
        html += `<div class="ctx-sep"></div>`;
        html += `<div class="ctx-item" onclick="Drive.actions._renameItem('${Drive.util.esc(item.id)}','${Drive.util.esc(item.name)}')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z"/></svg> Rename
        </div>`;
        html += `<div class="ctx-item danger" onclick="Drive.actions._delItem('${Drive.util.esc(item.id)}','${Drive.util.esc(item.name)}')">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M6 7v4M10 7v4M4 4l.7 8.8a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4"/></svg> Delete
        </div>`;

        menu.innerHTML = html;
        menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
        menu.classList.remove('hidden');
    }

    function hideCtxMenu() {
        Drive.util.$('ctx-menu').classList.add('hidden');
    }

    async function _dlItem(id, name) {
        hideCtxMenu();
        const data = await Drive.api.getDownloadUrl(id);
        if (data?.downloadUrl) {
            const a = document.createElement('a'); a.href = data.downloadUrl; a.download = name;
            a.target = '_blank'; a.rel = 'noopener';
            document.body.appendChild(a); a.click(); a.remove();
        } else {
            Drive.util.showToast('Download failed', 'red');
        }
    }

    function _renameItem(id, name) {
        hideCtxMenu();
        _openRename(id, name);
    }

    async function _delItem(id, name) {
        hideCtxMenu();
        if (!confirm(`Delete "${name}"?`)) return;
        const r = await Drive.api.deleteItem(id);
        if (r?.ok) { Drive.util.showToast('Deleted'); Drive.nav.refresh(); }
        else Drive.util.showToast('Delete failed', 'red');
    }

    function _getSelectedItem() {
        const sel = Drive.nav.getSelected();
        if (sel) {
            const items = Drive.nav.getItems();
            return items.find(i => i.id === sel);
        }
        const el = document.querySelector('.file-item.selected');
        if (el) {
            const idx = parseInt(el.dataset.idx);
            return Drive.nav.getByIndex(idx);
        }
        return null;
    }

    return { downloadSelected, deleteSelected, renameSelected, newFolder, closeRename, submitRename, showCtxMenu, hideCtxMenu, _dlItem, _renameItem, _delItem };
})();

/* ═══ Init ═════════════════════════════════════════════════════════════════ */
Drive.init = (() => {

    async function boot() {
        console.log('[Drive] Booting...');
        const token = Drive.api.getToken();
        if (!token) { showLogin(); return; }

        try {
            const me = await Drive.api.getMe();
            if (!me || me.error) { showLogin(); return; }
        } catch { showLogin(); return; }

        try {
            const ms = await Drive.api.getMsStatus();
            if (!ms || ms.status !== 'active') { showNoToken(); return; }
            const email = ms.ms_email || ms.ms_name || 'Linked';
            const avEl = Drive.util.$('topbar-avatar');
            if (avEl) { avEl.textContent = email.slice(0, 2).toUpperCase(); avEl.title = email; }
            const userEl = Drive.util.$('sidebar-user');
            if (userEl) userEl.textContent = email;
        } catch { showNoToken(); return; }

        showApp();

        try {
            await Promise.allSettled([
                Drive.nav.goRoot(),
                _loadQuota()
            ]);
        } catch (e) { console.error('[Drive] Load error:', e); }
    }

    async function _loadQuota() {
        const q = await Drive.api.getQuota();
        if (q && q.total) {
            const pct = Math.round((q.used / q.total) * 100);
            Drive.util.$('quota-fill').style.width = pct + '%';
            Drive.util.$('quota-text').textContent = `${Drive.util.formatSize(q.used)} of ${Drive.util.formatSize(q.total)} used`;
        }
    }

    function showLogin() {
        Drive.util.$('login-gate').classList.remove('hidden');
        Drive.util.$('login-gate').style.display = 'flex';
        Drive.util.$('drive-app').style.display = 'none';
        Drive.util.$('no-token').style.display = 'none';
    }

    function showNoToken() {
        Drive.util.$('no-token').classList.remove('hidden');
        Drive.util.$('no-token').style.display = 'flex';
        Drive.util.$('drive-app').style.display = 'none';
        Drive.util.$('login-gate').style.display = 'none';
    }

    function showApp() {
        Drive.util.$('drive-app').style.display = 'flex';
        Drive.util.$('login-gate').style.display = 'none';
        Drive.util.$('no-token').style.display = 'none';
    }

    async function gateLogin() {
        const user = Drive.util.$('gate-user').value.trim();
        const pass = Drive.util.$('gate-pass').value;
        const err = Drive.util.$('gate-err');
        err.style.display = 'none';
        if (!user || !pass) { err.textContent = 'Username and password required'; err.style.display = 'block'; return; }
        try {
            await Drive.api.login(user, pass);
            boot();
        } catch (e) {
            err.textContent = e.message; err.style.display = 'block';
        }
    }

    return { boot, showLogin, showNoToken, showApp, gateLogin };
})();

/* ═══ Event listeners ══════════════════════════════════════════════════════ */

document.addEventListener('click', (e) => {
    const ctxBtn = e.target.closest('.action-dot[data-ctx]');
    if (ctxBtn) {
        e.stopPropagation();
        const idx = parseInt(ctxBtn.dataset.ctx);
        const rect = ctxBtn.getBoundingClientRect();
        Drive.actions.showCtxMenu(idx, rect.right, rect.bottom);
        return;
    }

    Drive.actions.hideCtxMenu();

    const fileItem = e.target.closest('.file-item[data-idx]');
    if (fileItem) {
        const idx = parseInt(fileItem.dataset.idx);
        const item = Drive.nav.getByIndex(idx);
        if (!item) return;
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        fileItem.classList.add('selected');
        Drive.nav.setSelected(item.id);
        return;
    }
});

document.addEventListener('dblclick', (e) => {
    const fileItem = e.target.closest('.file-item[data-idx]');
    if (!fileItem) return;
    const idx = parseInt(fileItem.dataset.idx);
    const item = Drive.nav.getByIndex(idx);
    if (!item) return;

    if (item.folder) {
        Drive.nav.openFolder(item.id, item.name);
    } else {
        if (item.webUrl) {
            window.open(item.webUrl, '_blank');
        } else {
            Drive.actions._dlItem(item.id, item.name);
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.target.id === 'search-input' && e.key === 'Enter') {
        Drive.nav.search(e.target.value);
    }
    if (e.target.id === 'rename-input' && e.key === 'Enter') {
        Drive.actions.submitRename();
    }
    if (e.key === 'Escape') {
        Drive.actions.closeRename();
        Drive.actions.hideCtxMenu();
    }
});

document.addEventListener('DOMContentLoaded', () => Drive.init.boot());