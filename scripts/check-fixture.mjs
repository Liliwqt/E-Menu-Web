import fs from 'node:fs';
import { getAccessToken } from './firebase-cli-auth.mjs';

const env = fs.readFileSync('.env', 'utf8');
const readEnv = (key) => {
  const match = env.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
};

const db = readEnv('VITE_FIREBASE_DATABASE_URL');
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
