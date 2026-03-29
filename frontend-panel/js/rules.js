/**
 * rules.js — NexCP Mail rules management
 * Create, list, delete Outlook inbox rules (auto-delete, auto-move, etc.)
 */

var Mail = window.Mail || (window.Mail = {});

Mail.rules = (() => {
  let rules = [];

  async function load() {
    const data = await Mail.api.getRules();
    rules = data?.value || [];
    return rules;
  }

  function openPanel() {
    const overlay = Mail.ui.$('rules-overlay');
    overlay.classList.remove('hidden');
    _renderRules();
    load().then(() => _renderRules());
  }

  function closePanel() {
    Mail.ui.$('rules-overlay').classList.add('hidden');
  }

  function _renderRules() {
    const list = Mail.ui.$('rules-list');
    if (!rules.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2);font-size:12px">No inbox rules yet</div>';
      return;
    }

    list.innerHTML = rules.map(r => {
      const conditions = _describeConditions(r.conditions);
      const actions    = _describeActions(r.actions);
      const enabled    = r.isEnabled !== false;

      return `<div class="rule-item">
        <div class="rule-header">
          <span class="rule-name">${Mail.ui.esc(r.displayName || 'Unnamed rule')}</span>
          <span class="pill ${enabled ? 'green' : 'gray'}">${enabled ? 'ON' : 'OFF'}</span>
          <button class="btn btn-sm" style="margin-left:auto;border-color:var(--red);color:var(--red)" onclick="Mail.rules.remove('${Mail.ui.esc(r.id)}')">Delete</button>
        </div>
        <div class="rule-detail">
          <span style="color:var(--text2)">If:</span> ${conditions}
        </div>
        <div class="rule-detail">
          <span style="color:var(--text2)">Then:</span> ${actions}
        </div>
      </div>`;
    }).join('');
  }

  function _describeConditions(c) {
    if (!c) return '<em>No conditions</em>';
    const parts = [];
    if (c.senderContains?.length)      parts.push('Sender contains: ' + c.senderContains.join(', '));
    if (c.subjectContains?.length)     parts.push('Subject contains: ' + c.subjectContains.join(', '));
    if (c.bodyContains?.length)        parts.push('Body contains: ' + c.bodyContains.join(', '));
    if (c.fromAddresses?.length)       parts.push('From: ' + c.fromAddresses.map(a => a.emailAddress?.address).join(', '));
    if (c.sentToAddresses?.length)     parts.push('Sent to: ' + c.sentToAddresses.map(a => a.emailAddress?.address).join(', '));
    if (c.headerContains?.length)      parts.push('Header contains: ' + c.headerContains.join(', '));
    if (c.hasAttachments)              parts.push('Has attachments');
    if (c.importance)                  parts.push('Importance: ' + c.importance);
    return parts.length ? parts.map(p => Mail.ui.esc(p)).join(' &amp; ') : '<em>Any message</em>';
  }

  function _describeActions(a) {
    if (!a) return '<em>No actions</em>';
    const parts = [];
    if (a.delete)                      parts.push('🗑️ Delete');
    if (a.permanentDelete)             parts.push('🗑️ Permanently delete');
    if (a.moveToFolder)                parts.push('📁 Move to folder');
    if (a.copyToFolder)                parts.push('📋 Copy to folder');
    if (a.markAsRead)                  parts.push('📧 Mark as read');
    if (a.markImportance)              parts.push('⭐ Set importance: ' + a.markImportance);
    if (a.forwardTo?.length)           parts.push('↪ Forward to: ' + a.forwardTo.map(r => r.emailAddress?.address).join(', '));
    if (a.redirectTo?.length)          parts.push('↪ Redirect to: ' + a.redirectTo.map(r => r.emailAddress?.address).join(', '));
    if (a.stopProcessingRules)         parts.push('⏹ Stop processing more rules');
    return parts.length ? parts.map(p => Mail.ui.esc(p)).join(', ') : '<em>None</em>';
  }

  // ── Create rule wizard ─────────────────────────────────────────────────

  function openCreateForm() {
    Mail.ui.$('rule-create-form').classList.remove('hidden');
    Mail.ui.$('rule-create-form').scrollIntoView({ behavior: 'smooth' });
    // Populate folder select
    const sel = Mail.ui.$('rule-move-folder');
    const folders = Mail.folders.getAll();
    sel.innerHTML = '<option value="">— Don\'t move —</option>' +
      folders.map(f => `<option value="${Mail.ui.esc(f.id)}">${Mail.ui.esc(f.displayName)}</option>`).join('');
  }

  function closeCreateForm() {
    Mail.ui.$('rule-create-form').classList.add('hidden');
  }

  async function submitCreate() {
    const name        = Mail.ui.$('rule-name').value.trim();
    const fromAddr    = Mail.ui.$('rule-from').value.trim();
    const subjectText = Mail.ui.$('rule-subject').value.trim();
    const actionType  = Mail.ui.$('rule-action').value;
    const moveFolder  = Mail.ui.$('rule-move-folder').value;

    if (!name) { alert('Rule name is required'); return; }
    if (!fromAddr && !subjectText) { alert('At least one condition is required (From or Subject)'); return; }

    // Build rule object per Graph API spec
    const rule = {
      displayName: name,
      sequence: 1,
      isEnabled: true,
      conditions: {},
      actions: {
        stopProcessingRules: true
      }
    };

    // Conditions
    if (fromAddr) {
      rule.conditions.senderContains = [fromAddr];
    }
    if (subjectText) {
      rule.conditions.subjectContains = [subjectText];
    }

    // Actions
    if (actionType === 'delete') {
      rule.actions.delete = true;
    } else if (actionType === 'read') {
      rule.actions.markAsRead = true;
    } else if (actionType === 'move' && moveFolder) {
      rule.actions.moveToFolder = moveFolder;
    } else if (actionType === 'move' && !moveFolder) {
      alert('Select a folder to move to');
      return;
    }

    const btn = Mail.ui.$('rule-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    const r = await Mail.api.createRule(rule);
    btn.disabled = false;
    btn.textContent = 'Create Rule';

    if (r?.id || r?.displayName) {
      Mail.ui.showToast('Rule created!');
      closeCreateForm();
      load().then(() => _renderRules());
    } else {
      Mail.ui.showToast('Failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  async function remove(ruleId) {
    if (!Mail.ui.confirm('Delete this inbox rule?')) return;
    const r = await Mail.api.deleteRule(ruleId);
    if (r?.ok) {
      Mail.ui.showToast('Rule deleted', 'amber');
      load().then(() => _renderRules());
    } else {
      Mail.ui.showToast('Failed: ' + (r?.error || 'unknown'), 'red');
    }
  }

  return { load, openPanel, closePanel, openCreateForm, closeCreateForm, submitCreate, remove };
})();
