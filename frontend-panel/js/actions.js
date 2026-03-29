/**
 * actions.js — NexCP Mail actions
 * Move-to-folder dialog, bulk actions (future), context menu helpers.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.actions = (() => {
  let pendingMoveId = null;

  function openMoveDialog(msgId) {
    pendingMoveId = msgId;
    const folders = Mail.folders.getAll();
    const overlay = Mail.ui.$('move-overlay');
    const list    = Mail.ui.$('move-folder-list');

    if (!folders.length) {
      Mail.ui.showToast('No folders loaded', 'amber');
      return;
    }

    list.innerHTML = folders.map(f => {
      return `<div class="move-folder-item" onclick="Mail.actions.confirmMove('${Mail.ui.esc(f.id)}')">
        <span class="folder-icon">${_getIcon(f.displayName)}</span>
        <span>${Mail.ui.esc(f.displayName)}</span>
        <span class="move-count">${f.totalItemCount || 0}</span>
      </div>`;
    }).join('');

    overlay.classList.remove('hidden');
  }

  function closeMoveDialog() {
    pendingMoveId = null;
    Mail.ui.$('move-overlay').classList.add('hidden');
  }

  async function confirmMove(folderId) {
    if (!pendingMoveId) return;
    closeMoveDialog();
    const r = await Mail.api.moveMessage(pendingMoveId, folderId);
    if (r?.ok) {
      Mail.ui.showToast('Moved');
      Mail.inbox.removeFromList(pendingMoveId);
      pendingMoveId = null;
    } else {
      Mail.ui.showToast('Move failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  function _getIcon(name) {
    const map = {
      'Inbox': '📥', 'Drafts': '📝', 'Sent Items': '📤',
      'Deleted Items': '🗑️', 'Junk Email': '⚠️', 'Archive': '📦',
      'Outbox': '📬'
    };
    return map[name] || '📁';
  }

  return { openMoveDialog, closeMoveDialog, confirmMove };
})();
