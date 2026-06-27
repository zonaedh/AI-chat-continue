/**
 * firebase/license.js
 *
 * Talks to Firestore (via REST, using the user's idToken) to read/write
 * the per-user document described in the spec:
 *
 *   users/{uid}: { email, plan, activated, device_limit, usage_stats }
 *
 * License key validation:
 *   - If VALIDATE_LICENSE_FUNCTION_URL is configured, keys are validated
 *     server-side by a Cloud Function (RECOMMENDED — see firebase/SETUP.md).
 *     The function alone has permission to read the secret keys collection
 *     and flips `activated`/`plan` on the user's doc using the Admin SDK.
 *   - If no function URL is configured, this falls back to a direct
 *     Firestore lookup. That fallback is provided so the extension is
 *     runnable out of the box, but it is NOT secure for production: a
 *     motivated user could read your security rules and enumerate valid
 *     keys. Treat the direct-Firestore path as a development convenience,
 *     not a real activation system.
 */
import { FIRESTORE_BASE_URL, VALIDATE_LICENSE_FUNCTION_URL, FREE_DAILY_EXPORT_LIMIT } from './config.js';

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function authHeader(idToken) {
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

/** Convert a plain JS object into Firestore's typed REST document format. */
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(Math.trunc(value)) };
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value) } };
  }
  return { stringValue: String(value) };
}

/** Convert Firestore's typed REST document format back into a plain object. */
function fromFirestoreFields(fields = {}) {
  const obj = {};
  for (const [key, value] of Object.entries(fields)) {
    obj[key] = fromFirestoreValue(value);
  }
  return obj;
}

function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return fromFirestoreFields(value.mapValue.fields || {});
  return null;
}

async function getUserDoc(uid, idToken) {
  const res = await fetch(`${FIRESTORE_BASE_URL()}/users/${uid}`, {
    headers: authHeader(idToken),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to read user profile (${res.status}).`);
  const data = await res.json();
  return fromFirestoreFields(data.fields);
}

async function createDefaultUserDoc(uid, idToken, email) {
  const defaults = {
    email: email || null,
    plan: 'free',
    activated: false,
    device_limit: 1,
    usage_stats: { date: todayKey(), exportsToday: 0, totalExports: 0 },
  };
  await patchUserDoc(uid, idToken, defaults);
  return defaults;
}

async function patchUserDoc(uid, idToken, partial) {
  const fieldPaths = Object.keys(partial).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${FIRESTORE_BASE_URL()}/users/${uid}?${fieldPaths}`, {
    method: 'PATCH',
    headers: authHeader(idToken),
    body: JSON.stringify({ fields: toFirestoreFields(partial) }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to update user profile: ${body}`);
  }
  return res.json();
}

/** Loads (or lazily creates) the user's profile doc. */
async function getOrCreateProfile(uid, idToken, email) {
  const existing = await getUserDoc(uid, idToken);
  if (existing) return existing;
  return createDefaultUserDoc(uid, idToken, email);
}

/**
 * Validates a license key and, on success, activates the user's account.
 * Prefers the secure Cloud Function path; falls back to a direct (less
 * secure) Firestore lookup if no function URL is configured.
 */
async function activateWithKey(uid, idToken, key) {
  if (!key) return { success: false, error: 'Enter a license key.' };

  if (VALIDATE_LICENSE_FUNCTION_URL) {
    const res = await fetch(VALIDATE_LICENSE_FUNCTION_URL, {
      method: 'POST',
      headers: authHeader(idToken),
      body: JSON.stringify({ uid, key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Invalid license key.' };
    }
    return { success: true, plan: data.plan || 'pro' };
  }

  // --- Dev-only fallback: direct Firestore lookup (see warning above) ---
  const keyRes = await fetch(`${FIRESTORE_BASE_URL()}/activation_keys/${encodeURIComponent(key)}`, {
    headers: authHeader(idToken),
  });
  if (keyRes.status === 404) return { success: false, error: 'Invalid license key.' };
  if (!keyRes.ok) return { success: false, error: 'Could not validate key right now.' };

  const keyDoc = fromFirestoreFields((await keyRes.json()).fields);
  if (keyDoc.used === true) return { success: false, error: 'This key has already been used.' };

  await patchUserDoc(uid, idToken, { activated: true, plan: keyDoc.plan || 'pro' });
  // Mark key as used so it can't be reused (best-effort; not race-safe
  // without a transaction, which the REST fallback intentionally omits —
  // another reason to prefer the Cloud Function path in production).
  await fetch(`${FIRESTORE_BASE_URL()}/activation_keys/${encodeURIComponent(key)}?updateMask.fieldPaths=used&updateMask.fieldPaths=usedBy`, {
    method: 'PATCH',
    headers: authHeader(idToken),
    body: JSON.stringify({ fields: toFirestoreFields({ used: true, usedBy: uid }) }),
  });

  return { success: true, plan: keyDoc.plan || 'pro' };
}

/** Activates the free tier (no key) so usage limits apply instead of a hard block. */
async function activateFree(uid, idToken) {
  await patchUserDoc(uid, idToken, { activated: true, plan: 'free' });
  return { success: true, plan: 'free' };
}

/**
 * Checks + increments today's export usage. Returns whether the action
 * is allowed under the user's plan, resetting the daily counter on a
 * new UTC day.
 */
async function checkAndRecordExport(uid, idToken, profile) {
  const today = todayKey();
  const stats = profile.usage_stats?.date === today
    ? profile.usage_stats
    : { date: today, exportsToday: 0, totalExports: profile.usage_stats?.totalExports || 0 };

  if (profile.plan !== 'pro' && stats.exportsToday >= FREE_DAILY_EXPORT_LIMIT) {
    return { allowed: false, reason: `Free plan limit reached (${FREE_DAILY_EXPORT_LIMIT}/day). Upgrade to Pro for unlimited exports.` };
  }

  const updated = {
    date: today,
    exportsToday: stats.exportsToday + 1,
    totalExports: (stats.totalExports || 0) + 1,
  };
  await patchUserDoc(uid, idToken, { usage_stats: updated });
  return { allowed: true, usage_stats: updated };
}

export const AICCLicense = {
  getOrCreateProfile,
  activateWithKey,
  activateFree,
  checkAndRecordExport,
  patchUserDoc,
};
