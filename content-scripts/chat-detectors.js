/**
 * content-scripts/chat-detectors.js
 *
 * Per-site "adapters" that know how to find:
 *   - the scrollable message list
 *   - individual message turns + their role (user/assistant)
 *   - the chat input box (where we anchor our floating button)
 *
 * Selectors are written defensively (multiple fallbacks) because every
 * one of these sites changes its DOM/class names without notice. When a
 * primary selector fails, we fall back to the generic heuristic adapter.
 *
 * FIXES vs. original:
 *  - firstVisibleMatch(): input anchors are now filtered for visibility so
 *    a hidden contenteditable/textarea earlier in the DOM can't shadow the
 *    real chat input (root cause of the button never appearing on ChatGPT /
 *    Claude / Gemini / Z.ai).
 *  - isVisible() now checks isConnected, display, visibility, opacity — not
 *    just non-zero box.
 *  - Z.ai selectors narrowed: .user-message + div[class*="message-"] instead
 *    of the old [class*="message"] (which matched messageInputContainer and
 *    parent wrappers, producing phantom messages).
 *  - Claude / Gemini selectors broadened with current-class fallbacks.
 *  - getActiveAdapter() only returns an adapter whose input anchor is VISIBLE.
 *  - getExtractionAdapter() prefers an adapter that actually finds turn nodes;
 *    falls back to generic so a stale site adapter never yields "no conversation
 *    found" while real messages are on the page.
 */
(function () {
  function firstMatch(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /** Like firstMatch, but skips elements that aren't actually visible. */
  function firstVisibleMatch(selectors, root = document) {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      for (const el of els) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function allMatches(selectors, root = document) {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    return true;
  }

  // ---------------------------------------------------------------------
  // ChatGPT (chatgpt.com / chat.openai.com)
  // ---------------------------------------------------------------------
  const chatgptAdapter = {
    id: 'chatgpt',
    matches: () => /chatgpt\.com|chat\.openai\.com/.test(location.hostname),
    getTurnNodes() {
      return allMatches([
        '[data-message-author-role]',
        'div[data-testid^="conversation-turn-"]',
      ]);
    },
    getRole(node) {
      const role = node.getAttribute('data-message-author-role');
      if (role) return role === 'assistant' ? 'assistant' : 'user';
      const inner = node.querySelector('[data-message-author-role]');
      return inner?.getAttribute('data-message-author-role') === 'assistant'
        ? 'assistant'
        : 'user';
    },
    getText(node) {
      const content = node.querySelector('[data-message-author-role] .markdown, .markdown') || node;
      return content.innerText || node.innerText || '';
    },
    getInputAnchor() {
      // firstVisibleMatch avoids grabbing a hidden contenteditable that some
      // ChatGPT layouts keep in the DOM (e.g. inside a collapsed dialog).
      return firstVisibleMatch([
        '#prompt-textarea',
        'form textarea',
        'textarea[placeholder]',
        'div[contenteditable="true"]',
      ]);
    },
  };

  // ---------------------------------------------------------------------
  // Claude (claude.ai)
  // ---------------------------------------------------------------------
  const claudeAdapter = {
    id: 'claude',
    matches: () => /claude\.ai|claude\.com/.test(location.hostname),
    getTurnNodes() {
      // Primary: data-testid (current). Fallbacks: legacy class names +
      // structural heuristics for when Anthropic renames things.
      return allMatches([
        '[data-testid="user-message"], [data-testid="assistant-message"]',
        '[data-testid^="conversation-turn-"]',
        '.font-user-message, .font-claude-message',
        // Structural fallback: human/assistant turn containers commonly carry
        // a data-is-streaming or role-ish class on Claude.
        'div[class*="human-turn"], div[class*="assistant-turn"]',
      ]);
    },
    getRole(node) {
      if (node.matches('[data-testid="user-message"], .font-user-message, [class*="human-turn"]')) return 'user';
      if (node.matches('[data-testid="assistant-message"], .font-claude-message, [class*="assistant-turn"]')) return 'assistant';
      const tid = node.getAttribute('data-testid') || '';
      if (/user/i.test(tid)) return 'user';
      if (/assistant/i.test(tid)) return 'assistant';
      return node.querySelector('[data-testid="user-message"], .font-user-message') ? 'user' : 'assistant';
    },
    getText(node) {
      return node.innerText || '';
    },
    getInputAnchor() {
      return firstVisibleMatch([
        'div[contenteditable="true"][role="textbox"]',
        '.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea',
      ]);
    },
  };

  // ---------------------------------------------------------------------
  // Gemini (gemini.google.com)
  // ---------------------------------------------------------------------
  const geminiAdapter = {
    id: 'gemini',
    matches: () => /gemini\.google\.com/.test(location.hostname),
    getTurnNodes() {
      return allMatches([
        'user-query, model-response',
        'message-content[author="user"], message-content[author="model"]',
        '.conversation-container',
      ]);
    },
    getRole(node) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'user-query') return 'user';
      if (tag === 'model-response') return 'assistant';
      const author = node.getAttribute?.('author');
      if (author === 'user') return 'user';
      if (author === 'model') return 'assistant';
      return node.querySelector('user-query') ? 'user' : 'assistant';
    },
    getText(node) {
      return node.innerText || '';
    },
    getInputAnchor() {
      return firstVisibleMatch([
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea',
      ]);
    },
  };

  // ---------------------------------------------------------------------
  // DeepSeek (chat.deepseek.com)
  // ---------------------------------------------------------------------
  const deepseekAdapter = {
    id: 'deepseek',
    matches: () => /chat\.deepseek\.com/.test(location.hostname),
    getTurnNodes() {
      return allMatches([
        '.message, [class*="message"]',
        '[class*="chat-message"]',
      ]);
    },
    getRole(node) {
      const cls = node.className || '';
      if (/user/i.test(cls)) return 'user';
      if (/assistant|ai|bot/i.test(cls)) return 'assistant';
      return node.closest('[class*="user"]') ? 'user' : 'assistant';
    },
    getText(node) {
      return node.innerText || '';
    },
    getInputAnchor() {
      return firstVisibleMatch(['textarea', 'div[contenteditable="true"]']);
    },
  };

  // ---------------------------------------------------------------------
  // Z.ai (chat.z.ai)
  // Verified DOM (2025):
  //   input:   <textarea id="chat-input" class="input-scroll ...">
  //   user:    <div class="flex w-full user-message relative">...</div>
  //   asst:    <div class="flex w-full message-<uuid> gap-4 relative svelte-...">
  //   NO data-testid, NO data-role attributes.
  // ---------------------------------------------------------------------
  const zaiAdapter = {
    id: 'zai',
    matches: () => /chat\.z\.ai/.test(location.hostname),
    getTurnNodes() {
      // .user-message targets user turns directly.
      // div[class*="message-"] (note the hyphen) targets assistant turns
      // whose class is `message-<uuid>`, while NOT matching the input
      // wrapper `messageInputContainer` (no hyphen).
      return allMatches([
        '.user-message, div[class*="message-"]',
        '[data-role]',
      ]);
    },
    getRole(node) {
      const dataRole = node.getAttribute?.('data-role');
      if (dataRole) return dataRole === 'assistant' ? 'assistant' : 'user';
      const cls = node.className?.toString() || '';
      if (/\buser-message\b/i.test(cls)) return 'user';
      if (/message-/i.test(cls)) return 'assistant';
      return /user/i.test(cls) ? 'user' : 'assistant';
    },
    getText(node) {
      return node.innerText || '';
    },
    getInputAnchor() {
      return firstVisibleMatch([
        '#chat-input',
        'textarea',
        'div[contenteditable="true"]',
      ]);
    },
  };

  // ---------------------------------------------------------------------
  // Generic fallback adapter — works on "any web-based AI chat UI" by
  // using structural heuristics instead of site-specific classes.
  // ---------------------------------------------------------------------
  const genericAdapter = {
    id: 'generic',
    matches: () => true,
    getInputAnchor() {
      const candidates = Array.from(
        document.querySelectorAll('textarea, div[contenteditable="true"], div[role="textbox"]')
      ).filter((el) => isVisible(el));

      if (!candidates.length) return null;

      // Prefer the one nearest the bottom of the viewport (typical chat input position).
      candidates.sort((a, b) => rectBottom(b) - rectBottom(a));
      return candidates[0];
    },
    getTurnNodes() {
      const anchor = this.getInputAnchor();
      if (!anchor) return [];

      const scrollContainer = findScrollableAncestor(anchor) || document.body;
      const blocks = Array.from(scrollContainer.querySelectorAll('div, article, section, li'))
        .filter((el) => el.innerText && el.innerText.trim().length > 0)
        .filter((el) => !el.querySelector('textarea, div[contenteditable="true"]'));

      const leafBlocks = blocks.filter((el) => {
        const childTextBlocks = Array.from(el.children).filter(
          (c) => c.innerText && c.innerText.trim().length > 20
        );
        return childTextBlocks.length <= 1;
      });

      return leafBlocks.filter((el) => {
        const len = el.innerText.trim().length;
        return len > 1 && len < 20000;
      });
    },
    getRole(node) {
      const text = (node.className || '') + ' ' + (node.getAttribute?.('aria-label') || '');
      if (/\buser\b|\byou\b/i.test(text)) return 'user';
      if (/assistant|bot|ai|model/i.test(text)) return 'assistant';

      const style = window.getComputedStyle(node);
      if (style.textAlign === 'right' || style.flexDirection === 'row-reverse') return 'user';

      return 'assistant';
    },
    getText(node) {
      return node.innerText || '';
    },
  };

  function rectBottom(el) {
    return el.getBoundingClientRect().bottom;
  }

  function findScrollableAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  const ADAPTERS = [
    chatgptAdapter,
    claudeAdapter,
    geminiAdapter,
    deepseekAdapter,
    zaiAdapter,
    genericAdapter, // must stay last — it always matches() === true
  ];

  /**
   * Picks an adapter for anchoring the floating button. Returns the first
   * adapter (by hostname match) that finds a VISIBLE input box. If none do,
   * falls back to the first hostname match (injector.js will retry).
   */
  function getActiveAdapter() {
    let hostnameMatch = null;
    for (const adapter of ADAPTERS) {
      if (!adapter.matches()) continue;
      if (!hostnameMatch) hostnameMatch = adapter;
      try {
        const anchor = adapter.getInputAnchor();
        if (anchor) return adapter;
      } catch (err) {
        console.warn(`[AICC] Adapter "${adapter.id}" threw while probing input, skipping:`, err);
      }
    }
    return hostnameMatch || genericAdapter;
  }

  /**
   * Picks an adapter for EXTRACTING the conversation. Prefers a site adapter
   * that finds both an input AND turn nodes; if the site adapter finds an
   * input but no turns (stale selectors), falls through to the generic
   * adapter so we never return "no conversation found" while real messages
   * are visible on the page.
   */
  function getExtractionAdapter() {
    let inputOnlyAdapter = null;
    for (const adapter of ADAPTERS) {
      if (!adapter.matches()) continue;
      try {
        const anchor = adapter.getInputAnchor();
        if (!anchor) continue;
        if (!inputOnlyAdapter) inputOnlyAdapter = adapter;
        const turns = adapter.getTurnNodes();
        if (turns && turns.length > 0) return adapter;
      } catch (err) {
        console.warn(`[AICC] Adapter "${adapter.id}" threw while probing turns, skipping:`, err);
      }
    }
    // Generic adapter as last resort (it always matches).
    return genericAdapter;
  }

  window.AICC = window.AICC || {};
  window.AICC.detectors = {
    getActiveAdapter,
    getExtractionAdapter,
    ADAPTERS,
    _internal: { isVisible, firstVisibleMatch },
  };
})();
