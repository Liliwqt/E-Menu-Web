import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inventoryCleanupPlan, MENU_INVENTORY_OP, mergeRenamedInventory } from './menuInventorySync.js';
const source = fs.readFileSync(new URL('./menuApi.js', import.meta.url), 'utf8');
const cleanup = source.slice(source.indexOf('async function applyInventoryCleanup'), source.indexOf('export async function removeCategory'));
for (const failure of ['read', 'write']) {
  test(`rename preserves source inventory when destination ${failure} fails`, async () => {
    const deleted = [];
    const context = vm.createContext({ console: { error() {} }, mergeRenamedInventory,
      dbUrl: p => p,
      fetchWithAppCheck: async p => ({ ok: !(failure === 'read' && p.endsWith('/New')), json: async () => ({ coffee: { sizes: { Medium: { stock: 18 } } } }) }),
      menuWrite: async (p, options) => { if (options.method === 'PUT') { assert.equal(failure, 'write', 'refused reads must stop before writing'); throw Error('offline'); } deleted.push(p); },
    });
    vm.runInContext(cleanup + ';globalThis.run = applyInventoryCleanup', context);
    assert.equal(await context.run('branch', inventoryCleanupPlan({ op: MENU_INVENTORY_OP.CATEGORY_RENAME, category: 'Old', newCategory: 'New' })), false);
    assert.deepEqual(deleted, []);
  });
}
test('inventory reconciliation preserves a manual sold-out flag despite positive stock', async () => {
  const source = fs.readFileSync(new URL('./inventoryApi.js', import.meta.url), 'utf8');
  const writes = [];
  const context = vm.createContext({ database: {}, ref: (_, p) => p, branchDataPath: p => p,
    readStock: s => s.stock, update: async (_, values) => writes.push(values) });
  vm.runInContext(source.slice(source.indexOf('function isMenuAvailable')).replace('export async function', 'async function') + ';globalThis.run = syncMenuAvailabilityFromData', context);
  await context.run('branch', { Drinks: { coffee: { available: false, manualUnavailable: true } } }, { Drinks: { coffee: { sizes: { Medium: { stock: 18 } } } } });
  assert.deepEqual(writes, []);
});
test('availability button uses the field-scoped API', () => {
  const page = fs.readFileSync(new URL('../pages/MenuPage.jsx', import.meta.url), 'utf8');
  assert.match(page, /setItemAvailability\(branchId, cat, key, !available\)/);
  assert.match(source, /export async function setItemAvailability/);
});
