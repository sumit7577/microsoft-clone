import { createContext, useContext, useState, useCallback } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('nexcp_token'));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nexcp_user')); } catch { return null; }
  });

  const login = useCallback(async (username, password) => {
    const data = await authApi.login(username, password);
    localStorage.setItem('nexcp_token', data.token);
    localStorage.setItem('nexcp_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('nexcp_token');
    localStorage.removeItem('nexcp_user');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
