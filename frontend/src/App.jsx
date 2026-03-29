import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/admin/Users';
import Tokens from './pages/admin/Tokens';
import Domains from './pages/admin/Domains';
import Backups from './pages/admin/Backups';
import Settings from './pages/admin/Settings';
import MailLayout from './pages/mail/MailLayout';
import Drive from './pages/drive/Drive';
import Notes from './pages/notes/Notes';
import Profile from './pages/profile/Profile';

function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Full-page routes (no sidebar/header) */}
      <Route path="mail/*" element={<PrivateRoute><MailLayout /></PrivateRoute>} />
      <Route path="drive" element={<PrivateRoute><Drive /></PrivateRoute>} />
      <Route path="notes" element={<PrivateRoute><Notes /></PrivateRoute>} />
      <Route path="profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
      {/* Routes with sidebar + header */}
      <Route
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="admin/users" element={<Users />} />
        <Route path="admin/tokens" element={<Tokens />} />
        <Route path="admin/domains" element={<Domains />} />
        <Route path="admin/backups" element={<Backups />} />
        <Route path="admin/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
