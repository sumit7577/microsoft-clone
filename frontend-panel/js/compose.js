/**
 * compose.js — NexCP Mail compose/reply/forward
 * Manages the compose overlay window.
 */

var Mail = window.Mail || (window.Mail = {});

Mail.compose = (() => {

  function open(to, subject, body, title, cc) {
    Mail.ui.$('c-to').value      = to || '';
    Mail.ui.$('c-cc').value      = cc || '';
    Mail.ui.$('c-subject').value = subject || '';
    Mail.ui.$('c-body').value    = body || '';
    Mail.ui.$('compose-title').textContent = title || 'New message';
    Mail.ui.$('compose-overlay').classList.remove('hidden');
    setTimeout(() => {
      Mail.ui.$(to ? 'c-body' : 'c-to').focus();
    }, 50);
  }

  function close() {
    Mail.ui.$('compose-overlay').classList.add('hidden');
  }

  async function send() {
    const to   = Mail.ui.$('c-to').value.trim();
    const cc   = Mail.ui.$('c-cc').value.trim();
    const subj = Mail.ui.$('c-subject').value.trim();
    const body = Mail.ui.$('c-body').value.trim();

    if (!to || !subj) {
      alert('To and Subject are required');
      return;
    }

    const btn = Mail.ui.$('send-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const htmlBody = body.replace(/\n/g, '<br>');
    const res = await Mail.api.sendMail(to, cc, subj, htmlBody);

    btn.disabled = false;
    btn.textContent = 'Send';

    if (res?.ok) {
      close();
      Mail.ui.showToast('Email sent!');
    } else {
      Mail.ui.showToast('Send failed: ' + (res?.error || 'unknown'), 'red');
    }
  }

  return { open, close, send };
})();
