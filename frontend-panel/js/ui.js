/**
 * ui.js — NexCP Mail UI utilities
 * Toast notifications, HTML escaping, date formatting, screen switching.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.ui = (() => {

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatDate(dt) {
    if (!dt) return '';
    const d = new Date(dt), now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    if (d.getFullYear() === now.getFullYear())
      return d.toLocaleDateString([], { month:'short', day:'numeric' });
    return d.toLocaleDateString([], { month:'short', day:'numeric', year:'2-digit' });
  }

  function showToast(msg, type = 'green') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.borderColor = type === 'red' ? 'var(--red)' : type === 'amber' ? 'var(--amber)' : 'var(--green)';
    el.style.color       = type === 'red' ? 'var(--red)' : type === 'amber' ? 'var(--amber)' : 'var(--green)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3000);
  }

  function $(id) { return document.getElementById(id); }

  function showLoginGate() {
    $('login-gate').classList.remove('hidden');
    $('login-gate').style.display = 'flex';
    $('mail-app').style.display   = 'none';
    $('no-token').classList.add('hidden');
    $('no-token').style.display   = 'none';
  }

  function showNoToken() {
    $('no-token').classList.remove('hidden');
    $('no-token').style.display   = 'flex';
    $('mail-app').style.display   = 'none';
    $('login-gate').style.display = 'none';
  }

  function showApp() {
    $('mail-app').style.display   = 'flex';
    $('login-gate').style.display = 'none';
    $('no-token').style.display   = 'none';
  }

  function spinner() {
    return '<div style="display:flex;align-items:center;justify-content:center;padding:40px"><div class="spinner"></div></div>';
  }

  function confirm(msg) {
    return window.confirm(msg);
  }

  return { esc, formatDate, showToast, $, showLoginGate, showNoToken, showApp, spinner, confirm };
})();
