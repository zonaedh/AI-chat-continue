# AI Chat Continuator by Zonaed Hossain

A Chrome Extension (Manifest V3) that lets you export any AI chat
conversation — ChatGPT, Claude, Gemini, DeepSeek, Z.ai, or basically any
web-based chat UI — and continue it seamlessly in a brand-new chat
session by pasting a generated "continuation prompt."

## What it does

1. Injects a small floating control near the chat input box on supported
   sites (Shadow DOM, so it can't be styled-over or break the host page).
2. **Export** copies the full conversation as structured JSON.
3. **Continue Chat** copies a ready-to-paste continuation prompt:
   ```
   You are continuing a previous conversation.

   [CONVERSATION START]
   User: ...
   Assistant: ...
   [CONVERSATION END]

   Continue naturally from the last assistant response.
   ```
   Long conversations are automatically compressed (head + tail kept,
   middle summarized as omitted) to stay under a safe paste size.
4. Tracks a simple free/pro plan via Firebase so you can gate usage
   (5 exports/day free, unlimited on Pro) — fully optional, see below.

## Project structure

```
/extension
  manifest.json
  /content-scripts
    chat-detectors.js   — per-site DOM adapters (chatgpt/claude/gemini/deepseek/zai/generic)
    extractor.js         — walks the DOM via the active adapter, normalizes messages
    injector.js           — floating button UI + activation modal (Shadow DOM)
  /background
    service-worker.js    — message router: status, activation, usage tracking
  /popup
    ui.html / ui.css / ui.js — account/plan view, sign-in, activation
  /firebase
    config.js             — YOUR Firebase project values go here
    auth.js                — REST-based Firebase Auth (anonymous + email/password)
    license.js             — Firestore profile + license key validation
    SETUP.md                — step-by-step Firebase setup, security rules, Cloud Function
  /utils
    formatter.js            — conversation normalization + continuation prompt builder
    clipboard.js              — copy-to-clipboard with fallback + toast notifications
  /icons
```

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select this `ai-chat-continuator` folder.
4. Pin the extension from the toolbar puzzle-piece icon for quick access.
5. Visit ChatGPT, Claude, Gemini, etc. — the floating control appears
   near the chat input automatically.

## Set up Firebase (auth + licensing)

The extension runs without any setup using a **local-only fallback**: if
`firebase/config.js` still has placeholder values, every action is
allowed without contacting Firebase, so you can test the export/copy
flow immediately. To turn on real accounts and licensing, follow
[`firebase/SETUP.md`](./firebase/SETUP.md) — it walks through:

- Creating the Firebase project, enabling Anonymous + Email/Password auth
- Firestore structure (`users/{uid}`) and required Security Rules
- An optional Cloud Function for secure server-side license key validation
- Seeding activation keys you can sell/distribute

## How site detection works

Each site adapter in `chat-detectors.js` knows how to find message turns
and the chat input box using a mix of stable selectors
(`data-message-author-role`, `data-testid`, custom elements like
`<user-query>`) and structural fallbacks. If a site changes its DOM, the
**generic adapter** kicks in automatically: it finds the visible input
box nearest the bottom of the viewport, locates its scrollable ancestor,
and extracts leaf text blocks, alternating user/assistant roles if it
can't otherwise tell them apart.

## Important caveats

- **Scoped host permissions**: the manifest is restricted to the four
  supported chat sites — `chatgpt.com`, `claude.ai`, `z.ai` /
  `chat.z.ai`, and `gemini.google.com/app`. The floating button and
  content scripts will NOT run on any other site. (Firebase REST
  endpoints remain in `host_permissions` for the optional auth/licensing
  backend — they are API calls, not sites the extension acts on.) If you
  want to add another site later, add it to both `host_permissions` and
  `content_scripts.matches` in `manifest.json`, and add a matching
  adapter in `chat-detectors.js`.
- **No bundled remote code**: Firebase access goes through plain REST
  calls (`fetch`) instead of bundling the Firebase SDK, keeping the
  extension's code fully inspectable and Chrome Web Store-policy-friendly
  (MV3 disallows remotely-hosted/loaded code).
- **System prompt extraction** is best-effort only — most consumer chat
  UIs don't expose the system prompt/custom instructions in the DOM at
  all, so this is frequently `null`.
- **Selectors will drift.** AI chat sites change class names and DOM
  structure often. When an adapter breaks, the generic fallback should
  keep things working, but you'll likely want to update the specific
  adapter in `chat-detectors.js` periodically.
- Icons in `/icons` are simple placeholders generated for this build —
  swap in your own branding before shipping.

 ---- Open Source ----
  MD ZONAED HOSSAIN
  www.zonaedhossain.com
  Founder | The Shark Web
  www.thesharkweb.com
