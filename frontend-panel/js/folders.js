/**
 * folders.js — NexCP Mail folder management
 * Loads real Outlook folders, renders sidebar, create/delete folders.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.folders = (() => {
  let folders = [];
  let activeFolderId = null; // null = inbox (default)

  // Well-known folder icons
  const FOLDER_ICONS = {
    'inbox':        '📥',
    'drafts':       '📝',
    'sentitems':    '📤',
    'deleteditems': '🗑️',
    'junkemail':    '⚠️',
    'archive':      '📦',
    'outbox':       '📬',
    'clutter':      '🧹',
  };

  // Well-known display name overrides
  const WELL_KNOWN = {
    'Inbox': 'inbox',
    'Drafts': 'drafts',
    'Sent Items': 'sentitems',
    'Deleted Items': 'deleteditems',
    'Junk Email': 'junkemail',
    'Archive': 'archive',
    'Outbox': 'outbox',
    'Clutter': 'clutter',
  };

  function getIcon(folder) {
    const wk = WELL_KNOWN[folder.displayName];
    if (wk && FOLDER_ICONS[wk]) return FOLDER_ICONS[wk];
    return '📁';
  }

  function isWellKnown(folder) {
    return !!WELL_KNOWN[folder.displayName];
  }

  async function load() {
    const data = await Mail.api.getFolders();
    if (!data || data.error) {
      console.error('[Folders] Load failed:', data?.error);
      return;
    }
    folders = data.value || [];
    render();
  }

  function render() {
    const el = Mail.ui.$('folder-list');
    if (!el) return;

    // Sort: well-known first (in fixed order), then custom alphabetically
    const order = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email', 'Archive', 'Outbox'];
    const wkFolders = [];
    const customFolders = [];

    for (const f of folders) {
      if (order.includes(f.displayName)) {
        wkFolders.push(f);
      } else if (!f.parentFolderId || isTopLevel(f)) {
        customFolders.push(f);
      }
    }

    wkFolders.sort((a, b) => order.indexOf(a.displayName) - order.indexOf(b.displayName));
    customFolders.sort((a, b) => a.displayName.localeCompare(b.displayName));

    let html = '';

    // Well-known folders
    for (const f of wkFolders) {
      html += folderItem(f);
    }

    // Separator + custom folders
    if (customFolders.length) {
      html += '<div class="folder-sep"></div>';
      for (const f of customFolders) {
        html += folderItem(f, true);
      }
    }

    el.innerHTML = html;
  }

  function folderItem(f, canDelete = false) {
    const icon    = getIcon(f);
    const active  = (activeFolderId === f.id) || (!activeFolderId && f.displayName === 'Inbox');
    const unread  = f.unreadItemCount || 0;
    const count   = f.totalItemCount || 0;

    return `<div class="folder-item ${active ? 'active' : ''}" data-id="${Mail.ui.esc(f.id)}" onclick="Mail.folders.select('${Mail.ui.esc(f.id)}','${Mail.ui.esc(f.displayName)}')">
      <span class="folder-icon">${icon}</span>
      <span class="folder-name">${Mail.ui.esc(f.displayName)}</span>
      ${unread > 0 ? `<span class="folder-badge">${unread}</span>` : ''}
      ${canDelete ? `<span class="folder-delete" title="Delete folder" onclick="event.stopPropagation();Mail.folders.remove('${Mail.ui.esc(f.id)}','${Mail.ui.esc(f.displayName)}')">✕</span>` : ''}
    </div>`;
  }

  function isTopLevel(f) {
    // A folder is top-level if its parent is the root (msgfolderroot)
    // We check if any folder has this as child — simplified: just show all non-child folders
    const parentIds = new Set(folders.filter(x => x.childFolderCount > 0).map(x => x.id));
    return !parentIds.has(f.parentFolderId) || !folders.some(x => x.id === f.parentFolderId && WELL_KNOWN[x.displayName]);
  }

  async function select(folderId, displayName) {
    activeFolderId = folderId;
    render();
    // Update inbox header label
    const label = Mail.ui.$('inbox-label');
    if (label) label.textContent = displayName || 'Inbox';
    // Load messages for this folder
    Mail.inbox.loadFolder(folderId);
  }

  async function create() {
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;
    const r = await Mail.api.createFolder(name.trim());
    if (r?.id || r?.displayName) {
      Mail.ui.showToast('Folder created');
      load();
    } else {
      Mail.ui.showToast('Failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  async function remove(folderId, name) {
    if (!Mail.ui.confirm(`Delete folder "${name}"? Messages inside will be deleted.`)) return;
    const r = await Mail.api.deleteFolder(folderId);
    if (r?.ok) {
      Mail.ui.showToast('Folder deleted', 'amber');
      if (activeFolderId === folderId) {
        activeFolderId = null;
        Mail.inbox.loadInbox();
      }
      load();
    } else {
      Mail.ui.showToast('Failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  function getAll() { return folders; }
  function getActive() { return activeFolderId; }

  // Find a folder ID by well-known name
  function findByName(name) {
    return folders.find(f => f.displayName === name);
  }

  return { load, render, select, create, remove, getAll, getActive, findByName };
})();
