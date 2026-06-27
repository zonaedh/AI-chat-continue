/**
 * background/service-worker.js
 *
 * MV3 module service worker. Owns the Firebase session and the user's
 * license/usage profile, and answers messages from content scripts and
 * the popup. Caches the profile in chrome.storage.local for fast
 * "AICC_GET_STATUS" responses (most calls don't need a network round trip).
 */
import { AICCAuth } from '../firebase/auth.js';
import { AICCLicense } from '../firebase/license.js';
import { FIREBASE_CONFIG } from '../firebase/config.js';

const PROFILE_CACHE_KEY = 'aicc_profile_cache';

/**
 * Until firebase/config.js is filled in with real project values, run in
 * "local-only" mode: every action is allowed and no network calls are
 * made. This lets someone load-unpacked and try the export/copy flow
 * immediately, without needing a Firebase project first. Once a real
 * apiKey is set, normal auth + licensing kicks in automatically.
 */
function isFirebaseConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey) && FIREBASE_CONFIG.apiKey !== 'YOUR_FIREBASE_WEB_API_KEY';
}

async function getCachedProfile() {
  const data = await chrome.storage.local.get(PROFILE_CACHE_KEY);
  return data[PROFILE_CACHE_KEY] || null;
}

async function setCachedProfile(profile) {
  await chrome.storage.local.set({ [PROFILE_CACHE_KEY]: profile });
  return profile;
}

async function loadFreshProfile() {
  const session = await AICCAuth.ensureSession();
  const profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, session.email);
  await setCachedProfile(profile);
  return { session, profile };
}

async function handleGetStatus() {
  if (!isFirebaseConfigured()) {
    return { activated: true, allowed: true, plan: 'pro', email: null, localOnly: true };
  }
  try {
    let profile = await getCachedProfile();
    let session = await AICCAuth.getSession();

    if (!session || !profile) {
      ({ session, profile } = await loadFreshProfile());
    }

    if (!profile.activated) {
      return { activated: false, allowed: false, plan: profile.plan };
    }

    const today = new Date().toISOString().slice(0, 10);
    const exportsToday = profile.usage_stats?.date === today ? profile.usage_stats.exportsToday : 0;
    const allowed = profile.plan === 'pro' || exportsToday < 5;

    return {
      activated: true,
      allowed,
      plan: profile.plan,
      email: session.email,
      reason: allowed ? null : 'Free plan limit reached. Upgrade to Pro for unlimited exports.',
    };
  } catch (err) {
    console.error('[AICC] getStatus failed:', err);
    return { activated: false, allowed: false, error: err.message };
  }
}

async function handleRecordExport() {
  if (!isFirebaseConfigured()) return { allowed: true, localOnly: true };
  try {
    const session = await AICCAuth.ensureSession();
    let profile = await getCachedProfile();
    if (!profile) profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, session.email);

    const result = await AICCLicense.checkAndRecordExport(session.uid, session.idToken, profile);
    if (result.usage_stats) {
      profile.usage_stats = result.usage_stats;
      await setCachedProfile(profile);
    }
    return result;
  } catch (err) {
    console.error('[AICC] recordExport failed:', err);
    return { allowed: false, error: err.message };
  }
}

async function handleActivateFree() {
  if (!isFirebaseConfigured()) return { success: true, plan: 'pro', localOnly: true };
  try {
    const session = await AICCAuth.ensureSession();
    const result = await AICCLicense.activateFree(session.uid, session.idToken);
    const profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, session.email);
    await setCachedProfile({ ...profile, activated: true, plan: result.plan });
    return result;
  } catch (err) {
    console.error('[AICC] activateFree failed:', err);
    return { success: false, error: err.message };
  }
}

async function handleActivateKey(key) {
  if (!isFirebaseConfigured()) return { success: true, plan: 'pro', localOnly: true };
  try {
    const session = await AICCAuth.ensureSession();
    const result = await AICCLicense.activateWithKey(session.uid, session.idToken, key);
    if (result.success) {
      const profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, session.email);
      await setCachedProfile({ ...profile, activated: true, plan: result.plan });
    }
    return result;
  } catch (err) {
    console.error('[AICC] activateKey failed:', err);
    return { success: false, error: err.message };
  }
}

async function handleSignIn(email, password) {
  try {
    const session = await AICCAuth.signInWithEmail(email, password);
    const profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, email);
    await setCachedProfile(profile);
    return { success: true, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleUpgradeToEmail(email, password) {
  try {
    const session = await AICCAuth.upgradeAnonymousToEmail(email, password);
    await AICCLicense.patchUserDoc(session.uid, session.idToken, { email });
    const profile = await AICCLicense.getOrCreateProfile(session.uid, session.idToken, email);
    await setCachedProfile(profile);
    return { success: true, profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'AICC_GET_STATUS':
        sendResponse(await handleGetStatus());
        break;
      case 'AICC_RECORD_EXPORT':
        sendResponse(await handleRecordExport());
        break;
      case 'AICC_ACTIVATE_FREE':
        sendResponse(await handleActivateFree());
        break;
      case 'AICC_ACTIVATE_KEY':
        sendResponse(await handleActivateKey(message.key));
        break;
      case 'AICC_SIGN_IN':
        sendResponse(await handleSignIn(message.email, message.password));
        break;
      case 'AICC_UPGRADE_TO_EMAIL':
        sendResponse(await handleUpgradeToEmail(message.email, message.password));
        break;
      default:
        sendResponse({ error: 'Unknown message type.' });
    }
  })();
  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(async () => {
  if (!isFirebaseConfigured()) return;
  try {
    await loadFreshProfile();
  } catch (err) {
    console.warn('[AICC] Initial profile load deferred:', err.message);
  }
});
