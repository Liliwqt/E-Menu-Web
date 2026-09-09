// Run the ACTUAL createWorkspace() from the app against the live DB with anonymous auth.
// We cannot import the app's module directly (it needs Vite env), so replicate EXACTLY,
// including differing branch fields, sentinels, and nulls.
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

try {
  await update(ref(db, companyId), payload);
  console.log('STEP 1 EXACT APP PAYLOAD: PASS');
} catch (e) {
  console.log('STEP 1 EXACT APP PAYLOAD: FAIL', e.code, (e.message || '').split('\n')[0]);
}
try { await set(ref(db, companyId), null); } catch {}
process.exit(0);
