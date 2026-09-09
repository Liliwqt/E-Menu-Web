// REST PUT to a LEAF (companyProfile) — closest to set() — 5 fresh companies.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
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
await signInAnonymously(auth);
const uid = auth.currentUser.uid;
const token = await auth.currentUser.getIdToken();
const base = 'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app';

for (let i = 0; i < 5; i++) {
  const co = 'company-leaf-' + Date.now().toString(36) + i;
  const r = await fetch(`${base}/${co}/companyProfile.json?auth=${token}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId: co, companyName: 'Debug Co', ownerUids: { [uid]: true }, createdAt: 1700000000000 }),
  });
  const txt = await r.text();
  console.log(`run ${i}: status ${r.status} ${r.status !== 200 ? txt.slice(0, 80) : 'OK'}`);
  if (r.status === 200) await fetch(`${base}/${co}.json?auth=${token}`, { method: 'DELETE' });
}
process.exit(0);
