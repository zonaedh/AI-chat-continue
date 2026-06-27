/**
 * firebase/auth.js
 *
 * Minimal Firebase Authentication client built on the Identity Toolkit
 * REST API (no SDK bundle). Runs inside the MV3 service worker.
 * Session (idToken/refreshToken/uid) is cached in chrome.storage.local.
 */
import { FIREBASE_CONFIG, IDENTITY_TOOLKIT_URL, SECURE_TOKEN_URL } from './config.js';

const SESSION_KEY = 'aicc_session';

async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

function apiKeyParam() {
  return `key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
}

async function signInAnonymously() {
  const res = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:signUp?${apiKeyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const data = await throwIfError(res);
  return setSession({
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    isAnonymous: true,
    email: null,
  });
}

async function signInWithEmail(email, password) {
  const res = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:signInWithPassword?${apiKeyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await throwIfError(res);
  return setSession({
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    isAnonymous: false,
    email: data.email,
  });
}

async function signUpWithEmail(email, password) {
  const res = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:signUp?${apiKeyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await throwIfError(res);
  return setSession({
    uid: data.localId,
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn) * 1000,
    isAnonymous: false,
    email: data.email,
  });
}

/** Links an anonymous account to a real email/password (upgrade path). */
async function upgradeAnonymousToEmail(email, password) {
  const session = await getSession();
  if (!session) throw new Error('No active session to upgrade.');

  const res = await fetch(`${IDENTITY_TOOLKIT_URL}/accounts:update?${apiKeyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: session.idToken, email, password, returnSecureToken: true }),
  });
  const data = await throwIfError(res);
  return setSession({
    ...session,
    idToken: data.idToken,
    refreshToken: data.refreshToken ?? session.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    isAnonymous: false,
    email,
  });
}

async function refreshIfNeeded() {
  const session = await getSession();
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session; // still valid for >60s

  const res = await fetch(`${SECURE_TOKEN_URL}?${apiKeyParam()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
  });
  const data = await throwIfError(res, true);
  return setSession({
    ...session,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Number(data.expires_in) * 1000,
  });
}

async function throwIfError(res, isTokenEndpoint = false) {
  const data = await res.json();
  if (!res.ok) {
    const message = isTokenEndpoint
      ? data?.error?.message || 'Authentication refresh failed.'
      : data?.error?.message || 'Authentication request failed.';
    throw new Error(message);
  }
  return data;
}

/** Ensures we always have *some* session (anonymous if nothing else). */
async function ensureSession() {
  let session = await refreshIfNeeded();
  if (!session) {
    session = await signInAnonymously();
  }
  return session;
}

export const AICCAuth = {
  getSession,
  clearSession,
  ensureSession,
  signInAnonymously,
  signInWithEmail,
  signUpWithEmail,
  upgradeAnonymousToEmail,
  refreshIfNeeded,
};
