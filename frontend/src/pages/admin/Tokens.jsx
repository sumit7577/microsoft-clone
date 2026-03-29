import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tokensApi } from '../../api/client';
import { formatDate } from '../../lib/utils';
import { PageSpinner } from '../../components/ui/Shared';

export default function Tokens() {
  const qc = useQueryClient();
  const { data: tokens, isLoading } = useQuery({ queryKey: ['tokens'], queryFn: tokensApi.list });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: tokensApi.sessions, refetchInterval: 10_000 });

  const revokeMut = useMutation({
    mutationFn: (id) => tokensApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  });

  const refreshMut = useMutation({
    mutationFn: (id) => tokensApi.refresh(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Microsoft Tokens</h1>
        <p className="text-sm text-gray-500 mt-1">Linked accounts & active sessions</p>
      </div>

      {/* Tokens table */}
      <div className="card-glow overflow-hidden">
        <div className="px-5 py-3 border-b border-dark-600 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Linked Accounts</h2>
          <span className="text-xs text-gray-500">{tokens?.length || 0} accounts</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-dark-600">
                <th className="text-left px-5 py-3 font-medium">Email</th>
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Linked</th>
                <th className="text-left px-5 py-3 font-medium">Expires</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-600">
              {(tokens || []).map((t) => (
                <tr key={t.id} className="hover:bg-dark-700/50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-gray-300">{t.ms_email}</td>
                  <td className="px-5 py-3 text-gray-400">{t.ms_name || '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{formatDate(t.linked_at)}</td>
                  <td className="px-5 py-3 text-gray-500">{t.seconds_left > 0 ? `${Math.floor(t.seconds_left / 60)}m` : 'Expired'}</td>
                  <td className="px-5 py-3">
                    <span className={t.status === 'active' ? 'badge-green' : 'badge-red'}>{t.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right space-x-2">
                    <button onClick={() => refreshMut.mutate(t.id)} className="text-xs text-accent hover:underline" disabled={refreshMut.isPending}>Refresh</button>
                    <button onClick={() => revokeMut.mutate(t.id)} className="text-xs text-neon-red hover:underline" disabled={revokeMut.isPending}>Revoke</button>
                  </td>
                </tr>
              ))}
              {(!tokens || tokens.length === 0) && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No linked accounts</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="card-glow overflow-hidden">
        <div className="px-5 py-3 border-b border-dark-600 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Device Code Sessions</h2>
          <span className="text-xs text-gray-500">Last 2 hours</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-dark-600">
                <th className="text-left px-5 py-3 font-medium">Session</th>
                <th className="text-left px-5 py-3 font-medium">Code</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Email</th>
                <th className="text-left px-5 py-3 font-medium">Created</th>
                <th className="text-left px-5 py-3 font-medium">TTL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-600">
              {(sessions || []).map((s) => (
                <tr key={s.session_key} className="hover:bg-dark-700/50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{s.session_key_short}</td>
                  <td className="px-5 py-3 font-mono text-xs text-accent">{s.user_code}</td>
                  <td className="px-5 py-3">
                    <span className={
                      s.status === 'success' ? 'badge-green' :
                      s.status === 'pending' ? 'badge-amber' : 'badge-red'
                    }>{s.status}</span>
                  </td>
                  <td className="px-5 py-3 text-gray-400">{s.ms_email || '—'}</td>
                  <td className="px-5 py-3 text-gray-500">{formatDate(s.created_at)}</td>
                  <td className="px-5 py-3 text-gray-500">{s.seconds_left > 0 ? `${Math.floor(s.seconds_left / 60)}m ${s.seconds_left % 60}s` : '—'}</td>
                </tr>
              ))}
              {(!sessions || sessions.length === 0) && (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No recent sessions</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
