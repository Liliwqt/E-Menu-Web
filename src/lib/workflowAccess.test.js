import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { can, CAP } from './permissions.js';
import { orderInDateRange } from './orderFilters.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('staff menu route and navigation expose availability without structural permissions', () => {
  // The menu route is gated by TOGGLE_AVAILABILITY whether it is declared through
  // shellRoute (page inside the shell) or branchRoute (standalone page).
  assert.match(source('../App.jsx'), /(shell|branch)Route\(MenuPage, CAP\.TOGGLE_AVAILABILITY\)/);
  assert.match(source('../components/layout/AppShell.jsx'), /key: 'menu'.*cap: CAP\.TOGGLE_AVAILABILITY/);
  assert.equal(can('staff', CAP.TOGGLE_AVAILABILITY), true);
  for (const cap of [CAP.MANAGE_ITEMS, CAP.MANAGE_MENU, CAP.DELETE_MENU_ITEM, CAP.DELETE_CATEGORY, CAP.RENAME_CATEGORY]) assert.equal(can('staff', cap), false);
});
test('account and branch navigation remounts page state before old content can render', () => {
  assert.match(source('../App.jsx'), /BranchDataProvider key=\{`\$\{user\?\.uid\}:\$\{workspace\?\.companyId\}:\$\{branchId\}`\}/);
});
test('order ranges include full local days and keep undated orders in the default view', () => {
  const date = (hour, minute = 0) => new Date(2026, 8, 20, hour, minute).getTime();
  assert.equal(orderInDateRange({}, '', ''), true);
  for (const timestamp of [date(0), date(23, 59)]) assert.equal(orderInDateRange({ timestamp }, '2026-09-20', '2026-09-20'), true);
  assert.equal(orderInDateRange({ timestamp: date(0) - 1 }, '2026-09-20', ''), false);
  assert.equal(orderInDateRange({ createdAt: date(0) }, '', '2026-09-19'), false);
  assert.equal(orderInDateRange({ timestamp: 'invalid' }, '2026-09-20', ''), false);
  assert.equal(orderInDateRange({}, '2026-09-20', ''), false);
  assert.equal(orderInDateRange({ timestamp: date(12) }, '2026-09-21', '2026-09-20'), false);
});
