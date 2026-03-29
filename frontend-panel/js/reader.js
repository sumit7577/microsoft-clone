/**
 * reader.js — NexCP Mail message reader
 * Opens full message, renders body, handles delete/move/archive/read toggle.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.reader = (() => {
  let currentId  = null;
  let currentMsg = null;

  async function open(id) {
    currentId = id;
    console.log('[Reader] Opening message:', id);

    // Show read panel, hide empty state
    Mail.ui.$('empty-state').classList.add('hidden');
    const rc = Mail.ui.$('read-content');
    rc.classList.remove('hidden');
    rc.style.display = 'flex';
    Mail.ui.$('read-body-content').innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:var(--text2)"><div class="spinner"></div> Loading...</div>';

    // Fetch full message
    let msg;
    try {
      msg = await Mail.api.getMessage(id);
    } catch (e) {
      console.error('[Reader] Fetch error:', e);
      Mail.ui.$('read-body-content').innerHTML = '<div style="color:var(--red)">Failed to load message</div>';
      return;
    }

    if (!msg || msg.error) {
      console.error('[Reader] API error:', msg?.error);
      Mail.ui.$('read-body-content').innerHTML = `<div style="color:var(--red)">Failed to load: ${Mail.ui.esc(msg?.error || 'unknown')}</div>`;
      return;
    }
    currentMsg = msg;

    // Populate header
    Mail.ui.$('read-subject').textContent    = msg.subject || '(No subject)';
    Mail.ui.$('read-from-name').textContent  = msg.from?.emailAddress?.name || '';
    Mail.ui.$('read-from-email').textContent = msg.from?.emailAddress?.address || '';
    Mail.ui.$('read-to').textContent = (msg.toRecipients || []).map(r => r.emailAddress?.address).join(', ');

    const cc = (msg.ccRecipients || []).map(r => r.emailAddress?.address).join(', ');
    Mail.ui.$('read-cc').textContent = cc;
    Mail.ui.$('read-cc-row').style.display = cc ? 'block' : 'none';

    Mail.ui.$('read-date').textContent = msg.receivedDateTime ? new Date(msg.receivedDateTime).toLocaleString() : '';
    Mail.ui.$('attach-badge').style.display = msg.hasAttachments ? 'inline-flex' : 'none';

    // Update read/unread button
    _updateReadBtn();

    // Render body
    const body   = msg.body?.content || '';
    const bodyEl = Mail.ui.$('read-body-content');

    if (msg.body?.contentType === 'html') {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:100%;border:none;background:#fff;border-radius:6px;min-height:400px';
      iframe.sandbox = 'allow-same-origin';
      bodyEl.innerHTML = '';
      bodyEl.appendChild(iframe);
      iframe.onload = () => {
        try { iframe.style.height = iframe.contentDocument.body.scrollHeight + 20 + 'px'; } catch(e) {}
      };
      iframe.srcdoc = `<html><body style="font-family:sans-serif;font-size:13px;color:#1a1a1a;padding:12px;margin:0">${body}</body></html>`;
    } else {
      bodyEl.innerHTML = '<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px">' + Mail.ui.esc(body) + '</pre>';
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function deleteMsg() {
    if (!currentId) return;
    if (!Mail.ui.confirm('Move this message to Deleted Items?')) return;
    const r = await Mail.api.deleteMessage(currentId);
    if (r?.ok) {
      Mail.ui.showToast('Moved to Deleted Items');
      Mail.inbox.removeFromList(currentId);
      _clearReader();
    } else {
      Mail.ui.showToast('Delete failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  async function archiveMsg() {
    if (!currentId) return;
    const archiveFolder = Mail.folders.findByName('Archive');
    if (!archiveFolder) {
      Mail.ui.showToast('Archive folder not found', 'amber');
      return;
    }
    const r = await Mail.api.moveMessage(currentId, archiveFolder.id);
    if (r?.ok) {
      Mail.ui.showToast('Archived');
      Mail.inbox.removeFromList(currentId);
      _clearReader();
    } else {
      Mail.ui.showToast('Archive failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  async function moveToFolder() {
    if (!currentId) return;
    Mail.actions.openMoveDialog(currentId);
  }

  async function toggleRead() {
    if (!currentId || !currentMsg) return;
    const newState = !currentMsg.isRead;
    const r = await Mail.api.markRead(currentId, newState);
    if (r?.ok) {
      currentMsg.isRead = newState;
      _updateReadBtn();
      Mail.ui.showToast(newState ? 'Marked as read' : 'Marked as unread');
    } else {
      Mail.ui.showToast('Failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  function replyTo() {
    if (!currentMsg) return;
    const from = currentMsg.from?.emailAddress?.address || '';
    const subj = currentMsg.subject?.startsWith('Re:') ? currentMsg.subject : 'Re: ' + (currentMsg.subject || '');
    const orig = '\n\n--- Original message ---\nFrom: ' + from + '\n\n' +
      (currentMsg.body?.contentType === 'html' ? '' : (currentMsg.body?.content || ''));
    Mail.compose.open(from, subj, orig, 'Reply');
  }

  function replyAll() {
    if (!currentMsg) return;
    const from = currentMsg.from?.emailAddress?.address || '';
    const to   = (currentMsg.toRecipients || []).map(r => r.emailAddress?.address).filter(a => a !== from);
    const cc   = (currentMsg.ccRecipients || []).map(r => r.emailAddress?.address);
    const allTo = [from, ...to].join(', ');
    const subj  = currentMsg.subject?.startsWith('Re:') ? currentMsg.subject : 'Re: ' + (currentMsg.subject || '');
    const orig  = '\n\n--- Original message ---\nFrom: ' + from + '\n\n' +
      (currentMsg.body?.contentType === 'html' ? '' : (currentMsg.body?.content || ''));
    Mail.compose.open(allTo, subj, orig, 'Reply All', cc.join(', '));
  }

  function forwardMsg() {
    if (!currentMsg) return;
    const subj = currentMsg.subject?.startsWith('Fwd:') ? currentMsg.subject : 'Fwd: ' + (currentMsg.subject || '');
    const orig = '\n\n--- Forwarded message ---\nFrom: ' + (currentMsg.from?.emailAddress?.address || '') +
      '\nSubject: ' + (currentMsg.subject || '') + '\n\n' +
      (currentMsg.body?.contentType !== 'html' ? (currentMsg.body?.content || '') : '[HTML message]');
    Mail.compose.open('', subj, orig, 'Forward');
  }

  // ── Private ──────────────────────────────────────────────────────────────

  function _updateReadBtn() {
    const btn = Mail.ui.$('read-toggle-btn');
    if (btn && currentMsg) {
      btn.textContent = currentMsg.isRead ? '📩 Mark unread' : '📧 Mark read';
    }
  }

  function _clearReader() {
    currentId  = null;
    currentMsg = null;
    Mail.ui.$('read-content').classList.add('hidden');
    Mail.ui.$('read-content').style.display = 'none';
    Mail.ui.$('empty-state').classList.remove('hidden');
  }

  function getCurrent() { return currentMsg; }
  function getCurrentId() { return currentId; }

  return {
    open, deleteMsg, archiveMsg, moveToFolder, toggleRead,
    replyTo, replyAll, forwardMsg,
    getCurrent, getCurrentId
  };
})();
