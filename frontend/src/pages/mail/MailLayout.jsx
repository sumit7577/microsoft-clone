import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { mailApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDate, initials } from '../../lib/utils';
import './MailLayout.css';

const avatarColors = ['#0078d4','#107c10','#ca5010','#8764b8','#008272','#e3008c','#4f6bed','#c239b3'];
function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function getDateGroup(dateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(dateStr);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today - msgDate) / (1000 * 60 * 60 * 24);
  if (diff < 1) return 'Today';
  if (diff < 2) return 'Yesterday';
  if (diff < 7) return 'This week';
  if (diff < 14) return 'Last week';
  return 'Earlier';
}

export default function MailLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [favExpanded, setFavExpanded] = useState(true);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [tab, setTab] = useState('focused');
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [showSweepDialog, setShowSweepDialog] = useState(false);
  const [sweepAction, setSweepAction] = useState('delete');
  const [sweepFolder, setSweepFolder] = useState('');
  const [undoStack, setUndoStack] = useState([]);
  const [undoToast, setUndoToast] = useState(null);
  const [moveDropdownPos, setMoveDropdownPos] = useState({ top: 0, left: 0 });
  const moveRef = useRef(null);

  // Close move dropdown on outside click (deferred so opening click doesn't close it)
  useEffect(() => {
    if (!showMoveDropdown) return;
    const close = (e) => {
      setShowMoveDropdown(false);
    };
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', close); };
  }, [showMoveDropdown]);

  const { data: foldersData } = useQuery({ queryKey: ['mail-folders'], queryFn: mailApi.folders, staleTime: 0, refetchOnMount: 'always' });
  const folders = foldersData?.value || [];

  const folderKey = selectedFolder || 'inbox';
  const { data: msgsData, isLoading: msgsLoading } = useQuery({
    queryKey: ['mail-messages', folderKey],
    queryFn: () => selectedFolder ? mailApi.folder(selectedFolder) : mailApi.inbox(),
    enabled: !searchResults,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const messages = searchResults || msgsData?.value || [];

  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentLabel = null;
    for (const m of messages) {
      const label = getDateGroup(m.receivedDateTime);
      if (label !== currentLabel) {
        groups.push({ type: 'header', label });
        currentLabel = label;
      }
      groups.push({ type: 'message', data: m });
    }
    return groups;
  }, [messages]);

  const { data: msgDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['mail-message', selectedMsg],
    queryFn: () => mailApi.message(selectedMsg),
    enabled: !!selectedMsg,
    staleTime: 0,
  });

  const deleteMut = useMutation({
    mutationFn: (id) => mailApi.del(id),
    onSuccess: (_, id) => {
      pushUndo({ type: 'delete', msgId: id, fromFolder: folderKey });
      setSelectedMsg(null); qc.invalidateQueries({ queryKey: ['mail-messages'] }); qc.invalidateQueries({ queryKey: ['mail-folders'] });
    },
  });

  const moveMut = useMutation({
    mutationFn: ({ id, folderId }) => mailApi.move(id, folderId),
    onSuccess: (_, { id, folderId }) => {
      pushUndo({ type: 'move', msgId: id, fromFolder: folderKey, toFolder: folderId });
      setSelectedMsg(null); setShowMoveDropdown(false); qc.invalidateQueries({ queryKey: ['mail-messages'] }); qc.invalidateQueries({ queryKey: ['mail-folders'] });
    },
  });

  const readMut = useMutation({
    mutationFn: ({ id, isRead }) => mailApi.read(id, isRead),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mail-messages'] }),
  });

  // Helpers for toolbar actions using well-known folder names
  const archiveMsg = () => { if (selectedMsg) moveMut.mutate({ id: selectedMsg, folderId: 'archive' }); };
  const junkMsg = () => { if (selectedMsg) moveMut.mutate({ id: selectedMsg, folderId: 'junkemail' }); };

  // ── Undo stack ─────────────────────────────────────────────────────────────
  const pushUndo = useCallback((action) => {
    setUndoStack(prev => [...prev.slice(-9), action]);
    setUndoToast(action.type === 'delete' ? 'Message deleted' : action.type === 'move' ? 'Message moved' : action.type === 'sweep' ? 'Sweep completed' : 'Action done');
    setTimeout(() => setUndoToast(null), 5000);
  }, []);

  const doUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack(prev => prev.slice(0, -1));
    setUndoToast(null);
    try {
      if (last.type === 'delete') {
        // "Delete" moved to deleteditems → move back to original folder
        await mailApi.move(last.msgId, last.fromFolder === 'inbox' ? 'inbox' : last.fromFolder);
      } else if (last.type === 'move') {
        await mailApi.move(last.msgId, last.fromFolder === 'inbox' ? 'inbox' : last.fromFolder);
      } else if (last.type === 'sweep') {
        // Sweep moves are batch — move each back
        for (const id of (last.msgIds || [])) {
          await mailApi.move(id, last.fromFolder === 'inbox' ? 'inbox' : last.fromFolder);
        }
      }
      qc.invalidateQueries({ queryKey: ['mail-messages'] });
      qc.invalidateQueries({ queryKey: ['mail-folders'] });
    } catch { /* best-effort undo */ }
  }, [undoStack, qc]);

  // ── Sweep ──────────────────────────────────────────────────────────────────
  const sweepMut = useMutation({
    mutationFn: ({ sender, action, folderId }) => mailApi.sweep(sender, action, folderId),
    onSuccess: (data) => {
      if (data?.movedIds?.length) {
        pushUndo({ type: 'sweep', msgIds: data.movedIds, fromFolder: folderKey });
      }
      setShowSweepDialog(false);
      qc.invalidateQueries({ queryKey: ['mail-messages'] });
      qc.invalidateQueries({ queryKey: ['mail-folders'] });
    },
  });

  const startSweep = () => {
    if (!msgDetail?.from?.emailAddress?.address) return;
    setSweepAction('delete');
    setSweepFolder('');
    setShowSweepDialog(true);
  };

  const confirmSweep = () => {
    if (!msgDetail?.from?.emailAddress?.address) return;
    sweepMut.mutate({
      sender: msgDetail.from.emailAddress.address,
      action: sweepAction,
      folderId: sweepAction === 'move' ? sweepFolder : undefined,
    });
  };

  const doSearch = useCallback(async () => {
    if (!search.trim()) { setSearchResults(null); return; }
    setSearching(true);
    try { const r = await mailApi.search(search); setSearchResults(r.value || []); }
    catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [search]);

  const [composeData, setComposeData] = useState({ to: '', cc: '', subject: '', body: '' });
  const sendMut = useMutation({
    mutationFn: () => mailApi.send(composeData),
    onSuccess: () => {
      setShowCompose(false);
      setComposeData({ to: '', cc: '', subject: '', body: '' });
      qc.invalidateQueries({ queryKey: ['mail-messages'] });
    },
  });

  const favoriteNames = ['Inbox', 'Sent Items', 'Drafts'];
  const favoriteFolders = folders.filter(f => favoriteNames.includes(f.displayName));

  return (
    <div className="outlook-page">
      {/* Topbar - dark red classic Outlook */}
      <div className="outlook-topbar">
        <div className="outlook-topbar-left">
          <button className="ol-waffle" title="Microsoft 365">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle cx="3" cy="3" r="1.4" fill="currentColor"/>
              <circle cx="8" cy="3" r="1.4" fill="currentColor"/>
              <circle cx="13" cy="3" r="1.4" fill="currentColor"/>
              <circle cx="3" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="13" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="3" cy="13" r="1.4" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.4" fill="currentColor"/>
              <circle cx="13" cy="13" r="1.4" fill="currentColor"/>
            </svg>
          </button>
          <span className="outlook-brand">Outlook</span>
        </div>

        <div className="outlook-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="5" /><line x1="10.5" y1="10.5" x2="14" y2="14" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
        </div>

        <div className="outlook-topbar-right">
          <button className="ol-top-icon" title="Settings">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
            </svg>
          </button>
          <button className="ol-top-icon" title="Help">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="7"/><path d="M6 6a2 2 0 013.5 1.5c0 1-1.5 1.5-1.5 1.5"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/>
            </svg>
          </button>
          <a className="ol-nexcp-link" href="/" onClick={e => { e.preventDefault(); navigate('/'); }} title="Back to NexCP">
            NexCP
          </a>
          <div className="ol-user-avatar" title={`${user?.name || 'User'} — Click to logout`} onClick={logout}>
            {initials(user?.name || 'A')}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="outlook-toolbar">
        <button className="ol-tb-btn ol-tb-btn-new" onClick={() => setShowCompose(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>
          </svg>
          New message
        </button>
        <div className="ol-tb-sep" />
        <button className="ol-tb-btn" onClick={() => selectedMsg && deleteMut.mutate(selectedMsg)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M4 4l.7 8.8a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" />
          </svg>
          Delete
        </button>
        <button className="ol-tb-btn" onClick={archiveMsg} disabled={!selectedMsg}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="4" rx="1"/><path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6M6.5 9h3"/>
          </svg>
          Archive
        </button>
        <button className="ol-tb-btn ol-tb-chevron" onClick={junkMsg} disabled={!selectedMsg}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4l6 5 6-5"/><rect x="1" y="3" width="14" height="10" rx="1.5"/>
          </svg>
          Junk
          <svg className="chevron" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
        <button className="ol-tb-btn" onClick={startSweep} disabled={!selectedMsg}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 12h12M2 8h8M2 4h12"/>
          </svg>
          Sweep
        </button>
        <button ref={moveRef} className="ol-tb-btn ol-tb-chevron" onClick={(e) => {
          e.stopPropagation();
          if (!selectedMsg) return;
          if (!showMoveDropdown && moveRef.current) {
            const r = moveRef.current.getBoundingClientRect();
            setMoveDropdownPos({ top: r.bottom + 2, left: r.left });
          }
          setShowMoveDropdown(!showMoveDropdown);
        }}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4l5 4-5 4"/><path d="M9 3h5v10H9"/>
          </svg>
          Move to
          <svg className="chevron" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
        {showMoveDropdown && (
          <div className="ol-dropdown" style={{ top: moveDropdownPos.top, left: moveDropdownPos.left }} onClick={e => e.stopPropagation()}>
            {folders.map(f => (
              <div key={f.id} className="ol-dropdown-item" onClick={() => moveMut.mutate({ id: selectedMsg, folderId: f.id })}>
                {f.displayName}
              </div>
            ))}
          </div>
        )}
        <button className="ol-tb-btn ol-tb-chevron">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8h6"/>
          </svg>
          Categorize
          <svg className="chevron" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
        <div className="ol-tb-sep" />
        <button className="ol-tb-btn" onClick={doUndo} disabled={undoStack.length === 0}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 14l4-4M14 2l-4 4M6 14H2v-4M10 2h4v4"/>
          </svg>
          Undo
        </button>
        <button className="ol-tb-btn" title="More actions">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
          </svg>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button className="ol-tb-btn" onClick={() => qc.invalidateQueries({ queryKey: ['mail-messages'] })}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 8a6 6 0 0111.5-2M14 8a6 6 0 01-11.5 2"/><path d="M14 2v4h-4M2 14v-4h4"/>
            </svg>
          </button>
          <label className="ol-toggle">
            <input type="checkbox" defaultChecked />
            <span className="ol-toggle-slider" />
            <span className="ol-toggle-label">The new Outlook</span>
          </label>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="mail-layout">
        {/* Folder panel */}
        <div className="folder-panel">
          <div className="folder-scroll">
            {/* Favorites */}
            <div className="folder-section-hdr" onClick={() => setFavExpanded(!favExpanded)}>
              <svg className={`section-chevron${favExpanded ? ' expanded' : ''}`} viewBox="0 0 10 10">
                <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              Favorites
            </div>
            {favExpanded && (
              <>
                <div
                  className={`folder-item${!selectedFolder ? ' active' : ''}`}
                  onClick={() => { setSelectedFolder(null); setSearchResults(null); }}
                >
                  <svg className="folder-icon" viewBox="0 0 16 16" fill="none" stroke="#0078d4" strokeWidth="1.3">
                    <rect x="1" y="3" width="14" height="10" rx="1.5"/><path d="M1 5l7 4 7-4"/>
                  </svg>
                  <span className="folder-name">Inbox</span>
                  {folders.find(f => f.displayName === 'Inbox')?.unreadItemCount > 0 && (
                    <span className="folder-badge">{folders.find(f => f.displayName === 'Inbox')?.unreadItemCount}</span>
                  )}
                </div>
                {favoriteFolders.filter(f => f.displayName !== 'Inbox').map(f => (
                  <div
                    key={f.id}
                    className={`folder-item${selectedFolder === f.id ? ' active' : ''}`}
                    onClick={() => { setSelectedFolder(f.id); setSelectedMsg(null); setSearchResults(null); }}
                  >
                    <svg className="folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                      {f.displayName === 'Sent Items' ? (
                        <path d="M1 8l6-5v4h7v2H7v4z"/>
                      ) : f.displayName === 'Drafts' ? (
                        <><path d="M12 2L5 9v3h3l7-7-3-3z"/><path d="M2 14h12"/></>
                      ) : (
                        <path d="M1 3h5l2 2h7v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"/>
                      )}
                    </svg>
                    <span className="folder-name">{f.displayName}</span>
                    {f.unreadItemCount > 0 && <span className="folder-badge">{f.unreadItemCount}</span>}
                  </div>
                ))}
                <div className="folder-add">Add favorite</div>
              </>
            )}

            {/* Folders */}
            <div className="folder-section-hdr" onClick={() => setFoldersExpanded(!foldersExpanded)}>
              <svg className={`section-chevron${foldersExpanded ? ' expanded' : ''}`} viewBox="0 0 10 10">
                <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              Folders
            </div>
            {foldersExpanded && folders.map(f => (
              <div
                key={f.id}
                className={`folder-item${selectedFolder === f.id ? ' active' : ''}`}
                onClick={() => { setSelectedFolder(f.id); setSelectedMsg(null); setSearchResults(null); }}
              >
                <svg className="folder-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M1 3h5l2 2h7v8a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"/>
                </svg>
                <span className="folder-name">{f.displayName}</span>
                {f.unreadItemCount > 0 && <span className="folder-badge">{f.unreadItemCount}</span>}
              </div>
            ))}
          </div>

          {/* Bottom app bar */}
          <div className="folder-appbar">
            <button className="appbar-btn" title="Calendar">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6h12M5 1v4M11 1v4"/>
              </svg>
            </button>
            <button className="appbar-btn" title="People">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.5-5 6-5s6 2 6 5"/>
              </svg>
            </button>
            <button className="appbar-btn" title="To Do">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M3 8l3 3 7-7"/>
              </svg>
            </button>
            <button className="appbar-btn" title="More">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Inbox panel */}
        <div className="inbox-panel">
          <div className="inbox-tabs">
            <button className={`inbox-tab${tab === 'focused' ? ' active' : ''}`} onClick={() => setTab('focused')}>
              <span className="tab-indicator" />
              Focused
            </button>
            <button className={`inbox-tab${tab === 'other' ? ' active' : ''}`} onClick={() => setTab('other')}>
              Other
            </button>
            <button className="inbox-filter">
              Filter
              <svg viewBox="0 0 10 6" width="8"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
          </div>
          <div className="inbox-list">
            {msgsLoading || searching ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                <div className="outlook-spinner" />
              </div>
            ) : messages.length === 0 ? (
              <div className="inbox-empty">No messages</div>
            ) : (
              groupedMessages.map((item, i) => {
                if (item.type === 'header') {
                  return <div key={`hdr-${i}`} className="date-group">{item.label}</div>;
                }
                const m = item.data;
                const fromName = m.from?.emailAddress?.name || m.from?.emailAddress?.address || 'Unknown';
                return (
                  <div
                    key={m.id}
                    className={`mail-item${selectedMsg === m.id ? ' active' : ''}${!m.isRead ? ' unread' : ''}`}
                    onClick={() => setSelectedMsg(m.id)}
                  >
                    <div className="mail-avatar" style={{ background: getAvatarColor(fromName) }}>
                      {initials(fromName)}
                    </div>
                    <div className="mail-content">
                      <div className="mail-from-row">
                        <span className="mail-from">{fromName}</span>
                        <span className="mail-date">{formatDate(m.receivedDateTime)}</span>
                      </div>
                      <div className="mail-subject">{m.subject || '(No subject)'}</div>
                      <div className="mail-preview">{m.bodyPreview}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Read panel */}
        {selectedMsg && msgDetail ? (
          <div className="read-panel">
            <div className="read-header">
              <div className="read-subject">{msgDetail.subject || '(No subject)'}</div>
              <div className="read-info-bar">
                <span>Getting too much email? <a href="#" onClick={e => e.preventDefault()}>Unsubscribe</a></span>
              </div>
              <div className="read-sender">
                <div className="read-avatar" style={{ background: getAvatarColor(msgDetail.from?.emailAddress?.name) }}>
                  {initials(msgDetail.from?.emailAddress?.name || '')}
                </div>
                <div className="read-sender-info">
                  <div className="read-sender-name">{msgDetail.from?.emailAddress?.name}</div>
                  <div className="read-sender-email">{msgDetail.from?.emailAddress?.address}</div>
                </div>
                <div className="read-sender-actions">
                  <button className="ol-action-icon" title="Reply">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3L2 7l4 4"/><path d="M2 7h8a4 4 0 014 4v1"/></svg>
                  </button>
                  <button className="ol-action-icon" title="Reply All">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3L4 7l4 4"/><path d="M5 3L1 7l4 4"/><path d="M4 7h7a4 4 0 014 4v1"/></svg>
                  </button>
                  <button className="ol-action-icon" title="Forward">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 3l4 4-4 4"/><path d="M14 7H6a4 4 0 00-4 4v1"/></svg>
                  </button>
                  <button className="ol-action-icon" title="Delete" onClick={() => deleteMut.mutate(selectedMsg)}>
                    <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg>
                  </button>
                </div>
                <div className="read-date">{formatDate(msgDetail.receivedDateTime)}</div>
              </div>
              {msgDetail.toRecipients?.length > 0 && (
                <div className="read-to">To: {msgDetail.toRecipients.map(r => r.emailAddress?.name || r.emailAddress?.address).join('; ')}</div>
              )}
            </div>
            <div className="read-body">
              {detailLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                  <div className="outlook-spinner" />
                </div>
              ) : (
                <div className="read-body-content" dangerouslySetInnerHTML={{ __html: msgDetail.body?.content || '' }} />
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state-outlook">
            <div className="empty-envelope">
              <svg width="120" height="90" viewBox="0 0 120 90" fill="none">
                <rect x="10" y="20" width="100" height="60" rx="8" fill="#e8e6e3" stroke="#d2d0ce" strokeWidth="2"/>
                <path d="M10 28l50 30 50-30" stroke="#d2d0ce" strokeWidth="2" fill="none"/>
                <rect x="35" y="5" width="50" height="35" rx="4" fill="#fff" stroke="#d2d0ce" strokeWidth="1.5"/>
                <rect x="42" y="15" width="36" height="3" rx="1.5" fill="#e8e6e3"/>
                <rect x="42" y="22" width="25" height="3" rx="1.5" fill="#e8e6e3"/>
              </svg>
            </div>
            <div className="empty-title">Select a message</div>
            <div className="empty-desc">Choose a message from the list to read it here</div>
          </div>
        )}
      </div>

      {/* Compose overlay */}
      {showCompose && (
        <div className="compose-overlay" onClick={(e) => e.target === e.currentTarget && setShowCompose(false)}>
          <div className="compose-win">
            <div className="compose-hdr">
              <span className="compose-title">New Message</span>
              <button className="close-x" onClick={() => setShowCompose(false)}>&times;</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); sendMut.mutate(); }}>
              <div className="compose-body">
                <div className="compose-field">
                  <label>To</label>
                  <input
                    placeholder="Recipients"
                    value={composeData.to}
                    onChange={e => setComposeData({ ...composeData, to: e.target.value })}
                    required
                  />
                </div>
                <div className="compose-field">
                  <label>Cc</label>
                  <input
                    value={composeData.cc}
                    onChange={e => setComposeData({ ...composeData, cc: e.target.value })}
                  />
                </div>
                <div className="compose-field">
                  <label>Subj</label>
                  <input
                    placeholder="Subject"
                    value={composeData.subject}
                    onChange={e => setComposeData({ ...composeData, subject: e.target.value })}
                    required
                  />
                </div>
                <textarea
                  className="compose-area"
                  placeholder="Type your message..."
                  value={composeData.body}
                  onChange={e => setComposeData({ ...composeData, body: e.target.value })}
                />
              </div>
              <div className="compose-footer">
                <button type="submit" className="ol-btn ol-btn-send" disabled={sendMut.isPending}>
                  {sendMut.isPending ? 'Sending...' : 'Send'}
                </button>
                <button type="button" className="ol-btn" onClick={() => setShowCompose(false)}>Discard</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sweep dialog */}
      {showSweepDialog && (
        <div className="compose-overlay" onClick={(e) => e.target === e.currentTarget && setShowSweepDialog(false)}>
          <div className="compose-win" style={{ maxWidth: '420px' }}>
            <div className="compose-hdr">
              <span className="compose-title">Sweep</span>
              <button className="close-x" onClick={() => setShowSweepDialog(false)}>&times;</button>
            </div>
            <div className="compose-body" style={{ padding: '16px' }}>
              <p style={{ marginBottom: '12px' }}>
                Clean up all messages from <strong>{msgDetail?.from?.emailAddress?.address}</strong> in this folder.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="sweep" value="delete" checked={sweepAction === 'delete'} onChange={() => setSweepAction('delete')} />
                  Move all messages to Deleted Items
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="sweep" value="move" checked={sweepAction === 'move'} onChange={() => setSweepAction('move')} />
                  Move all messages to folder:
                </label>
                {sweepAction === 'move' && (
                  <select value={sweepFolder} onChange={e => setSweepFolder(e.target.value)} style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', marginLeft: '24px' }}>
                    <option value="">Select folder...</option>
                    {folders.map(f => <option key={f.id} value={f.id}>{f.displayName}</option>)}
                  </select>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input type="radio" name="sweep" value="rule" checked={sweepAction === 'rule'} onChange={() => setSweepAction('rule')} />
                  Always move future messages to Deleted Items
                </label>
              </div>
            </div>
            <div className="compose-footer">
              <button className="ol-btn ol-btn-send" onClick={confirmSweep} disabled={sweepMut.isPending || (sweepAction === 'move' && !sweepFolder)}>
                {sweepMut.isPending ? 'Sweeping...' : 'OK'}
              </button>
              <button className="ol-btn" onClick={() => setShowSweepDialog(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Undo toast */}
      {undoToast && (
        <div className="ol-undo-toast">
          <span>{undoToast}</span>
          <button onClick={doUndo}>Undo</button>
        </div>
      )}
    </div>
  );
}
