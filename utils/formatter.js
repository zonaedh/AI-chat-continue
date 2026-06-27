/**
 * utils/formatter.js
 * Turns raw extracted messages into a normalized conversation object,
 * and turns that object into a portable "continuation prompt".
 *
 * Exposed on window.AICC.formatter so other content scripts can use it
 * without a module bundler (MV3 content scripts load as classic scripts).
 */
(function () {
  const MAX_PROMPT_CHARS = 24000; // ~6k tokens, safe paste size for most chat inputs
  const HEAD_KEEP_CHARS = 4000; // keep the start of the conversation (system/context)
  const TAIL_KEEP_CHARS = 18000; // keep the most recent turns (most relevant)

  /**
   * Normalize raw scraped turns into { title, systemPrompt, messages, source, capturedAt }
   * @param {Array<{role: 'user'|'assistant', content: string, timestamp?: string}>} rawMessages
   * @param {{title?: string, systemPrompt?: string, source?: string}} meta
   */
  function normalizeConversation(rawMessages, meta = {}) {
    const messages = rawMessages
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: (m.content || '').trim(),
        timestamp: m.timestamp || null,
      }))
      .filter((m) => m.content.length > 0);

    return {
      title: meta.title || 'AI Chat Export',
      systemPrompt: meta.systemPrompt || null,
      source: meta.source || 'unknown',
      capturedAt: new Date().toISOString(),
      messages,
    };
  }

  /**
   * Compress a long conversation by keeping the earliest context and the
   * most recent turns, dropping/summarizing the middle.
   */
  function compressIfNeeded(conversation) {
    const full = conversationToTranscript(conversation);
    if (full.length <= MAX_PROMPT_CHARS) {
      return { transcript: full, truncated: false };
    }

    const head = full.slice(0, HEAD_KEEP_CHARS);
    const tail = full.slice(-TAIL_KEEP_CHARS);
    const omittedChars = full.length - head.length - tail.length;

    const stitched =
      head +
      `\n\n[... ${omittedChars.toLocaleString()} characters omitted from the middle of this conversation to fit size limits ...]\n\n` +
      tail;

    return { transcript: stitched, truncated: true };
  }

  function conversationToTranscript(conversation) {
    return conversation.messages
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * Build the final continuation prompt that gets copied to the clipboard.
   */
  function buildContinuationPrompt(conversation) {
    const { transcript, truncated } = compressIfNeeded(conversation);

    const lines = [];
    lines.push('You are continuing a previous conversation.');
    if (conversation.systemPrompt) {
      lines.push('', '[ORIGINAL SYSTEM CONTEXT]', conversation.systemPrompt.trim());
    }
    lines.push('', '[CONVERSATION START]', transcript, '[CONVERSATION END]', '');
    lines.push('Continue naturally from the last assistant response, keeping the same tone, context, and any unresolved tasks in mind.');
    if (truncated) {
      lines.push('(Note: this conversation was long, so some middle portion was omitted above to fit size limits.)');
    }

    return lines.join('\n');
  }

  /** Build the raw JSON export shape requested in the spec. */
  function buildJsonExport(conversation) {
    return {
      title: conversation.title,
      source: conversation.source,
      capturedAt: conversation.capturedAt,
      messages: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  window.AICC = window.AICC || {};
  window.AICC.formatter = {
    normalizeConversation,
    buildContinuationPrompt,
    buildJsonExport,
    MAX_PROMPT_CHARS,
  };
})();
