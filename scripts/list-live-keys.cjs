#!/usr/bin/env node
// List top-level keys in the live RTDB using the stored Firebase CLI refresh token.
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectId = 'device-streaming-ded679cd';
const configPath = path.join(os.homedir(), '.config/configstore/firebase-tools.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const refreshToken = config.tokens && config.tokens.refresh_token;
if (!refreshToken) {
  console.error('No refresh token found.');
  process.exit(1);
}

const cliSrc = path.resolve('firebase-tests/node_modules/firebase-tools');
const apiDefaults = fs.readFileSync(path.join(cliSrc, 'lib/api.js'), 'utf8');
const clientId = apiDefaults.match(/client_id:\s*"([^"]+)"/)[1];
const clientSecret = apiDefaults.match(/client_secret:\s*"([^"]+)"/)[1];
const apiKey = 'AIzaSyDdY1ESTDIptCZeUriJC9CLbXSMZV7r9sc';
const dbUrl = `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`;

(async () => {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const j = await r.json();
  if (!j.access_token) {
    console.error('Token refresh failed:', j);
    process.exit(1);
  }
  console.log('got access token');

  const depth = parseInt(process.argv[2] || '1', 10);
  const target = process.argv[3] || '';
  const url = `${dbUrl}/${target}.json?shallow=${depth <= 1 ? 'true' : 'false'}`;
  const q = await fetch(url, { headers: { Authorization: 'Bearer ' + j.access_token } });
  console.log('status', q.status, 'url', url);
  const body = await q.text();
  console.log(body.slice(0, 4000));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});