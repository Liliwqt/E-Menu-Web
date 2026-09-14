/**
 * Manual probe: does the live database accept the exact payload onboarding sends?
 *
 * Run by hand, not by the test suite:
 *   node scripts/probe-app-workspaceapi.mjs
 *
 * ⚠ This talks to PRODUCTION. It signs in anonymously, writes a throwaway company
 * and branch to the real database, checks the write is accepted, then deletes them.
 * The rules are what is being probed — they only exist in their real form on the
 * live project — so there is no offline version of this check.
 *
 * It used to be named `test-app-workspaceapi.mjs`, which put it inside the glob
 * `node --test` matches (`**​/test-*.mjs`). The unit suite was therefore signing in
 * to production and creating a company on every run, and failing intermittently
 * whenever the network or anonymous sign-in hiccupped. A probe with side effects
 * does not belong in a suite that is meant to be repeatable and offline.
 *
 * Exits non-zero when the write is refused, so a manual run reports something.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, update, set, serverTimestamp } from 'firebase/database';
const app = initializeApp({
  apiKey: 'AIzaSyDdY1ESTDIptCZeUriJC9CLbXSMZV7r9sc',
  authDomain: 'device-streaming-ded679cd.firebaseapp.com',
  databaseURL: 'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'device-streaming-ded679cd',
  storageBucket: 'device-streaming-ded679cd.firebasestorage.app',
  messagingSenderId: '1068154214012',
  appId: '1:1068154214012:web:eac3ffc327cad2e255dbf9',
});
const auth = getAuth(app);
const db = getDatabase(app);
await signInAnonymously(auth);
const uid = auth.currentUser.uid;
console.log('uid:', uid);

// Recreate createCompanyId + createBranchId EXACTLY as the app
const cleanText = (v, max) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
function createCompanyId(companyName) {
  const stem = cleanText(companyName, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'company';
  const random = Math.random().toString(36).slice(2, 8);
  return `company-${stem}-${random}`;
}
function createBranchId(companyName, branchName = '') {
  const stem = cleanText(`${companyName}-${branchName}`, 100).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38) || 'restaurant';
  const random = Math.random().toString(36).slice(2, 8);
  return `branch-${stem}-${random}`;
}

const company = 'Touch Co Test';
const name = 'Main';
const companyId = createCompanyId(company);
const branchId = createBranchId(company, name);
const now = serverTimestamp();
console.log('companyId:', companyId);
console.log('branchId:', branchId);

// EXACT Step-1 payload from createWorkspace()
const payload = {
  companyProfile: {
    companyId,
    companyName: company,
    ownerUids: { [uid]: true },
    createdAt: now,
  },
  [`branches/${branchId}/branchProfile`]: {
    branchId,
    businessName: company,
    companyName: company,
    name,
    branchName: name,
    location: 'Test City',
    serviceType: 'restaurant',
    contactPhone: '123',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    operatingHours: '9AM-9PM',
    ownerUid: uid,
    plan: 'free',
    subscriptionStatus: 'inactive',
    trialEndsAt: null,
    createdAt: now,
  },
};

let refused = false;
try {
  await update(ref(db, companyId), payload);
  console.log('STEP 1 EXACT APP PAYLOAD: PASS');
} catch (e) {
  refused = true;
  console.log('STEP 1 EXACT APP PAYLOAD: FAIL', e.code, (e.message || '').split('\n')[0]);
}
try { await set(ref(db, companyId), null); } catch {}
process.exit(refused ? 1 : 0);
