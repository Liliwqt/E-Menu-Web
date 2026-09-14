import fs from 'node:fs';
import { getAccessToken } from './firebase-cli-auth.mjs';

const env = fs.readFileSync('.env', 'utf8');
const readEnv = (key) => {
  const match = env.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
};

const db = readEnv('VITE_FIREBASE_DATABASE_URL');
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
