import { initializeApp, deleteApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { API_BASE } from './apiBase';
import { createBackendTransport } from './backendTransport.js';

export const firebaseConfig = {
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
  const target = new URL(url);
  const rtdb = databaseURL ? new URL(databaseURL) : null;
  if (rtdb && target.origin === rtdb.origin && target.pathname.endsWith('.json')) {
    if (target.username || target.password || target.searchParams.has('auth')) throw new Error('Invalid database destination');
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Sign-in required');
    target.searchParams.set('auth', token);
    return fetch(target.href, { ...options, redirect: 'error' });
  }
  return createBackendTransport({ base: API_BASE, getToken: () => auth.currentUser?.getIdToken() })(url, options);
}

export function dbUrl(path) {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const encoded = clean.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `${databaseURL}/${encoded}.json`;
}

const PROVISIONER_APP_NAME = 'account-provisioner';

/**
 * Creates a Firebase Auth user without disturbing the signed-in session.
 *
 * createUserWithEmailAndPassword always signs the calling client in as the new
 * user, which would log the owner out mid-flow. Running it on a second app
 * instance bound to the same config leaves the primary auth untouched — that
 * client never observes a state change.
 *
 * Returns the new uid. Creating the auth user grants no data access on its own;
 * the caller must write the matching database records.
 */
export async function provisionAuthAccount(email, password) {
  const stale = getApps().find((app) => app.name === PROVISIONER_APP_NAME);
  if (stale) await deleteApp(stale);

  const secondary = initializeApp(firebaseConfig, PROVISIONER_APP_NAME);
  try {
    const secondaryAuth = getAuth(secondary);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const { uid } = credential.user;
    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}
