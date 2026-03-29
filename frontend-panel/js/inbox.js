/**
 * inbox.js — NexCP Mail inbox/message list
 * Renders the email list panel, handles pagination, folder switching.
 * Uses data-idx for safe click handling (avoids ID encoding issues).
 */

var Mail = window.Mail || (window.Mail = {});

Mail.inbox = (() => {
  let messages = [];
  let page = 0;
  const PER = 25;
  let currentFolderId = null;
  let isSearchMode = false;

  async function loadInbox(skipTo) {
    currentFolderId = null;
    isSearchMode = false;
    if (skipTo !== undefined) page = skipTo; else page = 0;
    const label = Mail.ui.$('inbox-label');
    if (label) label.textContent = 'Inbox';
    await _fetchMessages();
  }

  async function loadFolder(folderId, skipTo) {
    currentFolderId = folderId;
    isSearchMode = false;
    if (skipTo !== undefined) page = skipTo; else page = 0;
    await _fetchMessages();
  }

  async function _fetchMessages() {
    const list = Mail.ui.$('inbox-list');
    if (list) list.innerHTML = Mail.ui.spinner();

    let data;
    try {
      if (currentFolderId) {
        data = await Mail.api.getFolderMessages(currentFolderId, PER, page * PER);
      } else {
        data = await Mail.api.getInbox(PER, page * PER);
      }
    } catch (e) {
      console.error('[Inbox] Fetch error:', e);
      if (list) list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);font-size:12px">Failed to load messages</div>';
      return;
    }

    if (!data) return;
    if (data.error) {
      if (list) list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red);font-size:12px">${Mail.ui.esc(data.error)}</div>`;
      return;
    }

    messages = data.value || [];
    render();
    _updatePagination();
  }

  async function search(q) {
    if (!q || !q.trim()) { loadInbox(0); return; }
    isSearchMode = true;
    const list = Mail.ui.$('inbox-list');
    if (list) list.innerHTML = Mail.ui.spinner();
    const label = Mail.ui.$('inbox-label');
    if (label) label.textContent = 'Search results';

    const data = await Mail.api.searchMail(q.trim());
    messages = data?.value || [];
    render();
    Mail.ui.$('prev-btn').disabled = true;
    Mail.ui.$('next-btn').disabled = true;
    Mail.ui.$('page-label').textContent = messages.length + ' found';
  }

  function render() {
    const list = Mail.ui.$('inbox-list');
    if (!list) return;

    const count = Mail.ui.$('inbox-count');
    if (count) {
      count.textContent = messages.length + ' messages';
      count.style.display = messages.length ? 'inline-flex' : 'none';
    }

    if (!messages.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2);font-size:13px">No messages</div>';
      return;
    }

    // Avatar color palette (Outlook-style)
    const _colors = ['#0078d4','#00838f','#7b1fa2','#d32f2f','#e65100','#2e7d32','#1565c0','#6a1b9a','#c62828','#ad1457','#00695c','#4527a0','#ef6c00','#283593','#558b2f'];
    function _avatarColor(s) { let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);return _colors[Math.abs(h)%_colors.length]; }
    function _initials(name) { const p=name.trim().split(/\s+/);if(p.length>=2)return(p[0][0]+p[p.length-1][0]).toUpperCase();return name.slice(0,2).toUpperCase(); }

    // Group messages by date
    function _dateLabel(d) {
      const today = new Date(); const dt = new Date(d);
      const diff = Math.floor((today.setHours(0,0,0,0) - new Date(dt).setHours(0,0,0,0)) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      return dt.toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' });
    }

    let lastGroup = '';
    // Use data-idx (array index) for click handling — avoids encoding issues with Graph IDs
    list.innerHTML = messages.map((m, idx) => {
      const from   = m.from?.emailAddress;
      const name   = from?.name || from?.address || 'Unknown';
      const date   = Mail.ui.formatDate(m.receivedDateTime);
      const unread = !m.isRead;
      const attach = m.hasAttachments ? '<span class="attach-icon" title="Has attachments">📎</span>' : '';
      const ini    = _initials(name);
      const bg     = _avatarColor(name);
      const group  = _dateLabel(m.receivedDateTime);
      let groupHdr = '';
      if (group !== lastGroup) { lastGroup = group; groupHdr = `<div class="date-group">${Mail.ui.esc(group)}</div>`; }

      return `${groupHdr}<div class="mail-item ${unread ? 'unread' : ''}" data-idx="${idx}">
        ${unread ? '<div class="unread-dot"></div>' : ''}
        <div class="mail-avatar" style="background:${bg}">${Mail.ui.esc(ini)}</div>
        <div class="mail-content">
          <div class="mail-from-row">
            <span class="mail-from">${unread ? '● ' : ''}${Mail.ui.esc(name)}</span>
            <span class="mail-date">${date}${attach}</span>
          </div>
          <div class="mail-subject">${Mail.ui.esc(m.subject || '(No subject)')}</div>
          <div class="mail-preview">${Mail.ui.esc(m.bodyPreview || '')}</div>
        </div>
      </div>`;
    }).join('');
  }

  function _updatePagination() {
    Mail.ui.$('page-label').textContent = 'Page ' + (page + 1);
    Mail.ui.$('prev-btn').disabled = page === 0;
    Mail.ui.$('next-btn').disabled = messages.length < PER;
  }

  function changePage(dir) {
    const newPage = Math.max(0, page + dir);
    if (currentFolderId) {
      loadFolder(currentFolderId, newPage);
    } else {
      loadInbox(newPage);
    }
  }

  function getMessages() { return messages; }
  function getByIndex(idx) { return messages[idx]; }
  function findById(id) { return messages.find(m => m.id === id); }

  function removeFromList(id) {
    messages = messages.filter(m => m.id !== id);
    render();
  }

  // Highlight a specific index
  function highlightIndex(idx) {
    document.querySelectorAll('.mail-item').forEach(el => el.classList.remove('active'));
    const item = document.querySelector(`.mail-item[data-idx="${idx}"]`);
    if (item) {
      item.classList.add('active');
      item.classList.remove('unread');
      const dot = item.querySelector('.unread-dot');
      if (dot) dot.remove();
    }
  }

  return { loadInbox, loadFolder, search, render, changePage, getMessages, getByIndex, findById, removeFromList, highlightIndex };
})();

// Event delegation for inbox clicks — safe, no inline onclick
document.addEventListener('click', (e) => {
  const item = e.target.closest('.mail-item[data-idx]');
  if (!item) return;
  const idx = parseInt(item.dataset.idx);
  const msg = Mail.inbox.getByIndex(idx);
  if (msg) {
    Mail.inbox.highlightIndex(idx);
    Mail.reader.open(msg.id);
  }
});
