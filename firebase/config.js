/**
 * firebase/config.js
 *
 * Fill these in from your Firebase project settings
 * (Project settings → General → Your apps → Web app).
 *
 * These are PUBLIC client identifiers, not secrets — Firebase Web API
 * keys are safe to ship in a client because real security comes from
 * Firestore Security Rules + (ideally) a Cloud Function for license
 * validation, not from hiding this key. See firebase/SETUP.md.
 */
export const FIREBASE_CONFIG = {
  apiKey: 'YOUR_FIREBASE_WEB_API_KEY',
  projectId: 'YOUR_FIREBASE_PROJECT_ID',
  appId: 'YOUR_FIREBASE_APP_ID',
};

// REST endpoints (no SDK bundling needed — keeps the extension free of
// "remote code" concerns and works fine inside an MV3 service worker).
export const IDENTITY_TOOLKIT_URL = 'https://identitytoolkit.googleapis.com/v1';
export const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
export const FIRESTORE_BASE_URL = (projectId = FIREBASE_CONFIG.projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

// Optional: if you deploy the Cloud Function described in SETUP.md for
// server-side license validation, put its URL here. When set, the
// extension will call this instead of validating the key itself.
export const VALIDATE_LICENSE_FUNCTION_URL = ''; // e.g. 'https://us-central1-yourproj.cloudfunctions.net/validateLicense'

// Free-tier daily export limit.
export const FREE_DAILY_EXPORT_LIMIT = 5;
