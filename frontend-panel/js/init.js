/**
 * init.js — NexCP Mail startup
 * Auth check, MS account status, bootstrap the app.
 * Has full error handling so the page never stays blank.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.init = (() => {

  async function boot() {
    console.log('[Mail] Booting...');

    const token = Mail.api.getToken();
    if (!token) {
      console.log('[Mail] No NexCP token, showing login');
      Mail.ui.showLoginGate();
      return;
    }

    // Step 1: Verify NexCP session
    try {
      const me = await Mail.api.getMe();
      console.log('[Mail] /api/auth/me response:', me);
      if (!me || me.error) {
        console.log('[Mail] Session invalid, showing login');
        Mail.ui.showLoginGate();
        return;
      }
    } catch (e) {
      console.error('[Mail] Auth check failed:', e);
      Mail.ui.showLoginGate();
      return;
    }

    // Step 2: Check MS account link
    try {
      const ms = await Mail.api.getMsStatus();
      console.log('[Mail] /api/ms/status response:', ms);
      if (!ms || ms.status !== 'active') {
        console.log('[Mail] No active MS token, showing link prompt');
        Mail.ui.showNoToken();
        return;
      }

      // Show account info in topbar
      const acctEl = Mail.ui.$('ms-account');
      if (acctEl) acctEl.textContent = ms.ms_email || ms.ms_name || 'Linked';
      const avEl = Mail.ui.$('topbar-avatar');
      if (avEl) { const e = ms.ms_email || ms.ms_name || '?'; avEl.textContent = e.slice(0,2).toUpperCase(); }
    } catch (e) {
      console.error('[Mail] MS status check failed:', e);
      Mail.ui.showNoToken();
      return;
    }

    // Step 3: Show the mail app layout
    console.log('[Mail] Showing app...');
    Mail.ui.showApp();

    // Step 4: Load folders + inbox (don't let one failure block the other)
    try {
      await Promise.allSettled([
        Mail.folders.load(),
        Mail.inbox.loadInbox()
      ]);
      console.log('[Mail] Boot complete');
    } catch (e) {
      console.error('[Mail] Load error:', e);
      // App is still visible, user can retry with refresh button
    }
  }

  async function gateLogin() {
    const user = Mail.ui.$('gate-user').value.trim();
    const pass = Mail.ui.$('gate-pass').value;
    const err  = Mail.ui.$('gate-err');
    err.style.display = 'none';

    if (!user || !pass) {
      err.textContent = 'Username and password required';
      err.style.display = 'block';
      return;
    }

    try {
      await Mail.api.login(user, pass);
      boot();
    } catch (e) {
      err.textContent = e.message;
      err.style.display = 'block';
    }
  }

  return { boot, gateLogin };
})();

// ── Wire up on DOM ready ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Login enter key
  const passEl = Mail.ui.$('gate-pass');
  if (passEl) passEl.addEventListener('keydown', e => { if (e.key === 'Enter') Mail.init.gateLogin(); });

  const userEl = Mail.ui.$('gate-user');
  if (userEl) userEl.addEventListener('keydown', e => { if (e.key === 'Enter') Mail.init.gateLogin(); });

  // Search enter key
  const searchEl = Mail.ui.$('search-input');
  if (searchEl) searchEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') Mail.inbox.search(searchEl.value);
  });

  // Boot
  Mail.init.boot();
});
