import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/client';
import { formatDate, initials } from '../../lib/utils';
import { PageSpinner, Modal } from '../../components/ui/Shared';
import { useState } from 'react';

export default function Users() {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', role: 'Viewer' });

  const createMut = useMutation({
    mutationFn: (data) => usersApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); setForm({ username: '', name: '', email: '', password: '', role: 'Viewer' }); },
  });

  const suspendMut = useMutation({
    mutationFn: (id) => usersApi.suspend(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const restoreMut = useMutation({
    mutationFn: (id) => usersApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-gray-500 mt-1">Manage panel access</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">+ New User</button>
      </div>

      <div className="card-glow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-dark-600">
              <th className="text-left px-5 py-3 font-medium">User</th>
              <th className="text-left px-5 py-3 font-medium">Email</th>
              <th className="text-left px-5 py-3 font-medium">Role</th>
              <th className="text-left px-5 py-3 font-medium">Status</th>
              <th className="text-left px-5 py-3 font-medium">Last Seen</th>
              <th className="text-right px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-600">
            {(users || []).map((u) => (
              <tr key={u.id} className="hover:bg-dark-700/50 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
                      {initials(u.name)}
                    </div>
                    <div>
                      <div className="font-medium text-white">{u.name}</div>
                      <div className="text-xs text-gray-500">@{u.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-400">{u.email}</td>
                <td className="px-5 py-3"><span className="badge-cyan">{u.role}</span></td>
                <td className="px-5 py-3">
                  <span className={u.status === 'active' ? 'badge-green' : 'badge-red'}>{u.status}</span>
                </td>
                <td className="px-5 py-3 text-gray-500">{formatDate(u.last_seen)}</td>
                <td className="px-5 py-3 text-right">
                  {u.status === 'active' ? (
                    <button onClick={() => suspendMut.mutate(u.id)} className="text-xs text-neon-red hover:underline">Suspend</button>
                  ) : (
                    <button onClick={() => restoreMut.mutate(u.id)} className="text-xs text-neon-green hover:underline">Restore</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create User">
        <form
          onSubmit={(e) => { e.preventDefault(); createMut.mutate(form); }}
          className="space-y-4"
        >
          <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <input className="input" placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="Viewer">Viewer</option>
            <option value="Operator">Operator</option>
            <option value="Administrator">Administrator</option>
          </select>
          <button type="submit" className="btn-primary w-full" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating...' : 'Create User'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
