import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The page already has an owner-only billing guard. The route and navigation
// must let other branch members reach its read-only view. These wiring checks
// catch the gates that previously made that view unreachable in the browser.
test('subscription route lets authenticated branch members reach the read-only view', () => {
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/subscription\/:branchId"\s+element=\{branchRoute\(SubscriptionPage\)\}/);
});

test('subscription navigation is available without billing-management capability', () => {
  const shell = fs.readFileSync(new URL('../components/layout/AppShell.jsx', import.meta.url), 'utf8');
  const entry = shell.split('\n').find(line => /key:\s*'subscription'/.test(line));
  assert.ok(entry, 'The subscription navigation entry must exist');
  assert.doesNotMatch(entry, /\bcap\s*:/, 'Reading the branch plan does not require changing it');
});
