/**
 * utils/clipboard.js
 * Copies text to the clipboard with a fallback for pages where the
 * async Clipboard API is blocked, and shows a small toast notification
 * inside a Shadow DOM host so site CSS can't interfere with it.
 */
(function () {
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      return legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.top = '-1000px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch (err) {
      console.error('[AICC] Clipboard fallback failed:', err);
      return false;
    }
  }

  let toastHost = null;
  function getToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.id = 'aicc-toast-host';
    toastHost.style.position = 'fixed';
    toastHost.style.zIndex = '2147483647';
    toastHost.style.bottom = '24px';
    toastHost.style.right = '24px';
    toastHost.style.pointerEvents = 'none';
    document.documentElement.appendChild(toastHost);
    return toastHost;
  }

  function showToast(message, type = 'success') {
    const host = getToastHost();
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      .toast {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        color: #fff;
        background: ${type === 'error' ? '#3f1d1d' : '#1f2430'};
        border: 1px solid ${type === 'error' ? '#7a3030' : '#3a4150'};
        padding: 10px 14px;
        border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35);
        max-width: 280px;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 160ms ease, transform 160ms ease;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
    `;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    root.appendChild(style);
    root.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => host.remove(), 200);
    }, 2600);
  }

  window.AICC = window.AICC || {};
  window.AICC.clipboard = { copyText, showToast };
})();
