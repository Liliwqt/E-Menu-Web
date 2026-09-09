const c = require(process.env.HOME + '/.config/configstore/firebase-tools.json');
const t = c.tokens || {};
console.log(JSON.stringify({
  hasRefresh: !!t.refresh_token,
  hasAccess: !!t.access_token,
  expiresAt: t.expires_at,
  scopes: (t.scopes || []).slice(0, 3),
}));