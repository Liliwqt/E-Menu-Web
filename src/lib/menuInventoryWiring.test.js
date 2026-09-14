import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Checks that the menu functions actually perform the stock cleanup.
 *
 * The tests in menuInventorySync.test.js prove the PLAN is right — which paths a
 * menu edit should touch. They say nothing about whether anything calls it, and
 * that is the gap this closes: reverting the fix is a matter of deleting one line
 * from menuApi.js, and every other test in the suite would still pass. The bug
 * being guarded against was exactly that shape — correct-looking code with a step
 * missing — so a test that cannot notice the step going missing is not much of a
 * guard.
 *
 * This reads the source rather than running it, which makes it a heuristic: it
 * would be satisfied by a call that is never reached, and it would not catch the
 * cleanup being wrong, only absent. Anything stronger needs the database, and
 * these tests do not touch one. It is worth having anyway, because the failure it
 * catches is silent and the cost of the check is nothing.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const menuApi = fs.readFileSync(path.join(here, 'menuApi.js'), 'utf8');

/** The body of one exported function, from its declaration to the next one. */
function functionBody(name) {
  const start = menuApi.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist in menuApi.js`);
  const rest = menuApi.slice(start);
  const next = rest.slice(1).search(/\nexport (async )?function |\n\/\*\*/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('deleting an item clears the matching stock', () => {
  const body = functionBody('deleteItem');
  assert.match(body, /applyInventoryCleanup\(/, 'deleteItem must clear the stock row');
  assert.match(body, /MENU_INVENTORY_OP\.ITEM_DELETE/,
    'and it must be the item-level cleanup, not the category-level one');
});

test('deleting a category clears the category’s stock too', () => {
  const body = functionBody('removeCategory');
  assert.match(body, /applyInventoryCleanup\(/);
  assert.match(body, /MENU_INVENTORY_OP\.CATEGORY_DELETE/);
});

test('renaming a category moves its stock', () => {
  const body = functionBody('renameCategory');
  assert.match(body, /applyInventoryCleanup\(/);
  assert.match(body, /MENU_INVENTORY_OP\.CATEGORY_RENAME/);
});

test('the three menu operations do not share one cleanup by accident', () => {
  // A single wrong constant would clear the whole category on an item delete, or
  // leave the stock behind on a rename — both silent, both the bug this fixes.
  const ops = ['deleteItem', 'removeCategory', 'renameCategory']
    .map((name) => (functionBody(name).match(/MENU_INVENTORY_OP\.(\w+)/) || [])[1]);
  assert.deepEqual(ops, ['ITEM_DELETE', 'CATEGORY_DELETE', 'CATEGORY_RENAME']);
});

test('the cleanup runs after the menu write it belongs to', () => {
  // Clearing stock before the menu change would leave the reverse orphan if the
  // menu write then failed: stock gone, item still listed.
  const body = functionBody('deleteItem');
  const menuWrite = body.indexOf('method: \'DELETE\'');
  const cleanup = body.indexOf('applyInventoryCleanup(');
  assert.notEqual(menuWrite, -1);
  assert.ok(cleanup > menuWrite, 'stock is cleared after the menu entry is deleted');
});
