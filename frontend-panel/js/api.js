/**
 * api.js — NexCP Mail API layer
 * All backend calls go through here. Easy to modify auth, base URL, error handling.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.api = (() => {
  function getToken() {
    return localStorage.getItem('nexcp_token') || '';
  }
  function setToken(t) {
    localStorage.setItem('nexcp_token', t);
  }
  function clearToken() {
    localStorage.removeItem('nexcp_token');
  }

  async function call(method, path, body) {
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer ' + getToken(),
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(path, opts);
      if (res.status === 401) {
        Mail.ui.showLoginGate();
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[API] ${method} ${path} failed:`, e);
      return { error: e.message };
    }
  }

  // Convenience wrappers
  const get    = (path) => call('GET', path);
  const post   = (path, body) => call('POST', path, body);
  const del    = (path) => call('DELETE', path);
  const patch  = (path, body) => call('PATCH', path, body);

  // Auth
  async function login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token);
    return data;
  }

  async function getMe() {
    return get('/api/auth/me');
  }

  async function getMsStatus() {
    return get('/api/ms/status');
  }

  // Mail
  async function getInbox(top = 25, skip = 0) {
    return get(`/api/mail/inbox?top=${top}&skip=${skip}`);
  }

  async function getFolderMessages(folderId, top = 25, skip = 0) {
    return get(`/api/mail/folder/${encodeURIComponent(folderId)}?top=${top}&skip=${skip}`);
  }

  async function getMessage(id) {
    return get(`/api/mail/message?id=${encodeURIComponent(id)}`);
  }

  async function sendMail(to, cc, subject, body) {
    return post('/api/mail/send', { to, cc, subject, body });
  }

  async function deleteMessage(id) {
    return post('/api/mail/delete', { id });
  }

  async function moveMessage(id, folderId) {
    return post('/api/mail/move', { id, folderId });
  }

  async function markRead(id, isRead = true) {
    return post('/api/mail/read', { id, isRead });
  }

  async function forwardMessage(id, to, comment) {
    return post('/api/mail/forward', { id, to, comment });
  }

  async function replyMessage(id, comment) {
    return post('/api/mail/reply', { id, comment });
  }

  async function searchMail(q) {
    return get(`/api/mail/search?q=${encodeURIComponent(q)}`);
  }

  // Folders
  async function getFolders() {
    return get('/api/mail/folders');
  }

  async function createFolder(displayName) {
    return post('/api/mail/folders', { displayName });
  }

  async function deleteFolder(folderId) {
    return del(`/api/mail/folders/${encodeURIComponent(folderId)}`);
  }

  // Rules
  async function getRules() {
    return get('/api/mail/rules');
  }

  async function createRule(rule) {
    return post('/api/mail/rules', rule);
  }

  async function deleteRule(ruleId) {
    return del(`/api/mail/rules/${encodeURIComponent(ruleId)}`);
  }

  return {
    getToken, setToken, clearToken, call, get, post, del, patch,
    login, getMe, getMsStatus,
    getInbox, getFolderMessages, getMessage, sendMail, deleteMessage,
    moveMessage, markRead, forwardMessage, replyMessage, searchMail,
    getFolders, createFolder, deleteFolder,
    getRules, createRule, deleteRule
  };
})();
