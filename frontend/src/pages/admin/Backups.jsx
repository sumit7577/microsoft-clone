import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { backupsApi } from '../../api/client';
import { formatDate, formatBytes } from '../../lib/utils';
import { PageSpinner } from '../../components/ui/Shared';

export default function Backups() {
  const qc = useQueryClient();
  const { data: backups, isLoading } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.list });

  const runMut = useMutation({
    mutationFn: backupsApi.run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => backupsApi.del(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Backups</h1>
          <p className="text-sm text-gray-500 mt-1">Database backup management</p>
        </div>
        <button onClick={() => runMut.mutate()} className="btn-primary" disabled={runMut.isPending}>
          {runMut.isPending ? 'Running...' : '↻ Run Backup'}
        </button>
      </div>

      <div className="card-glow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-dark-600">
              <th className="text-left px-5 py-3 font-medium">Type</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Size</th>
              <th className="text-left px-5 py-3 font-medium">Created</th>
              <th className="text-right px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-600">
            {(backups || []).map((b) => (
              <tr key={b.id} className="hover:bg-dark-700/50 transition-colors">
                <td className="px-5 py-3"><span className="badge-cyan">{b.type}</span></td>
                <td className="px-5 py-3">
                  <span className={b.status === 'success' ? 'badge-green' : 'badge-amber'}>{b.status}</span>
                </td>
                <td className="px-5 py-3 text-gray-400 font-mono text-xs">{formatBytes(b.size_bytes)}</td>
                <td className="px-5 py-3 text-gray-500">{formatDate(b.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => deleteMut.mutate(b.id)} className="text-xs text-neon-red hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {(!backups || backups.length === 0) && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">No backups yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
