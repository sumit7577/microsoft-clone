import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui/Shared';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center">
            <span className="text-accent font-bold text-xl">N</span>
          </div>
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-semibold text-center mb-6">Sign In</h1>

          {error && (
            <div className="mb-4 px-3 py-2 bg-neon-red/10 border border-neon-red/20 rounded-lg text-neon-red text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Username</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent text-dark-900 font-semibold rounded-lg hover:bg-accent/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size="sm" /> : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-dark-500 mt-6">NexCP v5.0</p>
      </div>
    </div>
  );
}
