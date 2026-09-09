const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { getAccessToken } = await import('./firebase-cli-auth.mjs');
  const accessToken = await getAccessToken();

  const base =
    'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app';
  const depth = parseInt(process.argv[2] || '1', 10);
  const target = (process.argv[3] || '').replace(/^\/+|\/+$/g, '');
  const shallow = depth <= 1 ? 'true' : 'false';
  const url = `${base}/${target}.json${target ? '' : ''}?shallow=${shallow}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  console.log('status', res.status);
  console.log('url', url);
  console.log((await res.text()).slice(0, 6000));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});