/**
 * What a menu change has to do to the stock tree.
 *
 * The menu and the stock are two trees in the same database, joined only by
 * agreeing on the same names: `categories/<category>/<item>` and
 * `inventory/<category>/<item>`. Neither is inside the other, so deleting one
 * removes nothing from the other. Every menu edit therefore has to carry the
 * stock with it, and forgetting to is invisible until someone notices a product
 * on the Inventory screen that is no longer on the menu.
 *
 * That is what happened: removing a menu item left its stock row, removing a
 * category left a whole ghost heading, and renaming a category left its stock
 * under the old name — so the renamed category was handed fresh default counts
 * while the real ones sat under a heading nothing pointed at.
 *
 * The work is described here as a plain value rather than performed here, because
 * the interesting part is which paths an operation touches, and that is worth
 * being able to assert without a database. menuApi.js executes the plan.
 */

export const MENU_INVENTORY_OP = {
  ITEM_DELETE: 'item-delete',
  CATEGORY_DELETE: 'category-delete',
  CATEGORY_RENAME: 'category-rename',
};

/** The stock node holding every item in one category. */
export function inventoryPathForCategory(category) {
  return `inventory/${category}`;
}

/** The stock node for one item. */
export function inventoryPathForItem(category, itemKey) {
  return `inventory/${category}/${itemKey}`;
}

/**
 * The paths an operation must remove, and the one move it must perform.
 *
 * `remove` is [path]; `move` is { from, to } or null. A category delete and an
 * item delete both remove, and neither moves. A rename does both — it moves the
 * category node and therefore removes the old one.
 *
 * A rename that does not actually change the name yields a plan that touches
 * nothing, rather than one that would move a node onto itself and delete the
 * source out from under it.
 */
export function inventoryCleanupPlan({ op, category, itemKey, newCategory } = {}) {
  const empty = { remove: [], move: null };

  switch (op) {
    case MENU_INVENTORY_OP.ITEM_DELETE:
      if (!category || !itemKey) return empty;
      return { remove: [inventoryPathForItem(category, itemKey)], move: null };

    case MENU_INVENTORY_OP.CATEGORY_DELETE:
      if (!category) return empty;
      return { remove: [inventoryPathForCategory(category)], move: null };

    case MENU_INVENTORY_OP.CATEGORY_RENAME:
      if (!category || !newCategory || category === newCategory) return empty;
      return {
        remove: [inventoryPathForCategory(category)],
        move: {
          from: inventoryPathForCategory(category),
          to: inventoryPathForCategory(newCategory),
        },
      };

    default:
      return empty;
  }
}

/**
 * The stock tree under the new name after a rename.
 *
 * The category being renamed is the live one, so its counts win where both names
 * hold the same item. Anything that exists only under the new name is kept:
 * dropping it would delete data that was not part of the rename.
 *
 * Returns null when there is nothing to move, which the caller reads as "leave
 * the new name's node alone".
 */
export function mergeRenamedInventory({ existing, moved } = {}) {
  const hasMoved = moved && typeof moved === 'object' && Object.keys(moved).length > 0;
  if (!hasMoved) return null;

  const hasExisting = existing && typeof existing === 'object' && Object.keys(existing).length > 0;
  if (!hasExisting) return moved;

  return { ...existing, ...moved };
}
