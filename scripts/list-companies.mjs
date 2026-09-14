import { getAccessToken, readRepoEnv } from './firebase-cli-auth.mjs';

const db = readRepoEnv('VITE_FIREBASE_DATABASE_URL');
const headers = { Authorization: `Bearer ${await getAccessToken()}` };

const root = await fetch(`${db}/.json?shallow=true`, { headers }).then((r) => r.json());
const keys = Object.keys(root || {});

console.log('top-level keys:', keys.join(', '));
const companyKeys = keys.filter((k) => k.startsWith('company-'));
console.log('companies in the database:', companyKeys.length);
for (const key of companyKeys) {
  const profile = await fetch(`${db}/${key}/companyProfile.json`, { headers }).then((r) => r.json());
  const branches = await fetch(`${db}/${key}/branches.json?shallow=true`, { headers }).then((r) => r.json());
  console.log(
    '  ', key,
    '| name =', profile?.companyName ?? '(no profile)',
    '| branches =', Object.keys(branches || {}).join(',') || '(none)'
  );
}
