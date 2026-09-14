import { getAccessToken, readRepoEnv } from './firebase-cli-auth.mjs';

const db = readRepoEnv('VITE_FIREBASE_DATABASE_URL');
const headers = { Authorization: `Bearer ${await getAccessToken()}` };
const read = (p) => fetch(`${db}/${p}.json`, { headers }).then((r) => r.json());

const BRANCH = 'company-test1-xm5llx/branches/branch-test1-branch1-85sr93';
const roster = await read(`${BRANCH}/users`);
const profile = await read(`${BRANCH}/branchProfile`);
const logs = await read(`${BRANCH}/logs`);

console.log('members   =', Object.keys(roster).length);
for (const [, row] of Object.entries(roster)) console.log('   ', row.role.padEnd(8), row.email);
console.log('managerUid=', profile.managerUid ? 'set (liliw)' : 'MISSING');
console.log('orders    =', Object.keys(logs || {}).length);
