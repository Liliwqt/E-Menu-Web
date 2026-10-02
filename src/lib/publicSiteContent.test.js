import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PUBLICATION, PUBLIC_PAGES, PUBLIC_NAV, publicationIssues } from './publicSiteContent.js';
import { PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, PLAN_PRICE_PHP } from './planFeatures.js';

test('draft business and policy details block public Hosting release', () => {
  assert.ok(publicationIssues(PUBLICATION).length > 0);
  // Pinned deliberately: `check-public-release.mjs` iterates PUBLIC_PAGES and
  // blocks a Hosting deploy if any listed route is missing from App.jsx, so adding
  // a page here without adding its route would fail the deploy rather than the
  // suite. /help, /cookies and /acceptable-use were added on 2026-10-02.
  assert.deepEqual(PUBLIC_PAGES.map(([path]) => path), [
    'about', 'pricing', 'contact', 'help',
    'terms', 'privacy', 'cookies', 'acceptable-use',
    'refund-policy',
  ]);
});

test('every listed public page also has a header route', () => {
  // The header carries a subset, so this must be a subset check rather than equality.
  const headerPaths = PUBLIC_NAV.map(([path]) => path);
  for (const path of headerPaths) {
    assert.ok(PUBLIC_PAGES.some(([listed]) => listed === path), `${path} is in the header but not in PUBLIC_PAGES`);
  }
  // And the pages a reader needs but does not want in the header must still be reachable.
  for (const path of ['help', 'cookies', 'acceptable-use', 'refund-policy', 'terms', 'privacy']) {
    assert.ok(PUBLIC_PAGES.some(([listed]) => listed === path), `${path} must remain a public page`);
  }
});

test('completed details pass while placeholders and bad contact emails fail', () => {
  const complete = Object.fromEntries(Object.keys(PUBLICATION).map(key => [key, 'Reviewed terms']));
  Object.assign(complete, {
    status: 'approved', reviewedAt: '2026-10-01', businessName: 'Sample Business',
    philippinesAddress: 'Sample street, Manila, Philippines',
    supportEmail: 'support@example.com', privacyEmail: 'privacy@example.com',
    releaseBlockers: [],
  });
  assert.deepEqual(publicationIssues(complete), []);
  assert.ok(publicationIssues({ ...complete, subscriptionRefundTerms: 'TBD' }).some(issue => issue.includes('draft text')));
  assert.ok(publicationIssues({ ...complete, supportEmail: 'bad address' }).some(issue => issue.includes('invalid')));
});

test('approval alone cannot bypass known missing policy functionality', () => {
  const issues = publicationIssues({ ...PUBLICATION, status: 'approved', reviewedAt: '2026-10-01' });
  assert.ok(issues.includes('Gmail delivery, private storage and scheduled lifecycle processing require configuration and verification'));
  assert.ok(issues.includes('PayMongo acceptance of operator identity and address is unverified'));
  assert.ok(publicationIssues({ ...PUBLICATION, releaseBlockers: undefined }).includes('Publication blockers have not been reviewed'));
});

test('shared public facts describe the active cancellation and payment controls', () => {
  assert.match(PUBLICATION.subscriptionCancellationTerms, /owner.*cancel.*Subscription page/is);
  assert.match(PUBLICATION.subscriptionCancellationTerms, /immediately ends subscription benefits/i);
  assert.match(PUBLICATION.subscriptionCancellationTerms, /does not itself issue a refund/i);
  assert.doesNotMatch(PUBLICATION.subscriptionCancellationTerms, /email request|contact.*to cancel/i);
  assert.match(PUBLICATION.customerPaymentNotice, /not proof that funds were received/i);
  assert.match(PUBLICATION.customerPaymentNotice, /only after the payment provider confirms it/i);
  assert.match(PUBLICATION.customerPaymentNotice, /not yet enabled in the current release/i);
  assert.match(PUBLICATION.dataRetentionSummary, /Automatic inactivity deletion is not yet active/i);
  assert.equal(PUBLICATION.status, 'draft');
});

test('public plan prices share the application tier values', () => {
  assert.deepEqual([PLAN_PRICE_PHP[PLAN_BASIC], PLAN_PRICE_PHP[PLAN_STARTER], PLAN_PRICE_PHP[PLAN_PREMIUM]], [750, 1100, 1750]);
});

test('Firebase Hosting runs the public release check before deployment', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
  assert.ok(config.hosting.predeploy.includes('npm run check:public-release'));
});
