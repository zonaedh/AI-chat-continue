/**
 * content-scripts/extractor.js
 *
 * Uses the active site adapter (from chat-detectors.js) to walk the DOM
 * and pull out an ordered list of { role, content } messages, then hands
 * that off to the shared formatter (utils/formatter.js) for normalization.
 *
 * FIXES vs. original:
 *  - Uses getExtractionAdapter() instead of getActiveAdapter(). The site
 *    adapter might find the input box but have stale turn-node selectors;
 *    getExtractionAdapter() falls through to the generic adapter in that
 *    case so we never return "no conversation found" while messages are
 *    visibly on the page.
 *  - Dedup is now by element identity (skip a node if it's an ancestor of
 *    the previously captured node), NOT by string-equal content. The old
 *    content comparison dropped legitimate back-to-back messages that
 *    happened to share text (e.g. two "OK" replies) and failed to drop
 *    parent wrappers whose concatenated innerText differed from children.
 */
(function () {
  function extractRawMessages(adapter) {
    const nodes = adapter.getTurnNodes();
    const messages = [];
    let lastNode = null;

    for (const node of nodes) {
      const role = adapter.getRole(node);
      const content = (adapter.getText(node) || '').trim();
      if (!content) continue;

      // Skip if this node is an ancestor of the previously captured node
      // (happens when a broad selector matches both a wrapper and its
      // inner content node — keep the inner/leaf one only).
      if (lastNode && lastNode.contains(node)) {
        // The previous (outer) node was a wrapper — replace it with this
        // more specific inner node.
        messages[messages.length - 1] = { role, content };
        lastNode = node;
        continue;
      }
      // Skip if this node is a descendant of the previously captured node
      // (we already captured the outer/leaf text, don't re-add the child).
      if (lastNode && node.contains(lastNode)) {
        continue;
      }

      messages.push({ role, content });
      lastNode = node;
    }

    return cleanupAlternation(messages, adapter.id);
  }

  /**
   * The generic adapter sometimes mis-guesses role on every node (e.g. all
   * "assistant"). If we detect that, fall back to strict alternation
   * starting with "user", which holds true for the vast majority of chat UIs.
   */
  function cleanupAlternation(messages, adapterId) {
    if (adapterId !== 'generic' || messages.length < 2) return messages;

    const allSameRole = messages.every((m) => m.role === messages[0].role);
    if (!allSameRole) return messages;

    return messages.map((m, i) => ({
      ...m,
      role: i % 2 === 0 ? 'user' : 'assistant',
    }));
  }

  function getSystemPrompt() {
    const candidates = document.querySelectorAll(
      '[data-testid*="system"], [class*="system-prompt"], [aria-label*="custom instructions" i]'
    );
    for (const el of candidates) {
      const text = el.innerText?.trim();
      if (text) return text;
    }
    return null;
  }

  function extractConversation() {
    // Prefer an adapter that actually finds turn nodes; this transparently
    // falls back to the generic adapter if the site adapter's selectors
    // have drifted.
    const adapter = window.AICC.detectors.getExtractionAdapter
      ? window.AICC.detectors.getExtractionAdapter()
      : window.AICC.detectors.getActiveAdapter();
    if (!adapter) return null;

    const rawMessages = extractRawMessages(adapter);
    if (!rawMessages.length) return null;

    return window.AICC.formatter.normalizeConversation(rawMessages, {
      title: document.title || 'AI Chat Export',
      systemPrompt: getSystemPrompt(),
      source: adapter.id,
    });
  }

  window.AICC = window.AICC || {};
  window.AICC.extractor = { extractConversation };
})();
