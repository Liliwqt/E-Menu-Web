const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const { getAccessToken } = await import('./firebase-cli-auth.mjs');
  const accessToken = await getAccessToken();

  const base =
    'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app/.settings/rules.json';
  const res = await fetch(base, { headers: { Authorization: `Bearer ${accessToken}` } });
  console.log('status', res.status);
  if (res.ok) {
    const txt = await res.text();
    fs.writeFileSync('/tmp/enforced-rules-now.json', txt);
    console.log('saved to /tmp/enforced-rules-now.json, bytes:', txt.length);
    console.log('has version marker:', txt.includes('RULES_VERSION'));
    console.log('has bootstrap escape (companyProfile exists):', txt.includes("!root.child($companyId).child('companyProfile').exists()"));
    console.log('has legacy branch2:', txt.includes('branch2'));
    console.log('has root users:', txt.includes('"users"'));
  } else {
    console.log(await res.text());
  }
})();