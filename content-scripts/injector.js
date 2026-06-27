/**
 * content-scripts/injector.js
 *
 * Injects a small floating control (Shadow DOM, so site CSS can't touch
 * it and it can't touch the site) near the chat input box. Re-anchors
 * itself as the SPA re-renders, using a MutationObserver.
 *
 * FIXES vs. original:
 *  - Detached-anchor handling: after an SPA re-render the old anchor is
 *    gone from the DOM; we now check isConnected + visibility before
 *    positioning, and clear currentAnchor so the next tick re-probes.
 *  - MutationObserver debounced via requestAnimationFrame: observing
 *    document.body subtree fires hundreds of times/sec on busy SPAs
 *    (ChatGPT/Claude stream tokens in). The old code called tryAnchor()
 *    on every mutation, causing button flicker + layout thrash.
 *  - Scroll handler debounced via requestAnimationFrame for the same reason.
 *  - Position clamped to viewport so the button can't be pushed off-screen
 *    when the input sits near the top of the viewport.
 *  - Hides the button when the anchor is not visible (rect 0×0) instead of
 *    leaving it stranded at (0,0).
 */
(function () {
  const HOST_ID = 'aicc-floating-host';
  let currentAnchor = null;
  let host = null;
  let shadowRoot = null;
  let rafScheduled = false;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return host;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.display = 'none';
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
    renderShell();
    return host;
  }

  function renderShell() {
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        gap: 6px;
        background: #1f2430;
        border: 1px solid #3a4150;
        border-radius: 999px;
        padding: 6px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      }
      button {
        all: unset;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #e7e9ee;
        font-size: 12px;
        font-weight: 600;
        padding: 7px 11px;
        border-radius: 999px;
        transition: background 120ms ease;
        white-space: nowrap;
      }
      button:hover { background: #2c3242; }
      button:active { background: #383f52; }
      .icon { width: 14px; height: 14px; flex: none; }
      .divider { width: 1px; height: 18px; background: #3a4150; }
      .modal-overlay {
        all: initial;
        position: fixed; inset: 0;
        background: rgba(10, 12, 16, 0.6);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .modal {
        background: #1a1d24;
        border: 1px solid #343b48;
        border-radius: 14px;
        padding: 22px;
        width: 320px;
        color: #e7e9ee;
      }
      .modal h2 { font-size: 15px; margin: 0 0 8px; }
      .modal p { font-size: 12.5px; color: #9aa3b2; line-height: 1.5; margin: 0 0 14px; }
      .modal input {
        all: unset;
        display: block;
        width: 100%;
        box-sizing: border-box;
        background: #11141a;
        border: 1px solid #3a4150;
        border-radius: 8px;
        padding: 9px 10px;
        font-size: 13px;
        color: #fff;
        margin-bottom: 10px;
      }
      .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .btn-primary, .btn-secondary {
        all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600;
        padding: 8px 14px; border-radius: 8px;
      }
      .btn-primary { background: #5b7cff; color: #fff; }
      .btn-primary:hover { background: #4a6bef; }
      .btn-secondary { color: #9aa3b2; }
      .btn-secondary:hover { color: #fff; }
      .error-text { color: #ff8585; font-size: 12px; margin: -4px 0 10px; }
    `;

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <button data-action="export" title="Export full conversation as JSON">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>
      <div class="divider"></div>
      <button data-action="copy" title="Copy continuation prompt to clipboard">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Continue Chat
      </button>
    `;

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(panel);

    panel.querySelector('[data-action="export"]').addEventListener('click', () => handleAction('export'));
    panel.querySelector('[data-action="copy"]').addEventListener('click', () => handleAction('copy'));
  }

  function positionNearAnchor(anchor) {
    if (!anchor || !anchor.isConnected) {
      host.style.display = 'none';
      currentAnchor = null;
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      host.style.display = 'none';
      return;
    }
    // Position BELOW the chat input box. If there isn't enough room below
    // (common on sites whose input hugs the bottom of the viewport), fall
    // back to above so the button always stays on-screen.
    const panelWidth = 250; // approx; panel is ~230-260px wide
    const panelHeight = 36;
    const gap = 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    let top;
    if (spaceBelow >= panelHeight) {
      // Enough room below the chatbox — place it there.
      top = rect.bottom + gap;
    } else {
      // Not enough room below — flip to above the chatbox.
      top = Math.max(8, rect.top - panelHeight - gap);
    }
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.display = 'block';
  }

  async function handleAction(action) {
    const status = await chrome.runtime.sendMessage({ type: 'AICC_GET_STATUS' });

    if (!status?.activated) {
      showActivationModal();
      return;
    }
    if (!status.allowed) {
      window.AICC.clipboard.showToast(
        status.reason || 'Daily export limit reached. Upgrade to Pro for unlimited exports.',
        'error'
      );
      return;
    }

    const conversation = window.AICC.extractor.extractConversation();
    if (!conversation || !conversation.messages.length) {
      window.AICC.clipboard.showToast('No conversation found on this page yet.', 'error');
      return;
    }

    if (action === 'export') {
      const json = window.AICC.formatter.buildJsonExport(conversation);
      const ok = await window.AICC.clipboard.copyText(JSON.stringify(json, null, 2));
      window.AICC.clipboard.showToast(
        ok ? 'Conversation JSON copied to clipboard.' : 'Could not copy. See console for details.',
        ok ? 'success' : 'error'
      );
    } else {
      const prompt = window.AICC.formatter.buildContinuationPrompt(conversation);
      const ok = await window.AICC.clipboard.copyText(prompt);
      window.AICC.clipboard.showToast(
        ok ? 'Conversation copied. Paste into a new chat to continue.' : 'Could not copy. See console for details.',
        ok ? 'success' : 'error'
      );
    }

    chrome.runtime.sendMessage({ type: 'AICC_RECORD_EXPORT' });
  }

  function showActivationModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>Activate AI Chat Continuator</h2>
        <p>Enter your license key, or continue with a free account to use limited daily exports.</p>
        <input type="text" placeholder="License key (optional)" id="aicc-key-input" />
        <div class="error-text" id="aicc-error" style="display:none;"></div>
        <div class="modal-actions">
          <button class="btn-secondary" id="aicc-cancel">Use free plan</button>
          <button class="btn-primary" id="aicc-activate">Activate</button>
        </div>
      </div>
    `;
    shadowRoot.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#aicc-cancel').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'AICC_ACTIVATE_FREE' });
      close();
    });
    overlay.querySelector('#aicc-activate').addEventListener('click', async () => {
      const key = overlay.querySelector('#aicc-key-input').value.trim();
      const errorEl = overlay.querySelector('#aicc-error');
      const result = await chrome.runtime.sendMessage({ type: 'AICC_ACTIVATE_KEY', key });
      if (result?.success) {
        close();
        window.AICC.clipboard.showToast('Activated! Pro features unlocked.', 'success');
      } else {
        errorEl.textContent = result?.error || 'Invalid license key.';
        errorEl.style.display = 'block';
      }
    });
  }

  /** Coalesced re-anchor: at most one tryAnchor per animation frame. */
  function scheduleTryAnchor() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      tryAnchor();
    });
  }

  function tryAnchor() {
    ensureHost();
    const detectors = window.AICC.detectors;
    if (!detectors) return;
    const adapter = detectors.getActiveAdapter();
    if (!adapter) return;

    const anchor = adapter.getInputAnchor();
    if (!anchor || !anchor.isConnected) {
      host.style.display = 'none';
      currentAnchor = null;
      return;
    }

    // If the SPA swapped the input element out from under us, drop the stale ref.
    if (currentAnchor && !currentAnchor.isConnected) currentAnchor = null;

    currentAnchor = anchor;
    positionNearAnchor(anchor);
  }

  function init() {
    tryAnchor();

    // Debounced: coalesce bursts of mutations (token streaming, React
    // re-renders) into a single rAF-backed tryAnchor. Without this the
    // button flickered and the page janked on ChatGPT/Claude.
    const observer = new MutationObserver(scheduleTryAnchor);
    observer.observe(document.body, { childList: true, subtree: true });

    // Scroll can fire dozens of times per second; coalesce to one rAF.
    window.addEventListener('scroll', scheduleTryAnchor, true);
    window.addEventListener('resize', scheduleTryAnchor);
    setInterval(tryAnchor, 2000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
