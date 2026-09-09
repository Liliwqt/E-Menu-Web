#!/usr/bin/env node
// Fetch the latest released Realtime Database rules for the project and print them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectId = process.argv[2] || 'device-streaming-ded679cd';
const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');

if (!fs.existsSync(configPath)) {
  console.error('firebase-tools configstore not found at', configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const refreshToken = config.tokens?.refresh_token;
if (!refreshToken) {
  console.error('No refresh token in configstore. Run `npx firebase login` first.');
  process.exit(1);
}

// firebase-tools client_id/secret are public and shipped inside the CLI package.
const cliPkgPaths = [
  path.resolve('firebase-tests/node_modules/firebase-tools'),
  process.cwd(),
];
let clientId;
let clientSecret;
for (const p of cliPkgPaths) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(p, 'node_modules/firebase-tools/package.json'), 'utf8'));
    break;
  } catch {}
}
// Read the embedded client credentials from the installed CLI source.
const cliSrc = path.resolve(process.cwd(), 'node_modules/firebase-tools');
try {
  const apiDefaults = fs.readFileSync(path.join(cliSrc, 'lib/api.js'), 'utf8');
  const idMatch = apiDefaults.match(/client_id:\s*"([^"]+)"/);
  const secretMatch = apiDefaults.match(/client_secret:\s*"([^"]+)"/);
  if (idMatch && secretMatch) {
    clientId = idMatch[1];
    clientSecret = secretMatch[1];
  }
} catch {}
if (!clientId) {
  // Fallback: known public firebase-cli client credentials
  clientId = '577034912820-n9j9n11bjm5jlisjks5t8k39eudnhkqf.apps.googleusercontent.com';
  clientSecret = 'bohAiP9gUBUv1YkpFPSkYKoL';
}

const tokens = config.tokens || {};
let accessToken = tokens.access_token;
const now = Date.now();
if (!accessToken || (tokens.expires_at && now > Number(tokens.expires_at) - 60000)) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenRes.ok) {
    console.error('Token refresh failed:', tokenRes.status, await tokenRes.text());
    process.exit(1);
  }
  const tokenData = await tokenRes.json();
  accessToken = tokenData.access_token;
}

const listRes = await fetch(
  `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets?pageSize=10`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
if (!listRes.ok) {
  console.error('List rulesets failed:', listRes.status, await listRes.text());
  process.exit(1);
}
const list = await listRes.json();
const rulesets = (list.rulesets || []).sort((a, b) =>
  String(b.metadata?.created ?? '').localeCompare(String(a.metadata?.created ?? ''))
);
if (rulesets.length === 0) {
  console.error('No rulesets found for', projectId);
  process.exit(1);
}

const latest = rulesets[0];
console.log(`# Latest ruleset: ${latest.name}`);
console.log(`# Created: ${latest.metadata?.created ?? 'unknown'}`);
console.log(`# Total rulesets on project: ${rulesets.length}`);
for (const file of latest.source?.files ?? []) {
  console.log(`\n# ---- file: ${file.name} ----\n`);
  console.log(file.content);
}
