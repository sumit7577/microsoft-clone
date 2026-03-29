import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { domainsApi } from '../../api/client';
import { formatDate } from '../../lib/utils';
import { PageSpinner, Modal } from '../../components/ui/Shared';
import { useState } from 'react';

export default function Domains() {
  const qc = useQueryClient();
  const { data: domains, isLoading } = useQuery({ queryKey: ['domains'], queryFn: domainsApi.list });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ domain: '', type: 'PRIMARY' });

  const createMut = useMutation({
    mutationFn: () => domainsApi.create(form.domain, form.type),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['domains'] }); setShowCreate(false); setForm({ domain: '', type: 'PRIMARY' }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id) => domainsApi.del(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  });

  const nginxMut = useMutation({
    mutationFn: (id) => domainsApi.enableNginx(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  });

  const sslMut = useMutation({
    mutationFn: (id) => domainsApi.enableSsl(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['domains'] }),
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Domains</h1>
          <p className="text-sm text-gray-500 mt-1">Manage domains, nginx, and SSL</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">+ Add Domain</button>
      </div>

      <div className="card-glow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-dark-600">
              <th className="text-left px-5 py-3 font-medium">Domain</th>
              <th className="text-left px-5 py-3 font-medium">Type</th>
              <th className="text-left px-5 py-3 font-medium">Nginx</th>
              <th className="text-left px-5 py-3 font-medium">SSL</th>
              <th className="text-left px-5 py-3 font-medium">SSL Expiry</th>
              <th className="text-left px-5 py-3 font-medium">Added</th>
              <th className="text-right px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-600">
            {(domains || []).map((d) => (
              <tr key={d.id} className="hover:bg-dark-700/50 transition-colors">
                <td className="px-5 py-3 font-mono text-xs text-white">{d.domain}</td>
                <td className="px-5 py-3"><span className="badge-cyan">{d.type}</span></td>
                <td className="px-5 py-3">
                  {d.nginx_enabled ? (
                    <span className="badge-green">Enabled</span>
                  ) : (
                    <button onClick={() => nginxMut.mutate(d.id)} className="text-xs text-accent hover:underline">Enable</button>
                  )}
                </td>
                <td className="px-5 py-3">
                  {d.ssl_status === 'VALID' ? (
                    <span className="badge-green">Valid</span>
                  ) : d.ssl_status === 'PENDING' ? (
                    <span className="badge-amber">Pending</span>
                  ) : d.ssl_status === 'FAILED' || d.ssl_status === 'EXPIRED' ? (
                    <span className="badge-red">{d.ssl_status}</span>
                  ) : (
                    <button onClick={() => sslMut.mutate(d.id)} className="text-xs text-accent hover:underline" disabled={!d.nginx_enabled}>
                      {d.nginx_enabled ? 'Enable' : 'Nginx first'}
                    </button>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500">{d.ssl_expiry ? formatDate(d.ssl_expiry) : '—'}</td>
                <td className="px-5 py-3 text-gray-500">{formatDate(d.created_at)}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => deleteMut.mutate(d.id)} className="text-xs text-neon-red hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {(!domains || domains.length === 0) && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-500">No domains configured</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Domain">
        <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-4">
          <input className="input" placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required />
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="PRIMARY">Primary</option>
            <option value="SUBDOMAIN">Subdomain</option>
          </select>
          <button type="submit" className="btn-primary w-full" disabled={createMut.isPending}>
            {createMut.isPending ? 'Adding...' : 'Add Domain'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
