# Firebase Setup Guide

This extension needs a Firebase project for auth + licensing. Nothing here
requires the Blaze (paid) plan unless you deploy the optional Cloud
Function — the Spark (free) plan covers Auth + Firestore for this use case.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project**.
2. In **Project settings → General → Your apps**, add a **Web app**.
   Copy the `apiKey`, `projectId`, and `appId` into `firebase/config.js`.

## 2. Enable Authentication

In **Authentication → Sign-in method**, enable:
- **Anonymous** (lets a brand-new user start using the free tier instantly)
- **Email/Password** (lets them upgrade later to sync across devices)

## 3. Create Firestore

In **Firestore Database**, create a database in production mode, then
set these **Security Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Each user can only read/write their own profile document.
    match /users/{uid} {
      allow read, update: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid;
      // Never allow a client to set their own `activated` or `plan` to
      // something more permissive directly — only allow specific fields.
      allow update: if request.auth != null && request.auth.uid == uid
        && !request.resource.data.diff(resource.data).affectedKeys()
              .hasAny(['activated', 'plan']);
    }

    // Activation keys are NOT directly readable by clients in production.
    // Only the Cloud Function (running with the Admin SDK, which bypasses
    // these rules) should be able to read/write this collection.
    match /activation_keys/{key} {
      allow read, write: if false;
    }
  }
}
```

> The dev-only fallback in `firebase/license.js` (direct Firestore key
> lookup) needs `activation_keys/{key}` to be readable, which conflicts
> with the rule above. Use that fallback only while developing locally
> with relaxed rules — switch to the Cloud Function before shipping, and
> lock the collection down as shown.

## 4. (Recommended) Deploy the license-validation Cloud Function

This keeps your activation keys completely server-side. Example:

```js
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.validateLicense = functions.https.onRequest(async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.replace('Bearer ', '');
  const { uid, key } = req.body;

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (decoded.uid !== uid) {
      return res.status(403).json({ success: false, error: 'UID mismatch.' });
    }

    const keyRef = admin.firestore().collection('activation_keys').doc(key);
    const keyDoc = await keyRef.get();

    if (!keyDoc.exists) return res.json({ success: false, error: 'Invalid license key.' });
    if (keyDoc.data().used) return res.json({ success: false, error: 'Key already used.' });

    const plan = keyDoc.data().plan || 'pro';

    await admin.firestore().runTransaction(async (tx) => {
      tx.update(keyRef, { used: true, usedBy: uid, usedAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.update(admin.firestore().collection('users').doc(uid), { activated: true, plan });
    });

    return res.json({ success: true, plan });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Could not verify request.' });
  }
});
```

Deploy with:
```
firebase init functions
# paste the code above into functions/index.js
firebase deploy --only functions
```

Then paste the deployed URL into `VALIDATE_LICENSE_FUNCTION_URL` in
`firebase/config.js`.

## 5. Seed some activation keys (optional)

In Firestore, create documents under `activation_keys/{your-key-string}`
with fields: `{ plan: "pro", used: false }`. Give the key string itself
to a customer after they pay (e.g. via Stripe webhook → Cloud Function
that writes the key doc).

## Notes on security

- The Firebase Web `apiKey` is **not a secret** — it identifies your
  project, it doesn't authorize access. Real protection comes from
  Firestore Security Rules and (for licensing) the Cloud Function.
- This extension never asks for or stores a Firebase **service account**
  or **private key** — those belong only on a server (e.g. inside the
  Cloud Function), never inside the extension bundle.
