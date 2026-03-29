import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { profileApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatDate, initials } from '../../lib/utils';
import './Profile.css';

const sidebarSections = [
  { key: 'overview', label: 'Overview' },
  { key: 'security', label: 'Security Info' },
  { key: 'devices', label: 'Devices' },
  { key: 'password', label: 'Change Password' },
  { key: 'organizations', label: 'Organizations' },
  { key: 'privacy', label: 'Settings & Privacy' },
  { key: 'activity', label: 'Recent Activity' },
];

export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState('overview');
  const [accountOpen, setAccountOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const { data: me, isLoading } = useQuery({ queryKey: ['profile-me'], queryFn: profileApi.me });
  const { data: photo } = useQuery({ queryKey: ['profile-photo'], queryFn: profileApi.photo });
  const { data: devices } = useQuery({ queryKey: ['profile-devices'], queryFn: profileApi.devices, enabled: view === 'devices' });
  const { data: groups } = useQuery({ queryKey: ['profile-groups'], queryFn: profileApi.groups, enabled: view === 'organizations' || groupsOpen });
  const { data: org } = useQuery({ queryKey: ['profile-org'], queryFn: profileApi.organization, enabled: view === 'organizations' });
  const { data: activity } = useQuery({ queryKey: ['profile-activity'], queryFn: profileApi.activity, enabled: view === 'activity' });

  const displayName = me?.displayName || 'User';
  const email = me?.mail || me?.userPrincipalName || '';

  return (
    <div className="profile-page">
      {/* Topbar */}
      <div className="prof-topbar">
        <a className="prof-topbar-nexcp" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>
          <span>NexCP</span><span className="prof-topbar-sep">/</span><span className="prof-topbar-cp">Control Panel</span>
        </a>
        <div className="prof-topbar-right">
          <span className="prof-topbar-admin">{user?.name || 'Administrator'}</span>
          <button className="prof-topbar-logout" onClick={logout}>Logout</button>
        </div>
      </div>

      {/* Main wrap */}
      <div className="prof-main">
        {/* Sidebar */}
        <div className="prof-sidebar">
          <div className="prof-side-profile">
            <div className="prof-side-avatar">
              {photo?.hasPhoto
                ? <img src={photo.data} alt="" />
                : initials(displayName)
              }
            </div>
            <div>
              <div className="prof-side-name">{isLoading ? 'Loading...' : displayName}</div>
              <div className="prof-side-email">{email}</div>
            </div>
          </div>

          {/* My Account section */}
          <div className="prof-side-section">
            <div className="prof-side-header" onClick={() => setAccountOpen(!accountOpen)}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="10" cy="7" r="3.5" /><path d="M3 18c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
              </svg>
              My Account
              <svg className={`chev${accountOpen ? '' : ' collapsed'}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 5l3 3 3-3" />
              </svg>
            </div>
            {accountOpen && (
              <div>
                {sidebarSections.map(s => (
                  <div
                    key={s.key}
                    className={`prof-side-item${view === s.key ? ' active' : ''}`}
                    onClick={() => setView(s.key)}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* My Apps */}
          <a className="prof-side-link" href="/mail" onClick={e => { e.preventDefault(); navigate('/mail'); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <rect x="6" y="6" width="3.5" height="3.5" rx=".5" /><rect x="11" y="6" width="3.5" height="3.5" rx=".5" />
              <rect x="6" y="11" width="3.5" height="3.5" rx=".5" /><rect x="11" y="11" width="3.5" height="3.5" rx=".5" />
            </svg>
            My Apps
          </a>

          {/* My Groups */}
          <div className="prof-side-section" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="prof-side-header" onClick={() => setGroupsOpen(!groupsOpen)}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="10" cy="6" r="3" /><path d="M3 18c0-4 3-6 7-6s7 2 7 6" />
                <circle cx="16" cy="6" r="2" /><circle cx="4" cy="6" r="2" />
              </svg>
              My Groups
              <svg className={`chev${groupsOpen ? '' : ' collapsed'}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 5l3 3 3-3" />
              </svg>
            </div>
            {groupsOpen && (
              <div style={{ padding: '4px 0' }}>
                {(groups?.value || []).length === 0 ? (
                  <div style={{ padding: '8px 48px', fontSize: 12, color: 'var(--text3)' }}>No groups found</div>
                ) : (
                  (groups?.value || []).map((g, i) => (
                    <div key={i} className="prof-side-item">{g.displayName}</div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="prof-content">
          {/* Overview */}
          {view === 'overview' && (
            <>
              <div className="prof-welcome">Welcome back, {displayName.split(' ')[0]}</div>
              <div className="prof-card">
                <div className="prof-avatar-wrap">
                  <div className="prof-avatar-big">
                    {photo?.hasPhoto ? <img src={photo.data} alt="" /> : initials(displayName)}
                  </div>
                </div>
                <div>
                  <div className="prof-name">{displayName}</div>
                  <div className="prof-email">{email}</div>
                  <div className="prof-why">
                    Why can't I edit this?
                    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5l3 3 3-3" /></svg>
                  </div>
                </div>
              </div>

              <div className="prof-section-title">Keep track</div>
              <div className="prof-keep-track">
                <div className="prof-keep-track-emoji">🎉</div>
                <div className="prof-keep-track-text">You're all caught up! You have no pending tasks.</div>
              </div>

              <div className="prof-section-title">Account setup</div>
              <div className="prof-setup-grid">
                <div className="prof-setup-card" onClick={() => setView('security')}>
                  <div className="prof-setup-icon" style={{ background: '#e8f4fd' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0078d4" strokeWidth="1.5">
                      <path d="M12 2l8 4v6c0 5.5-3.5 10-8 11-4.5-1-8-5.5-8-11V6l8-4z" /><path d="M9 12l2 2 4-4" />
                    </svg>
                  </div>
                  <div className="prof-setup-title">Security info</div>
                  <div className="prof-setup-desc">Set up your security verification methods to keep your account safe.</div>
                </div>
                <div className="prof-setup-card" onClick={() => setView('password')}>
                  <div className="prof-setup-icon" style={{ background: '#fdf2e8' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#ca5010" strokeWidth="1.5">
                      <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /><circle cx="12" cy="16" r="1.5" />
                    </svg>
                  </div>
                  <div className="prof-setup-title">Change password</div>
                  <div className="prof-setup-desc">Update your password regularly to help protect your account.</div>
                </div>
                <div className="prof-setup-card" onClick={() => setView('devices')}>
                  <div className="prof-setup-icon" style={{ background: '#e8f9e8' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#107c10" strokeWidth="1.5">
                      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                    </svg>
                  </div>
                  <div className="prof-setup-title">Devices</div>
                  <div className="prof-setup-desc">View and manage devices that are connected to your account.</div>
                </div>
                <div className="prof-setup-card" onClick={() => setView('organizations')}>
                  <div className="prof-setup-icon" style={{ background: '#f3e8f9' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#7719aa" strokeWidth="1.5">
                      <rect x="2" y="6" width="8" height="16" rx="1" /><rect x="14" y="2" width="8" height="20" rx="1" />
                      <path d="M5 10h2M5 14h2M17 6h2M17 10h2M17 14h2" />
                    </svg>
                  </div>
                  <div className="prof-setup-title">Organizations</div>
                  <div className="prof-setup-desc">View the organizations you belong to and manage access.</div>
                </div>
              </div>
            </>
          )}

          {/* Security Info */}
          {view === 'security' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Security Info</div>
              <div className="prof-section-desc">These are the methods you use to sign in to your account or reset your password.</div>
              <div className="prof-detail-row">
                <div className="prof-detail-label">Account status</div>
                <div className="prof-detail-value">{me?.accountEnabled !== undefined ? (me.accountEnabled ? 'Active' : 'Disabled') : '—'}</div>
              </div>
              <div className="prof-detail-row">
                <div className="prof-detail-label">Account created</div>
                <div className="prof-detail-value">{me?.createdDateTime ? formatDate(me.createdDateTime) : '—'}</div>
              </div>
              <div className="prof-detail-row">
                <div className="prof-detail-label">User Principal Name</div>
                <div className="prof-detail-value">{me?.userPrincipalName || '—'}</div>
              </div>
            </>
          )}

          {/* Devices */}
          {view === 'devices' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Devices</div>
              <div className="prof-section-desc">Manage devices connected to your account.</div>
              {!devices ? (
                <div className="prof-spinner" />
              ) : (devices?.value || []).length === 0 ? (
                <div className="prof-detail-empty">No devices found</div>
              ) : (
                <table className="prof-table">
                  <thead>
                    <tr>
                      <th>Device</th><th>OS</th><th>Trust Type</th><th>Last Sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(devices?.value || []).map((d, i) => (
                      <tr key={i}>
                        <td>{d.displayName || '—'}</td>
                        <td>{d.operatingSystem} {d.operatingSystemVersion}</td>
                        <td>{d.trustType || '—'}</td>
                        <td>{formatDate(d.approximateLastSignInDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {/* Change Password */}
          {view === 'password' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Change Password</div>
              <div className="prof-section-desc">Password changes must be done through your organization's portal or via Microsoft directly.</div>
              <a href="https://account.live.com/password/change" target="_blank" rel="noopener noreferrer" className="prof-btn prof-btn-primary">
                Change password on Microsoft
              </a>
            </>
          )}

          {/* Organizations */}
          {view === 'organizations' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Organizations</div>
              <div className="prof-section-desc">Organizations you're a member of.</div>
              {!org ? (
                <div className="prof-spinner" />
              ) : (org?.value || []).length === 0 ? (
                <div className="prof-detail-empty">No organizations found</div>
              ) : (
                (org?.value || []).map((o, i) => (
                  <div key={i} style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{o.displayName}</div>
                    <div className="prof-detail-row">
                      <div className="prof-detail-label">Tenant ID</div>
                      <div className="prof-detail-value">{o.id}</div>
                    </div>
                    <div className="prof-detail-row">
                      <div className="prof-detail-label">Country</div>
                      <div className="prof-detail-value">{o.countryLetterCode || '—'}</div>
                    </div>
                    {o.technicalNotificationMails?.length > 0 && (
                      <div className="prof-detail-row">
                        <div className="prof-detail-label">Tech Contacts</div>
                        <div className="prof-detail-value">{o.technicalNotificationMails.join(', ')}</div>
                      </div>
                    )}
                    {o.verifiedDomains?.length > 0 && (
                      <div className="prof-detail-row">
                        <div className="prof-detail-label">Domains</div>
                        <div className="prof-detail-value">{o.verifiedDomains.map(d => d.name).join(', ')}</div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {/* Settings & Privacy */}
          {view === 'privacy' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Settings & Privacy</div>
              {[
                ['Display Name', me?.displayName],
                ['Job Title', me?.jobTitle],
                ['Department', me?.department],
                ['Office', me?.officeLocation],
                ['Phone', me?.mobilePhone || me?.businessPhones?.[0]],
                ['City', me?.city],
                ['Country', me?.country],
                ['Company', me?.companyName],
              ].map(([label, value]) => (
                <div key={label} className="prof-detail-row">
                  <div className="prof-detail-label">{label}</div>
                  <div className="prof-detail-value">{value || '—'}</div>
                </div>
              ))}
            </>
          )}

          {/* Recent Activity */}
          {view === 'activity' && (
            <>
              <div className="prof-section-title" style={{ paddingTop: 32 }}>Recent Activity</div>
              <div className="prof-section-desc">Recent activity on your account.</div>
              {!activity ? (
                <div className="prof-spinner" />
              ) : (activity?.value || []).length === 0 ? (
                <div className="prof-detail-empty">No recent activity</div>
              ) : (
                <table className="prof-table">
                  <thead>
                    <tr><th>Activity</th><th>App</th><th>IP</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {(activity?.value || []).map((a, i) => (
                      <tr key={i}>
                        <td>{a.activityDisplayName || a.status?.failureReason || '—'}</td>
                        <td>{a.appDisplayName || '—'}</td>
                        <td>{a.ipAddress || '—'}</td>
                        <td>{formatDate(a.createdDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
