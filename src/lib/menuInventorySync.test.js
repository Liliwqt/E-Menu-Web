import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_INVENTORY_OP,
  inventoryCleanupPlan,
  inventoryPathForCategory,
  inventoryPathForItem,
  mergeRenamedInventory,
} from './menuInventorySync.js';

test('deleting an item clears that item’s stock row', () => {
  // The regression this exists for: the menu entry vanished while its stock row
  // stayed, and the Inventory screen kept listing a product that was gone.
  const plan = inventoryCleanupPlan({
    op: MENU_INVENTORY_OP.ITEM_DELETE,
    category: 'Drinks',
    itemKey: 'iced_latte',
  });
  assert.deepEqual(plan.remove, ['inventory/Drinks/iced_latte']);
  assert.equal(plan.move, null);
});

test('deleting a category clears the category’s whole stock subtree', () => {
  const plan = inventoryCleanupPlan({
    op: MENU_INVENTORY_OP.CATEGORY_DELETE,
    category: 'Drinks',
  });
  // The whole node, not each item: the category is going, so nothing under it
  // should stay. A ghost heading is what this prevents.
  assert.deepEqual(plan.remove, ['inventory/Drinks']);
});

test('renaming a category moves its stock rather than leaving it behind', () => {
  // Leaving it behind is worse than it sounds: the renamed category gets fresh
  // default counts from the inventory sync, so the real stock is not just
  // orphaned, it is effectively replaced by placeholder numbers.
  const plan = inventoryCleanupPlan({
    op: MENU_INVENTORY_OP.CATEGORY_RENAME,
    category: 'Drinks',
    newCategory: 'Beverages',
  });
  assert.deepEqual(plan.move, { from: 'inventory/Drinks', to: 'inventory/Beverages' });
  assert.deepEqual(plan.remove, ['inventory/Drinks']);
});

test('a rename that changes nothing plans no work', () => {
  // Otherwise the move would put a node inside itself and the remove would delete
  // the source, which is data loss from a no-op.
  const plan = inventoryCleanupPlan({
    op: MENU_INVENTORY_OP.CATEGORY_RENAME,
    category: 'Drinks',
    newCategory: 'Drinks',
  });
  assert.deepEqual(plan, { remove: [], move: null });
});

test('an operation missing its identifiers plans nothing', () => {
  // Half-known paths must not be built: `inventory/undefined` is a real node, and
  // writing to it would create the very junk this is meant to clear.
  assert.deepEqual(inventoryCleanupPlan({ op: MENU_INVENTORY_OP.ITEM_DELETE, category: 'Drinks' }),
    { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan({ op: MENU_INVENTORY_OP.ITEM_DELETE, itemKey: 'x' }),
    { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan({ op: MENU_INVENTORY_OP.CATEGORY_DELETE }),
    { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan({ op: MENU_INVENTORY_OP.CATEGORY_RENAME, category: 'Drinks' }),
    { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan({ op: 'something-else', category: 'Drinks' }),
    { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan({}), { remove: [], move: null });
  assert.deepEqual(inventoryCleanupPlan(), { remove: [], move: null });
});

test('the move and the remove point at the same source path', () => {
  // If they disagreed, the stock would be copied somewhere and the original left
  // in place — a duplicate rather than a rename.
  const plan = inventoryCleanupPlan({
    op: MENU_INVENTORY_OP.CATEGORY_RENAME,
    category: 'Drinks',
    newCategory: 'Beverages',
  });
  assert.equal(plan.move.from, plan.remove[0]);
});

test('the stock path mirrors the menu path it belongs to', () => {
  assert.equal(inventoryPathForCategory('Drinks'), 'inventory/Drinks');
  assert.equal(inventoryPathForItem('Drinks', 'iced_latte'), 'inventory/Drinks/iced_latte');
  // Deliberately NOT under categories/: the two trees are siblings, which is the
  // whole reason a menu delete does not touch stock on its own.
  assert.ok(!inventoryPathForItem('Drinks', 'iced_latte').startsWith('categories/'));
});

test('a rename keeps the counts of the category being renamed', () => {
  const merged = mergeRenamedInventory({
    existing: { tea: { sizes: { Medium: { stock: 1 } } } },
    moved: { tea: { sizes: { Medium: { stock: 12 } } }, coffee: { sizes: {} } },
  });
  assert.equal(merged.tea.sizes.Medium.stock, 12);
  assert.ok(merged.coffee, 'an item that exists only under the new name is kept');
});

test('a rename onto an empty name moves the stock unchanged', () => {
  const moved = { tea: { sizes: {} } };
  assert.deepEqual(mergeRenamedInventory({ existing: null, moved }), moved);
  assert.deepEqual(mergeRenamedInventory({ existing: {}, moved }), moved);
});

test('nothing to move yields null, so the new name is left alone', () => {
  // Null rather than {} because writing {} would erase whatever the new name
  // already holds.
  assert.equal(mergeRenamedInventory({ existing: { a: 1 }, moved: null }), null);
  assert.equal(mergeRenamedInventory({ existing: { a: 1 }, moved: {} }), null);
  assert.equal(mergeRenamedInventory({}), null);
  assert.equal(mergeRenamedInventory(), null);
});
