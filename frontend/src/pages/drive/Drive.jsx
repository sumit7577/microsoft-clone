import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { driveApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDate, formatBytes } from '../../lib/utils';
import './Drive.css';

export default function Drive() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [path, setPath] = useState([]);
  const currentId = path.length > 0 ? path[path.length - 1].id : null;
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showRename, setShowRename] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [sidebarView, setSidebarView] = useState('files');

  const { data: items, isLoading } = useQuery({
    queryKey: ['drive-items', currentId],
    queryFn: () => (currentId ? driveApi.folder(currentId) : driveApi.root()),
    enabled: !searchResults,
  });

  const { data: quota } = useQuery({ queryKey: ['drive-quota'], queryFn: driveApi.quota });

  const deleteMut = useMutation({
    mutationFn: (id) => driveApi.del(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drive-items'] }),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }) => driveApi.rename(id, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['drive-items'] }); setShowRename(null); },
  });

  const createFolderMut = useMutation({
    mutationFn: (name) => driveApi.createFolder(name, currentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drive-items'] }),
  });

  const handleOpen = (item) => {
    if (item.folder) {
      setPath([...path, { id: item.id, name: item.name }]);
      setSearchResults(null);
    }
  };

  const handleDownload = async (item) => {
    try { const r = await driveApi.download(item.id); window.open(r.downloadUrl, '_blank'); } catch {}
  };

  const handleSearch = async () => {
    if (!search.trim()) { setSearchResults(null); return; }
    try { const r = await driveApi.search(search); setSearchResults(r.value || []); }
    catch { setSearchResults([]); }
  };

  const goRoot = () => { setPath([]); setSearchResults(null); setSidebarView('files'); };
  const goTo = (i) => setPath(path.slice(0, i + 1));

  const displayItems = (searchResults || items?.value || [])
    .sort((a, b) => (a.folder && !b.folder ? -1 : !a.folder && b.folder ? 1 : 0));

  const quotaUsed = quota?.used || 0;
  const quotaTotal = quota?.total || 1;
  const quotaPct = Math.min(100, (quotaUsed / quotaTotal) * 100);

  const currentName = path.length > 0 ? path[path.length - 1].name : 'My files';

  return (
    <div className="onedrive-page" onClick={() => setCtxMenu(null)}>
      {/* Topbar */}
      <div className="od-topbar">
        <a className="od-topbar-nexcp" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>
          <span>NexCP</span><span className="od-topbar-sep">/</span><span className="od-topbar-cp">Control Panel</span>
        </a>
        <a className="od-brand" href="/drive" onClick={e => e.preventDefault()}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M14.5 3C11.47 3 9 5.47 9 8.5c0 .36.04.72.1 1.06C5.69 9.96 3 12.91 3 16.5 3 20.09 5.91 23 9.5 23h10c2.49 0 4.5-2.01 4.5-4.5 0-2.13-1.48-3.91-3.46-4.38C20.82 12.22 21 10.38 21 9.5 21 5.91 18.09 3 14.5 3z" fill="#0078d4"/>
          </svg>
          <span className="od-brand-name">OneDrive</span>
        </a>
        <div className="od-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="5" /><line x1="10.5" y1="10.5" x2="14" y2="14" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Let's find some stuff"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <div className="od-topbar-right">
          <div className="od-topbar-icon" title="Notifications">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 2a5 5 0 015 5v3l2 2H3l2-2V7a5 5 0 015-5zM8 17a2 2 0 004 0"/></svg>
          </div>
          <div className="od-topbar-icon" title="Settings">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="2"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.9 3.9l1.4 1.4M14.7 14.7l1.4 1.4M3.9 16.1l1.4-1.4M14.7 5.3l1.4-1.4"/></svg>
          </div>
          <span className="od-topbar-admin">{user?.name || 'Administrator'}</span>
          <button className="od-topbar-logout" onClick={logout}>Logout</button>
        </div>
      </div>

      {/* Main layout */}
      <div className="od-main">
        {/* Sidebar */}
        <div className="od-sidebar">
          <button className="od-sidebar-add" onClick={() => {
            const name = prompt('New folder name:');
            if (name) createFolderMut.mutate(name);
          }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" /></svg>
            Add New
          </button>

          <div className={`od-sidebar-item${sidebarView === 'home' ? ' active' : ''}`} onClick={() => { setSidebarView('home'); goRoot(); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 10l7-7 7 7"/><path d="M5 8v8a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V8"/></svg>
            Home
          </div>
          <div className={`od-sidebar-item${sidebarView === 'files' ? ' active' : ''}`} onClick={() => { setSidebarView('files'); goRoot(); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 5l3-2h4l2 2h5a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" /></svg>
            My files
          </div>
          <div className={`od-sidebar-item${sidebarView === 'shared' ? ' active' : ''}`} onClick={() => setSidebarView('shared')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="8" r="3"/><circle cx="14" cy="8" r="2.5"/><path d="M1 17c0-3 2.5-5 6-5s6 2 6 5"/><path d="M13 12c2.5 0 5 1.5 5 4"/></svg>
            Shared
          </div>
          <div className={`od-sidebar-item${sidebarView === 'favorites' ? ' active' : ''}`} onClick={() => setSidebarView('favorites')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.5L10 14.4 4.9 17.2l1-5.5-4-3.9 5.6-.8z"/></svg>
            Favorites
          </div>
          <div className={`od-sidebar-item${sidebarView === 'recycle' ? ' active' : ''}`} onClick={() => setSidebarView('recycle')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 6h12M7 6V4a1 1 0 011-1h4a1 1 0 011 1v2M5 6l.7 10.5a1.5 1.5 0 001.5 1.5h5.6a1.5 1.5 0 001.5-1.5L15 6"/></svg>
            Recycle bin
          </div>

          <div className="od-sidebar-sep" />
          <div className="od-sidebar-section">Browse by</div>
          <div className="od-sidebar-item">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="10" cy="7" r="4"/><path d="M3 18c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>
            People
          </div>
          <div className="od-sidebar-item">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="16" height="14" rx="1.5"/><path d="M2 7h16"/><circle cx="10" cy="12" r="2"/></svg>
            Meetings
          </div>

          <div className="od-sidebar-sep" />
          <div className="od-sidebar-item" onClick={() => window.location.href = '/mail'}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="4" width="16" height="12" rx="1"/><path d="M2 4l8 6 8-6"/></svg>
            Mail
          </div>

          <div className="od-quota-bar">
            <div className="od-quota-label">Storage</div>
            <div className="od-quota-track">
              <div className="od-quota-fill" style={{ width: `${quotaPct}%` }} />
            </div>
            <div className="od-quota-text">{formatBytes(quotaUsed)} of {formatBytes(quotaTotal)} used</div>
          </div>
        </div>

        {/* Content */}
        <div className="od-content">
          <div className="od-content-header">
            <div className="od-breadcrumb">
              {path.length > 0 ? (
                <>
                  <button className="od-bc-item" onClick={goRoot}>My files</button>
                  {path.map((p, i) => (
                    <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="od-bc-sep">›</span>
                      {i === path.length - 1 ? (
                        <span className="od-bc-current">{p.name}</span>
                      ) : (
                        <button className="od-bc-item" onClick={() => goTo(i)}>{p.name}</button>
                      )}
                    </span>
                  ))}
                </>
              ) : (
                <span className="od-bc-current">{currentName}</span>
              )}
            </div>
            <div className="od-header-actions">
              <button className="od-ha-btn" onClick={() => qc.invalidateQueries({ queryKey: ['drive-items'] })} title="Refresh">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 8a6 6 0 0111.5-2M14 8a6 6 0 01-11.5 2" /><path d="M14 2v4h-4M2 14v-4h4" />
                </svg>
              </button>
            </div>
          </div>

          {/* File header */}
          <div className="od-file-header">
            <div className="col-name">Name</div>
            <div className="col-modified">Modified</div>
            <div className="col-sharing">Sharing</div>
            <div className="col-size">Size</div>
            <div className="col-actions"></div>
          </div>

          {/* File list */}
          <div className="od-file-list">
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px' }}>
                <div className="od-spinner" />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="od-empty">
                <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 20l15-10h20l10 10h15a3 3 0 013 3v34a3 3 0 01-3 3H10a3 3 0 01-3-3V23a3 3 0 013-3z" />
                </svg>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>This folder is empty</div>
                <div style={{ fontSize: '13px' }}>Drop files here or use the Add New button</div>
              </div>
            ) : (
              <>
                {path.length > 0 && !searchResults && (
                  <div className="od-file-item" onClick={() => setPath(path.slice(0, -1))}>
                    <div className="od-file-icon">
                      <span style={{ fontSize: '20px' }}>⬆️</span>
                    </div>
                    <div className="od-col-name">
                      <span className="od-file-name">..</span>
                    </div>
                    <div className="od-col-modified" /><div className="od-col-sharing" /><div className="od-col-size" /><div className="od-col-actions" />
                  </div>
                )}
                {displayItems.map(item => (
                  <div
                    key={item.id}
                    className="od-file-item"
                    onDoubleClick={() => handleOpen(item)}
                    onClick={() => handleOpen(item)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, item });
                    }}
                  >
                    <div className="od-file-icon">
                      {item.folder ? (
                        <svg viewBox="0 0 20 20" className="folder-color" fill="currentColor">
                          <path d="M2 5l3-2h4l2 2h7a1 1 0 011 1v9a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="none" stroke="#605e5c" strokeWidth="1.2">
                          <path d="M4 2h8l4 4v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
                          <path d="M12 2v4h4" />
                        </svg>
                      )}
                    </div>
                    <div className="od-col-name">
                      <span className="od-file-name">{item.name}</span>
                    </div>
                    <div className="od-col-modified">{formatDate(item.lastModifiedDateTime)}</div>
                    <div className="od-col-sharing">Only you</div>
                    <div className="od-col-size">
                      {item.folder ? `${item.folder.childCount || 0} items` : formatBytes(item.size)}
                    </div>
                    <div className="od-col-actions">
                      <button
                        className="od-action-dot"
                        onClick={e => {
                          e.stopPropagation();
                          setCtxMenu({ x: e.clientX, y: e.clientY, item });
                        }}
                      >
                        ⋯
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div className="od-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={e => e.stopPropagation()}>
          {!ctxMenu.item.folder && (
            <div className="od-ctx-item" onClick={() => { handleDownload(ctxMenu.item); setCtxMenu(null); }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2"/></svg>
              Download
            </div>
          )}
          <div className="od-ctx-item" onClick={() => {
            setShowRename(ctxMenu.item);
            setRenameVal(ctxMenu.item.name);
            setCtxMenu(null);
          }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z"/></svg>
            Rename
          </div>
          <div className="od-ctx-sep" />
          <div className="od-ctx-item danger" onClick={() => { deleteMut.mutate(ctxMenu.item.id); setCtxMenu(null); }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M5.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1M4 4l.7 8.8a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4"/></svg>
            Delete
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {showRename && (
        <div className="od-rename-overlay" onClick={() => setShowRename(null)}>
          <div className="od-rename-win" onClick={e => e.stopPropagation()}>
            <div className="od-rename-title">Rename</div>
            <input
              className="od-rename-input"
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') renameMut.mutate({ id: showRename.id, name: renameVal });
              }}
            />
            <div className="od-rename-btns">
              <button className="od-btn" onClick={() => setShowRename(null)}>Cancel</button>
              <button
                className="od-btn od-btn-primary"
                onClick={() => renameMut.mutate({ id: showRename.id, name: renameVal })}
                disabled={renameMut.isPending}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
