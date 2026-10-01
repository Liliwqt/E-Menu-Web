import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PUBLICATION, PUBLIC_PAGES, publicationIssues, subscriptionCancellationEmail } from './publicSiteContent.js';
import { PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, PLAN_PRICE_PHP } from './planFeatures.js';

test('draft business and policy details block public Hosting release', () => {
  assert.ok(publicationIssues(PUBLICATION).length > 0);
  assert.deepEqual(PUBLIC_PAGES.map(([path]) => path), [
    'about', 'pricing', 'contact', 'terms', 'privacy', 'refund-policy',
  ]);
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
  assert.ok(issues.includes('Activity tracking, email/in-app warnings, complete export and deletion are unimplemented'));
  assert.ok(issues.includes('Complete physical address and provider acceptance are unresolved'));
  assert.ok(publicationIssues({ ...PUBLICATION, releaseBlockers: undefined }).includes('Publication blockers have not been reviewed'));
});

test('cancellation email safely includes only the selected company and branch', () => {
  const url = new URL(subscriptionCancellationEmail('company-test&bcc=other@example.test', 'branch-one\nTwo'));
  assert.equal(url.pathname, 'touch.support1@gmail.com');
  assert.equal(url.searchParams.size, 2);
  assert.equal(url.searchParams.get('subject'), 'E-Menu subscription cancellation request');
  assert.match(url.searchParams.get('body'), /Company ID: company-test&bcc=other@example.test/);
  assert.match(url.searchParams.get('body'), /Branch ID: branch-one\nTwo/);
  assert.match(url.searchParams.get('body'), /opening this email does not cancel/);
});

test('public plan prices share the application tier values', () => {
  assert.deepEqual([PLAN_PRICE_PHP[PLAN_BASIC], PLAN_PRICE_PHP[PLAN_STARTER], PLAN_PRICE_PHP[PLAN_PREMIUM]], [750, 1100, 1750]);
});

test('Firebase Hosting runs the public release check before deployment', () => {
  const config = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'));
  assert.ok(config.hosting.predeploy.includes('npm run check:public-release'));
});
