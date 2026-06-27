/**
 * popup/ui.js
 */
const planValue = document.getElementById('plan-value');
const accountValue = document.getElementById('account-value');
const usageValue = document.getElementById('usage-value');
const activateCard = document.getElementById('activate-card');

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refreshStatus() {
  const status = await send({ type: 'AICC_GET_STATUS' });

  if (status.localOnly) {
    planValue.textContent = 'Local (no limits)';
    accountValue.textContent = 'Not connected';
    usageValue.textContent = 'Unlimited';
    activateCard.hidden = true;
    return;
  }

  planValue.textContent = status.plan ? status.plan.toUpperCase() : '—';
  accountValue.textContent = status.email || 'Anonymous';
  usageValue.textContent = status.plan === 'pro' ? 'Unlimited' : (status.usage_stats?.exportsToday ?? 0);

  activateCard.hidden = !!status.activated;
}

document.getElementById('activate-btn').addEventListener('click', async () => {
  const key = document.getElementById('license-key').value.trim();
  const errorEl = document.getElementById('activate-error');
  errorEl.hidden = true;

  const result = await send({ type: 'AICC_ACTIVATE_KEY', key });
  if (result.success) {
    await refreshStatus();
  } else {
    errorEl.textContent = result.error || 'Invalid license key.';
    errorEl.hidden = false;
  }
});

document.getElementById('free-btn').addEventListener('click', async () => {
  await send({ type: 'AICC_ACTIVATE_FREE' });
  await refreshStatus();
});

document.getElementById('signin-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('signin-error');
  errorEl.hidden = true;

  if (!email || !password) {
    errorEl.textContent = 'Enter both email and password.';
    errorEl.hidden = false;
    return;
  }

  // Try sign-in first; if that fails (likely a brand-new email), try
  // upgrading the current anonymous session into a real account instead.
  let result = await send({ type: 'AICC_SIGN_IN', email, password });
  if (!result.success) {
    result = await send({ type: 'AICC_UPGRADE_TO_EMAIL', email, password });
  }

  if (result.success) {
    await refreshStatus();
  } else {
    errorEl.textContent = result.error || 'Sign-in failed.';
    errorEl.hidden = false;
  }
});

// "How to use" drawer — opens a modal with quick instructions.
(function () {
  const trigger = document.getElementById('howto-trigger');
  const modal = document.getElementById('howto-modal');
  const closeBtn = document.getElementById('howto-close');
  if (!trigger || !modal || !closeBtn) return;

  function open() {
    modal.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    closeBtn.focus();
  }
  function close() {
    modal.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }

  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();

refreshStatus();
