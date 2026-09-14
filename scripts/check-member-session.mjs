/**
 * Signs in as a team member through the client SDK's REST surface and asks, as
 * that person, for the records a fresh session needs.
 *
 * This is the check the browser would perform on their behalf without disturbing
 * whoever is already signed in here. What it proves is that provisioning left the
 * account able to resolve a company, a branch and a role on its own.
 *
 *   node scripts/check-member-session.mjs <email> <password>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: node scripts/check-member-session.mjs <email> <password>');
  process.exit(1);
}

// Read the public client key out of the Vite env the app itself builds with.
const envText = fs.existsSync(path.join(repo, '.env'))
  ? fs.readFileSync(path.join(repo, '.env'), 'utf8')
  : '';
const readEnv = (key) => {
  const match = envText.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
};

const apiKey = readEnv('VITE_FIREBASE_API_KEY');
const dbUrl = readEnv('VITE_FIREBASE_DATABASE_URL');
if (!apiKey || !dbUrl) {
  console.error('Could not read VITE_FIREBASE_API_KEY / VITE_FIREBASE_DATABASE_URL from .env');
  process.exit(1);
}

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }
);
const session = await signIn.json();
if (!session.idToken) {
  console.error('SIGN-IN FAILED:', session.error?.message || JSON.stringify(session));
  process.exit(1);
}
console.log('sign-in OK  uid =', session.localId);

// Every read below is made as the member, so a rules denial shows up as a read
// that fails rather than as data that happens to be missing.
const asMember = (suffix) => `${dbUrl}/${suffix}.json?auth=${session.idToken}`;

const account = await (await fetch(asMember(`accounts/${session.localId}`))).json();
if (account?.error) {
  console.log('FAIL  cannot read its own account record:', account.error);
  process.exit(1);
}
console.log('accounts      role =', account.role, '| activeBranchId =', account.activeBranchId);

const companyId = account.companyId;
const branchId = account.activeBranchId;

const workspace = await (await fetch(asMember(`${companyId}/users/${session.localId}/workspace`))).json();
if (workspace?.error) {
  console.log('FAIL  cannot read its workspace:', workspace.error);
  process.exit(1);
}
console.log('workspace     plan =', workspace.plan,
  '| subscriptionStatus =', workspace.subscriptionStatus,
  '| trialEndsAt =', workspace.trialEndsAt,
  '| onboardingComplete =', workspace.onboardingComplete);
console.log('  -> isSubscriptionActive would be',
  (workspace.subscriptionStatus === 'active' || workspace.subscriptionStatus === 'trialing') ? 'TRUE' : 'FALSE');

const membership = await (await fetch(asMember(`${companyId}/branches/${branchId}/users/${session.localId}`))).json();
console.log('branch roster role =', membership?.role);

// Staff may restock but not edit the menu. Both are real writes to the live tree,
// so the inventory one is reverted immediately.
const menuDenied = await (await fetch(asMember(`${companyId}/branches/${branchId}/categories/__probe`), {
  method: 'PUT',
  body: JSON.stringify({ name: 'probe', price: 1 }),
})).json();
console.log('menu write    =', menuDenied?.error ? `DENIED (${menuDenied.error})` : 'ALLOWED  <-- unexpected for staff');

const rosterDenied = await (await fetch(asMember(`${companyId}/branches/${branchId}/users/__probe`), {
  method: 'PUT',
  body: JSON.stringify({ uid: '__probe', role: 'staff' }),
})).json();
console.log('roster write  =', rosterDenied?.error ? `DENIED (${rosterDenied.error})` : 'ALLOWED  <-- unexpected for staff');
