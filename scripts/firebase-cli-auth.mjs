// Shared helper: mint a fresh Firebase RTDB access token using the Firebase CLI's
// stored refresh token. The OAuth client_id/client_secret are read from the
// installed firebase-tools package at runtime — never hardcoded here.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findFirebaseTools() {
  const candidates = [
    path.resolve('firebase-tests/node_modules/firebase-tools'),
    path.resolve('node_modules/firebase-tools'),
    path.join(os.homedir(), '.npm-global/lib/node_modules/firebase-tools'),
    path.join(os.homedir(), 'node_modules/firebase-tools'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'lib/api.js'))) return dir;
  }
  return null;
}

function readCliOAuthCredentials() {
  const cliSrc = findFirebaseTools();
  if (!cliSrc) {
    throw new Error('firebase-tools package not found. Run `npm ci` in firebase-tests/ first.');
  }
  const apiDefaults = fs.readFileSync(path.join(cliSrc, 'lib/api.js'), 'utf8');
  const clientId = apiDefaults.match(/client_id:\s*"([^"]+)"/)?.[1];
  const clientSecret = apiDefaults.match(/client_secret:\s*"([^"]+)"/)?.[1];
  if (!clientId || !clientSecret) {
    throw new Error('Could not read OAuth credentials from firebase-tools lib/api.js');
  }
  return { clientId, clientSecret };
}

function readStoredTokens() {
  const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Firebase CLI config not found. Run `firebase login` first.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return config.tokens || {};
}

/** Returns a valid access token, refreshing it if the stored one is stale. */
export async function getAccessToken() {
  const tokens = readStoredTokens();
  if (tokens.access_token && (!tokens.expires_at || Date.now() < Number(tokens.expires_at) - 60000)) {
    return tokens.access_token;
  }
  if (!tokens.refresh_token) {
    throw new Error('No refresh token stored. Run `firebase login` first.');
  }
  const { clientId, clientSecret } = readCliOAuthCredentials();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Token refresh returned no access_token.');
  }
  return data.access_token;
}