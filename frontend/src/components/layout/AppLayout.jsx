import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <div className="flex-1 ml-16">
        {/* Top bar */}
        <header className="h-12 border-b border-dark-600 bg-dark-800/50 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-40">
          <div className="text-sm text-gray-400">
            NexCP <span className="text-dark-500 mx-1">|</span>{' '}
            <span className="text-gray-500">Control Panel</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{user?.name || user?.username}</span>
            <button onClick={logout} className="text-xs text-gray-500 hover:text-neon-red transition-colors">
              Logout
            </button>
          </div>
        </header>
        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
