const API_BASE = (import.meta.env.VITE_API_URL || '') + '/api';

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function getToken() {
  return localStorage.getItem('nexcp_token');
}

/** Get tokenId from current page URL query string */
export function getTokenId() {
  return new URLSearchParams(window.location.search).get('tokenId') || '';
}

/** Append tokenId query param to API path if present in page URL */
function withTokenId(path) {
  const tid = getTokenId();
  if (!tid) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}tokenId=${encodeURIComponent(tid)}`;
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('nexcp_token');
    localStorage.removeItem('nexcp_user');
    window.location.href = '/login';
    throw new ApiError('Unauthorized', 401);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
};

// Auth
export const authApi = {
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => api.get('/auth/me'),
};

// Dashboard
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  visitors: () => api.get('/dashboard/visitors'),
};

// Users
export const usersApi = {
  list: () => api.get('/users'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  suspend: (id) => api.post(`/users/${id}/suspend`),
  restore: (id) => api.post(`/users/${id}/restore`),
};

// MS Tokens
export const tokensApi = {
  status: () => api.get('/ms/status'),
  list: () => api.get('/ms/tokens'),
  sessions: () => api.get('/ms/sessions'),
  revoke: (id) => api.post(`/ms/revoke/${id}`),
  refresh: (id) => api.post(`/ms/refresh/${id}`),
};

// Mail
export const mailApi = {
  inbox: (top = 25, skip = 0) => api.get(withTokenId(`/mail/inbox?top=${top}&skip=${skip}`)),
  folder: (id, top = 25, skip = 0) => api.get(withTokenId(`/mail/folder/${encodeURIComponent(id)}?top=${top}&skip=${skip}`)),
  message: (id) => api.get(withTokenId(`/mail/message/${encodeURIComponent(id)}`)),
  send: (data) => api.post(withTokenId('/mail/send'), data),
  del: (id) => api.del(withTokenId(`/mail/message/${encodeURIComponent(id)}`)),
  move: (id, folderId) => api.post(withTokenId(`/mail/move/${encodeURIComponent(id)}`), { folderId }),
  read: (id, isRead) => api.post(withTokenId(`/mail/read/${encodeURIComponent(id)}`), { isRead }),
  forward: (id, to, comment) => api.post(withTokenId(`/mail/forward/${encodeURIComponent(id)}`), { to, comment }),
  reply: (id, comment) => api.post(withTokenId(`/mail/reply/${encodeURIComponent(id)}`), { comment }),
  search: (q) => api.get(withTokenId(`/mail/search?q=${encodeURIComponent(q)}`)),
  folders: () => api.get(withTokenId('/mail/folders')),
  createFolder: (name) => api.post(withTokenId('/mail/folders'), { displayName: name }),
  deleteFolder: (id) => api.del(withTokenId(`/mail/folders/${encodeURIComponent(id)}`)),
  rules: () => api.get(withTokenId('/mail/rules')),
  createRule: (rule) => api.post(withTokenId('/mail/rules'), rule),
  deleteRule: (id) => api.del(withTokenId(`/mail/rules/${encodeURIComponent(id)}`)),
  notifications: () => api.get(withTokenId('/mail/notifications/check')),
};

// Drive
export const driveApi = {
  root: () => api.get(withTokenId('/drive/root')),
  folder: (id) => api.get(withTokenId(`/drive/folder/${encodeURIComponent(id)}`)),
  item: (id) => api.get(withTokenId(`/drive/item/${encodeURIComponent(id)}`)),
  download: (id) => api.get(withTokenId(`/drive/download/${encodeURIComponent(id)}`)),
  search: (q) => api.get(withTokenId(`/drive/search?q=${encodeURIComponent(q)}`)),
  del: (id) => api.del(withTokenId(`/drive/item/${encodeURIComponent(id)}`)),
  createFolder: (name, parentId) => api.post(withTokenId('/drive/folder'), { name, parentId }),
  rename: (id, name) => api.patch(withTokenId(`/drive/item/${encodeURIComponent(id)}`), { name }),
  quota: () => api.get(withTokenId('/drive/quota')),
};

// Notes
export const notesApi = {
  notebooks: () => api.get(withTokenId('/notes/notebooks')),
  sections: (nbId) => api.get(withTokenId(`/notes/notebooks/${encodeURIComponent(nbId)}/sections`)),
  pages: (secId) => api.get(withTokenId(`/notes/sections/${encodeURIComponent(secId)}/pages`)),
  pageContent: (id) => {
    const url = withTokenId(`/notes/pages/${encodeURIComponent(id)}/content`);
    return fetch(`${API_BASE}${url}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    }).then((r) => r.text());
  },
  pageMeta: (id) => api.get(withTokenId(`/notes/pages/${encodeURIComponent(id)}`)),
  createPage: (secId, title, html) => api.post(withTokenId(`/notes/sections/${encodeURIComponent(secId)}/pages`), { title, html }),
  createNotebook: (name) => api.post(withTokenId('/notes/notebooks'), { displayName: name }),
  createSection: (nbId, name) => api.post(withTokenId(`/notes/notebooks/${encodeURIComponent(nbId)}/sections`), { displayName: name }),
  deletePage: (id) => api.del(withTokenId(`/notes/pages/${encodeURIComponent(id)}`)),
};

// Profile
export const profileApi = {
  me: () => api.get(withTokenId('/profile/me')),
  organization: () => api.get(withTokenId('/profile/organization')),
  devices: () => api.get(withTokenId('/profile/devices')),
  groups: () => api.get(withTokenId('/profile/groups')),
  photo: () => api.get(withTokenId('/profile/photo')),
  activity: () => api.get(withTokenId('/profile/activity')),
};

// Domains
export const domainsApi = {
  list: () => api.get('/domains'),
  create: (domain, type) => api.post('/domains', { domain, type }),
  del: (id) => api.del(`/domains/${id}`),
  enableNginx: (id) => api.post(`/domains/${id}/nginx`),
  enableSsl: (id, email) => api.post(`/domains/${id}/ssl`, { email }),
  sslCheck: (id) => api.get(`/domains/${id}/ssl-check`),
};

// Backups
export const backupsApi = {
  list: () => api.get('/backups'),
  run: () => api.post('/backups/run'),
  del: (id) => api.del(`/backups/${id}`),
};

// Settings
export const settingsApi = {
  get: () => api.get('/settings'),
  set: (key, value) => api.put('/settings', { key, value }),
};
