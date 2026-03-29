import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notesApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDate } from '../../lib/utils';
import './Notes.css';

const nbColors = ['#7719aa','#0078d4','#107c10','#ca5010','#d13438','#008272','#4f6bed','#e3008c'];

export default function Notes() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [selectedNb, setSelectedNb] = useState(null);
  const [selectedSec, setSelectedSec] = useState(null);
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageHtml, setPageHtml] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [search, setSearch] = useState('');

  // Notebooks
  const { data: nbData, isLoading: nbLoading } = useQuery({
    queryKey: ['notebooks'],
    queryFn: notesApi.notebooks,
  });
  const notebooks = nbData?.value || [];

  // Sections
  const { data: secData } = useQuery({
    queryKey: ['sections', selectedNb],
    queryFn: () => notesApi.sections(selectedNb),
    enabled: !!selectedNb,
  });
  const sections = secData?.value || [];

  // Pages
  const { data: pagesData } = useQuery({
    queryKey: ['pages', selectedSec],
    queryFn: () => notesApi.pages(selectedSec),
    enabled: !!selectedSec,
  });
  const pages = pagesData?.value || [];

  const loadPage = async (page) => {
    setSelectedPage(page.id);
    setPageTitle(page.title || 'Untitled');
    setLoadingContent(true);
    try {
      const html = await notesApi.pageContent(page.id);
      setPageHtml(html);
    } catch {
      setPageHtml('<p>Failed to load page content</p>');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleCreateNotebook = async () => {
    const name = prompt('New notebook name:');
    if (name) {
      try { await notesApi.createNotebook(name); } catch {}
    }
  };

  const handleCreatePage = async () => {
    if (!selectedSec) return;
    const title = prompt('New page title:');
    if (title) {
      try { await notesApi.createPage(selectedSec, title, ''); } catch {}
    }
  };

  return (
    <div className="onenote-page">
      {/* Topbar */}
      <div className="on-topbar">
        <a className="on-topbar-nexcp" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>
          <span>NexCP</span><span className="on-sep">/</span><span className="on-cp">Control Panel</span>
        </a>
        <a className="on-brand" href="/notes" onClick={e => e.preventDefault()}>
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="3" y="2" width="15" height="20" rx="2" fill="#fff" />
            <rect x="3" y="2" width="6" height="20" rx="2" fill="#7719aa" />
            <text x="6" y="16" fontFamily="Segoe UI,sans-serif" fontSize="12" fontWeight="700" fill="#fff" textAnchor="middle">N</text>
            <rect x="12" y="6" width="7" height="1.5" rx=".5" fill="#d2d0ce" />
            <rect x="12" y="10" width="5" height="1.5" rx=".5" fill="#d2d0ce" />
            <rect x="12" y="14" width="6" height="1.5" rx=".5" fill="#d2d0ce" />
          </svg>
          <span className="on-brand-name">OneNote</span>
        </a>
        <div className="on-search">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="6.5" cy="6.5" r="5" /><line x1="10.5" y1="10.5" x2="14" y2="14" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search Notebooks"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="on-topbar-right">
          <span className="on-topbar-admin">{user?.name || 'Administrator'}</span>
          <button className="on-topbar-logout" onClick={logout}>Logout</button>
        </div>
      </div>

      {/* Main */}
      <div className="on-main">
        {/* Notebook sidebar */}
        <div className="on-nb-sidebar">
          <div className="on-nb-list">
            {nbLoading ? (
              <div className="on-spinner" />
            ) : notebooks.length === 0 ? (
              <div style={{ padding: '20px 14px', fontSize: 13, color: '#8a8886' }}>No notebooks</div>
            ) : (
              notebooks.map((nb, i) => (
                <div
                  key={nb.id}
                  className={`on-nb-item${selectedNb === nb.id ? ' active' : ''}`}
                  onClick={() => { setSelectedNb(nb.id); setSelectedSec(null); setSelectedPage(null); setPageHtml(''); setPageTitle(''); }}
                >
                  <div className="on-nb-color" style={{ background: nbColors[i % nbColors.length] }} />
                  <span className="on-nb-name">{nb.displayName}</span>
                </div>
              ))
            )}
          </div>
          <div className="on-nb-add" onClick={handleCreateNotebook}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v10M3 8h10" /></svg>
            + New Section
          </div>
        </div>

        {/* Section / page sidebar */}
        <div className="on-sec-sidebar">
          <div className="on-sec-add-page" onClick={handleCreatePage}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v10M3 8h10" /></svg>
            Add Page
          </div>

          {/* Section tabs */}
          {selectedNb && sections.length > 0 && (
            <div className="on-sec-tabs">
              {sections.map(s => (
                <button
                  key={s.id}
                  className={`on-sec-tab${selectedSec === s.id ? ' active' : ''}`}
                  onClick={() => { setSelectedSec(s.id); setSelectedPage(null); setPageHtml(''); setPageTitle(''); }}
                >
                  {s.displayName}
                </button>
              ))}
            </div>
          )}

          {/* Page list */}
          <div className="on-page-list">
            {selectedSec ? (
              pages.length === 0 ? (
                <div style={{ padding: '20px 14px', fontSize: 13, color: '#8a8886' }}>No pages</div>
              ) : (
                pages.map(p => (
                  <div
                    key={p.id}
                    className={`on-page-item${selectedPage === p.id ? ' active' : ''}`}
                    onClick={() => loadPage(p)}
                  >
                    <span className="on-page-title">{p.title || 'Untitled'}</span>
                    <span className="on-page-date">{formatDate(p.lastModifiedDateTime)}</span>
                  </div>
                ))
              )
            ) : !selectedNb ? (
              <div className="on-empty" style={{ padding: 30 }}>
                <div style={{ fontSize: 13 }}>Select a notebook</div>
              </div>
            ) : (
              <div className="on-empty" style={{ padding: 30 }}>
                <div style={{ fontSize: 13 }}>Select a section</div>
              </div>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="on-content">
          {/* Toolbar */}
          <div className="on-toolbar">
            <button className="on-tb-btn" title="Bold"><b>B</b></button>
            <button className="on-tb-btn" title="Italic"><i>I</i></button>
            <button className="on-tb-btn" title="Underline"><u>U</u></button>
            <button className="on-tb-btn" title="Strikethrough"><s>ab</s></button>
            <div className="on-tb-sep" />
            <button className="on-tb-btn" title="Bullet list">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="3" cy="4" r="1" fill="currentColor" /><circle cx="3" cy="8" r="1" fill="currentColor" /><circle cx="3" cy="12" r="1" fill="currentColor" />
                <path d="M7 4h7M7 8h7M7 12h7" />
              </svg>
            </button>
            <button className="on-tb-btn" title="Numbered list">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M7 4h7M7 8h7M7 12h7" />
              </svg>
            </button>
            <div className="on-tb-sep" />
            <button className="on-tb-btn" title="Indent">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 3h14M7 7h8M7 11h8M1 15h14M1 6l3 2.5L1 11" />
              </svg>
            </button>
            <button className="on-tb-btn" title="Outdent">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1 3h14M7 7h8M7 11h8M1 15h14M4 6l-3 2.5L4 11" />
              </svg>
            </button>
          </div>

          {/* Content body */}
          <div className="on-content-body">
            {selectedPage ? (
              loadingContent ? (
                <div className="on-spinner" />
              ) : (
                <>
                  <input
                    className="on-page-input"
                    value={pageTitle}
                    onChange={e => setPageTitle(e.target.value)}
                    readOnly
                  />
                  <div
                    className="on-page-html"
                    dangerouslySetInnerHTML={{ __html: pageHtml }}
                  />
                </>
              )
            ) : (
              <div className="on-empty">
                <svg viewBox="0 0 80 80" fill="none">
                  <rect x="10" y="5" width="60" height="70" rx="4" fill="#f3f2f1" stroke="#d2d0ce" strokeWidth="2" />
                  <path d="M25 30h30M25 40h20M25 50h25" stroke="#d2d0ce" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Select a page to view</div>
                <div style={{ fontSize: 12 }}>Choose a notebook and page from the left</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
