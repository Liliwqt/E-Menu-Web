import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('payment setup route and navigation remain owner-only', () => {
  const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../components/layout/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/payments\/:branchId"\s+element=\{branchRoute\(PaymentSettingsPage, CAP\.MANAGE_BILLING\)\}/);
  const entry = shell.split('\n').find((line) => /key:\s*'payments'/.test(line));
  assert.ok(entry);
  assert.match(entry, /cap:\s*CAP\.MANAGE_BILLING/);
});

test('payment settings use authenticated backend calls and never provider secrets', () => {
  const page = fs.readFileSync(new URL('../pages/PaymentSettingsPage.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('./paymentApi.js', import.meta.url), 'utf8');
  assert.match(api, /fetchWithAppCheck/);
  assert.match(api, /\/api\/payments\/merchant\/status/);
  assert.match(api, /\/api\/payments\/refunds/);
  assert.doesNotMatch(page + api, /PAYMONGO_SECRET_KEY|webhookSecret|sk_live_|sk_test_/);
});
