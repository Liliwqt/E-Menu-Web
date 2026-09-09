import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);

const branchCompanyIds = new Map();

export function setBranchContext(branchId, companyId) {
  if (branchId && companyId) branchCompanyIds.set(branchId, companyId);
}

export function branchDataPath(branchId) {
  const companyId = branchCompanyIds.get(branchId);
  return companyId ? `${companyId}/branches/${branchId}` : branchId;
}

// App Check was intentionally removed: it is enforced nowhere (the FastAPI backend verifies only
// Firebase ID tokens, and RTDB access is gated by Security Rules on the authenticated UID), and its
// site key was Google's public reCAPTCHA test key, which only produced 400 errors. Authentication
// still relies on the Firebase ID token attached below.

const databaseURL = firebaseConfig.databaseURL;

// Kept its name for existing callers; it now attaches only the signed-in user's Firebase ID token.
export async function fetchWithAppCheck(url, options = {}) {
  // Get the auth token
  let authToken = null;
  try {
    if (auth.currentUser) {
      authToken = await auth.currentUser.getIdToken();
    }
  } catch (e) {
    // This might happen if user just logged out or token expired
    console.warn('Auth token retrieval failed:', e);
  }

  const headers = new Headers(options.headers || {});

  // Attach the auth token. Firebase RTDB REST requires it as the ?auth= query param; every
  // other backend (the FastAPI BFF) gets it as an Authorization header instead, so the token
  // never appears in URLs, access logs, or proxy logs.
  let finalUrl = url;
  if (authToken) {
    if (databaseURL && url.startsWith(databaseURL)) {
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}auth=${authToken}`;
    } else {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
  }

  return fetch(finalUrl, { ...options, headers });
}

export function dbUrl(path) {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const encoded = clean.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `${databaseURL}/${encoded}.json`;
}
