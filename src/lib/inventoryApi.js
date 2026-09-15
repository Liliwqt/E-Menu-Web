import { ref, get, set, update, push, onValue, off } from 'firebase/database';
import { database, branchDataPath } from './firebase';

/**
 * Convert any stock-like value to a finite non-negative number.
 * Inventory cannot go below zero; invalid or negative values clamp to 0.
 */
export function normalizeStockValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

/**
 * Read stock from an inventory record.
 * Supports both `stock` (new) and `currentStock` (legacy) fields.
 */
export function readStock(invRecord) {
  if (!invRecord) return 0;
  if (typeof invRecord.stock === 'number') return normalizeStockValue(invRecord.stock);
  if (typeof invRecord.currentStock === 'number') return normalizeStockValue(invRecord.currentStock);
  if (typeof invRecord.stock === 'string' && invRecord.stock.trim() !== '') return normalizeStockValue(invRecord.stock);
  if (typeof invRecord.currentStock === 'string' && invRecord.currentStock.trim() !== '') return normalizeStockValue(invRecord.currentStock);
  return 0;
}

function normalizeItemName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeItemKey(value) {
  return normalizeItemName(value).replace(/\s+/g, '-');
}

function getOrderItemIdCandidates(item) {
  return [
    item?.itemId,
    item?.menuItemId,
    item?.productId,
    item?.id,
    item?.key,
  ]
    .filter(Boolean)
    .map(String);
}

function resolveInventoryItemId(item, inventoryData, menuItems) {
  const idCandidates = getOrderItemIdCandidates(item);

  for (const candidate of idCandidates) {
    if (inventoryData?.[candidate] || menuItems?.[candidate]) return candidate;
  }

  for (const candidate of idCandidates) {
    const normalizedCandidate = normalizeItemKey(candidate);
    const inventoryMatch = Object.keys(inventoryData || {}).find((itemId) => (
      normalizeItemKey(itemId) === normalizedCandidate
    ));
    if (inventoryMatch) return inventoryMatch;

    const menuMatch = Object.keys(menuItems || {}).find((itemId) => (
      normalizeItemKey(itemId) === normalizedCandidate
    ));
    if (menuMatch) return menuMatch;
  }

  const normalizedName = normalizeItemName(item?.name || item?.productName || item?.title);
  if (!normalizedName) return null;

  const inventoryNameMatch = Object.entries(inventoryData || {}).find(([itemId, inv]) => (
    normalizeItemName(inv?.productName || inv?.name || itemId) === normalizedName
  ));
  if (inventoryNameMatch) return inventoryNameMatch[0];

  const menuNameMatch = Object.entries(menuItems || {}).find(([itemId, menuItem]) => (
    normalizeItemName(menuItem?.name || itemId) === normalizedName
  ));
  if (menuNameMatch) return menuNameMatch[0];

  return normalizeItemKey(normalizedName);
}

// Core CRUD

async function resolveInventoryPath(branchId, uniqueId) {
  if (uniqueId.includes('_sizes_')) {
    const [prefix, sizeName] = uniqueId.split('_sizes_');
    let catName = null;
    let itemId = prefix;
    if (prefix.includes('___')) {
      const parts = prefix.split('___');
      itemId = parts.pop();
      catName = parts.join('___');
    }

    if (catName) {
      return `${branchDataPath(branchId)}/inventory/${catName}/${itemId}/sizes/${sizeName}`;
    }

    const categoriesSnap = await get(ref(database, `${branchDataPath(branchId)}/categories`));
    const categories = categoriesSnap.val() || {};
    for (const [cName, catData] of Object.entries(categories)) {
      if (catData[itemId]) {
        return `${branchDataPath(branchId)}/inventory/${cName}/${itemId}/sizes/${sizeName}`;
      }
    }
    return `${branchDataPath(branchId)}/inventory/Uncategorized/${itemId}/sizes/${sizeName}`;
  }
  
  if (uniqueId.includes('___')) {
     const parts = uniqueId.split('___');
     const itemId = parts.pop();
     const catName = parts.join('___');
    return `${branchDataPath(branchId)}/inventory/${catName}/${itemId}`;
  }
  return `${branchDataPath(branchId)}/inventory/${uniqueId}`;
}

/**
 * Update fields on an inventory item (thresholds, unit, etc.)
 */
export async function updateInventoryItem(branchId, itemId, data) {
  const path = await resolveInventoryPath(branchId, itemId);
  const itemRef = ref(database, path);
  const safeData = { ...data };

  if ('stock' in safeData) {
    safeData.stock = normalizeStockValue(safeData.stock);
  }
  if ('currentStock' in safeData) {
    safeData.currentStock = normalizeStockValue(safeData.currentStock);
  }

  await update(itemRef, {
    ...safeData,
    lastUpdated: new Date().toISOString()
  });
  return true;
}

/**
 * Log a stock adjustment to history
 */
export async function addInventoryHistoryEntry(branchId, itemId, entry) {
  const historyRef = ref(database, `${branchDataPath(branchId)}/inventoryHistory/${itemId}`);
  const newEntryRef = push(historyRef);

  await set(newEntryRef, {
    ...entry,
    timestamp: new Date().getTime()
  });
  return true;
}

/**
 * Adjust stock level (increment, decrement, or set exact)
 * Also logs the adjustment to history.
 * After adjusting, syncs menu availability.
 */
export async function adjustStock(branchId, itemId, adjustment, previousStock, newStock, userId, note = '') {
  const safePreviousStock = normalizeStockValue(previousStock);
  const safeNewStock = normalizeStockValue(newStock);
  const safeAdjustment = safeNewStock - safePreviousStock;

  // Update current stock (write both fields for compat)
  const path = await resolveInventoryPath(branchId, itemId);
  const itemRef = ref(database, path);
  await update(itemRef, {
    stock: safeNewStock,
    currentStock: safeNewStock,
    lastUpdated: new Date().toISOString(),
    lastModifiedBy: userId || 'unknown'
  });

  // Determine adjustment type
  let type = 'adjustment';
  if (safeAdjustment > 0) type = 'increase';
  if (safeAdjustment < 0) type = 'decrease';

  // Log to history
  await addInventoryHistoryEntry(branchId, itemId, {
    type,
    quantity: Math.abs(safeAdjustment),
    previousStock: safePreviousStock,
    newStock: safeNewStock,
    userId: userId || 'unknown',
    note
  });

  // Sync menu availability based on new stock
  // Need the real itemId if itemId is a uniqueId
  const actualItemId = itemId.includes('_sizes_') ? itemId.split('_sizes_')[0] : itemId;
  await syncMenuAvailability(branchId, actualItemId, safeNewStock);

  return true;
}

/**
 * Fetch history for a specific item
 */
export async function getInventoryHistory(branchId, itemId) {
  const historyRef = ref(database, `${branchDataPath(branchId)}/inventoryHistory/${itemId}`);
  const snapshot = await get(historyRef);
  return snapshot.exists() ? snapshot.val() : {};
}

// Menu + Inventory merged listener

/**
 * Gather all menu items from all categories.
 * Returns { [itemId]: { name, price, available, category, ... } }
 */
export function extractMenuItems(categoriesData) {
  const items = {};
  if (!categoriesData) return items;

  Object.entries(categoriesData).forEach(([catName, catData]) => {
    if (!catData || typeof catData !== 'object') return;
    Object.entries(catData).forEach(([key, value]) => {
      // Skip metadata keys
      if (key.startsWith('_')) return;
      if (value && typeof value === 'object' && value.name) {
        const compositeKey = `${catName}___${key}`;
        items[compositeKey] = { ...value, _category: catName, _originalId: key };
      }
    });
  });

  return items;
}

/**
 * Real-time listener that merges menu items with inventory data.
 * Every menu item automatically appears in the result with stock defaulting to 1.
 *
 * Callback receives: { [itemId]: { productName, stock, category, ...inventoryFields } }
 */
export function onMenuAndInventoryChange(branchId, callback) {
  const catRef = ref(database, `${branchDataPath(branchId)}/categories`);
  const invRef = ref(database, `${branchDataPath(branchId)}/inventory`);

  let latestCategories = null;
  let latestInventory = null;
  let hasReceivedCategories = false;
  let hasReceivedInventory = false;

  function merge() {
    if (!hasReceivedCategories || !hasReceivedInventory) return;

    const menuItems = extractMenuItems(latestCategories);
    const merged = {};

    // For every menu item, create a merged entry for EACH size
    Object.entries(menuItems).forEach(([compositeKey, menuData]) => {
      const itemId = menuData._originalId || compositeKey;
      const catName = menuData._category || 'Uncategorized';
      const invItem = latestInventory?.[catName]?.[itemId] || {};
      const sizesObj = invItem.sizes || { Medium: { currentStock: 1 } };

      Object.entries(sizesObj).forEach(([sizeName, sizeData]) => {
        const uniqueId = `${catName}___${itemId}_sizes_${sizeName}`;
        merged[uniqueId] = {
          productName: menuData.name || itemId,
          _sizeName: sizeName,
          _itemId: itemId, // Help UI grouping
          stock: sizeData ? readStock(sizeData) : 1,
          currentStock: sizeData ? readStock(sizeData) : 1, // backward compat
          warningLevel: sizeData.warningLevel || invItem.warningLevel || 10,
          criticalLevel: sizeData.criticalLevel || invItem.criticalLevel || 5,
          unit: sizeData.unit || invItem.unit || 'units',
          lastUpdated: sizeData.lastUpdated || null,
          lastModifiedBy: sizeData.lastModifiedBy || null,
          _category: catName,
          _menuAvailable: menuData.available,
          _menuPrice: menuData.price,
        };
      });
    });

    callback(merged);
  }

  const catHandler = (snapshot) => {
    latestCategories = snapshot.exists() ? snapshot.val() : null;
    hasReceivedCategories = true;
    merge();
  };

  const invHandler = (snapshot) => {
    latestInventory = snapshot.exists() ? snapshot.val() : null;
    hasReceivedInventory = true;
    merge();
  };

  onValue(catRef, catHandler);
  onValue(invRef, invHandler);

  return () => {
    off(catRef, 'value', catHandler);
    off(invRef, 'value', invHandler);
  };
}

/**
 * Sync inventory with menu categories.
 * Creates default inventory entries (stock: 1) for any menu items
 * that don't have an inventory record yet.
 */
export async function syncInventoryWithMenu(branchId, userId, options = {}) {
  const { syncAvailability = true } = options;
  const categoriesRef = ref(database, `${branchDataPath(branchId)}/categories`);
  const inventoryRef = ref(database, `${branchDataPath(branchId)}/inventory`);

  const [catSnap, invSnap] = await Promise.all([
    get(categoriesRef),
    get(inventoryRef)
  ]);

  if (!catSnap.exists()) return { added: 0 };

  const categories = catSnap.val();
  const currentInv = invSnap.exists() ? invSnap.val() : {};
  const menuItems = extractMenuItems(categories);
  let addedCount = 0;

  const updates = {};
  const nextInventory = { ...currentInv };
  const now = new Date().toISOString();

  Object.entries(menuItems).forEach(([compositeKey, menuData]) => {
    const itemId = menuData._originalId || compositeKey;
    const catName = menuData._category || 'Uncategorized';

    if (!currentInv[catName]) currentInv[catName] = {};
    if (!currentInv[catName][itemId]) currentInv[catName][itemId] = { sizes: {} };
    if (!currentInv[catName][itemId].sizes) currentInv[catName][itemId].sizes = {};

    const menuSizes = menuData.sizes ? Object.keys(menuData.sizes) : ['Medium'];

    menuSizes.forEach(sizeName => {
      const invSizes = currentInv[catName][itemId].sizes;
      if (!invSizes[sizeName]) {
        // Create default inventory entry for this size
        const defaultInventory = {
          productName: menuData.name || itemId,
          stock: 1,
          currentStock: 1,
          lastUpdated: now,
          lastModifiedBy: userId || 'system'
        };
        updates[`${catName}/${itemId}/sizes/${sizeName}`] = defaultInventory;

        if (!nextInventory[catName]) nextInventory[catName] = {};
        if (!nextInventory[catName][itemId]) nextInventory[catName][itemId] = { sizes: {} };
        if (!nextInventory[catName][itemId].sizes) nextInventory[catName][itemId].sizes = {};
        nextInventory[catName][itemId].sizes[sizeName] = defaultInventory;
        addedCount++;
      }
    });

    // We can also update names if they've changed, but we only do it on sizes that already exist
    const currentSizes = currentInv[catName][itemId].sizes;
    Object.entries(currentSizes).forEach(([sizeName, sizeData]) => {
      if (sizeData.productName !== menuData.name) {
        updates[`${catName}/${itemId}/sizes/${sizeName}/productName`] = menuData.name;
        if (nextInventory[catName]?.[itemId]?.sizes?.[sizeName]) {
          nextInventory[catName][itemId].sizes[sizeName].productName = menuData.name;
        }
      }
    });
  });

  if (Object.keys(updates).length > 0) {
    await update(inventoryRef, updates);
  }

  if (syncAvailability) {
    await syncMenuAvailabilityFromData(branchId, categories, nextInventory);
  }

  return { added: addedCount };
}

// Menu availability sync

/**
 * Sync a menu item's availability based on stock level.
 *
 * - stock === 0 → set available = false in the menu
 * - stock > 0   → set available = true in the menu
 *
 * Searches all categories for the given itemId.
 * Uses the Firebase SDK so availability sync shares auth/listener behavior with inventory writes.
 */
export async function syncMenuAvailability(branchId, itemId, newStock) {
  try {
    const catRef = ref(database, `${branchDataPath(branchId)}/categories`);
    const catSnap = await get(catRef);
    if (!catSnap.exists()) return;

    const categories = catSnap.val();
    let catName = null;
    let actualId = itemId;
    if (itemId.includes('___')) {
      const parts = itemId.split('___');
      actualId = parts.pop();
      catName = parts.join('___');
    }

    const mockInventoryData = {};
    if (catName) {
      mockInventoryData[catName] = {
        [actualId]: { sizes: { MockSize: { stock: newStock, currentStock: newStock } } }
      };
    } else {
      Object.keys(categories).forEach(c => {
        mockInventoryData[c] = {
          [actualId]: { sizes: { MockSize: { stock: newStock, currentStock: newStock } } }
        };
      });
    }

    await syncMenuAvailabilityFromData(branchId, categories, mockInventoryData, new Set([itemId, actualId]));
  } catch (error) {
    console.error('Error syncing menu availability:', error);
  }
}

function isMenuAvailable(menuData) {
  return menuData?.available !== false && menuData?.available !== 'false';
}

/**
 * Batch-sync menu availability from already loaded category/inventory snapshots.
 * This avoids one Firebase read per item and only writes items whose availability
 * is out of sync with stock.
 */
export async function syncMenuAvailabilityFromData(branchId, categoriesData, inventoryData, itemIds = null) {
  if (!branchId || !categoriesData) return { updated: 0 };

  const updates = {};
  const allowedIds = itemIds ? new Set(Array.from(itemIds).map(String)) : null;

  Object.entries(categoriesData).forEach(([catName, catData]) => {
    if (!catData || typeof catData !== 'object') return;

    Object.entries(catData).forEach(([itemId, menuData]) => {
      if (itemId.startsWith('_') || !menuData || typeof menuData !== 'object') return;
      
      const compositeKey = `${catName}___${itemId}`;
      if (allowedIds && !allowedIds.has(compositeKey) && !allowedIds.has(itemId)) return;

      const invItem = inventoryData?.[catName]?.[itemId] || {};
      const sizesObj = invItem.sizes || {};

      let totalStock = 0;
      let hasSizes = false;
      Object.values(sizesObj).forEach(sizeData => {
        hasSizes = true;
        totalStock += readStock(sizeData);
      });

      const stock = hasSizes ? totalStock : 1;
      const shouldBeAvailable = stock > 0 && menuData.manualUnavailable !== true;

      if (isMenuAvailable(menuData) !== shouldBeAvailable) {
        updates[`${catName}/${itemId}/available`] = shouldBeAvailable;
      }
    });
  });

  if (Object.keys(updates).length === 0) return { updated: 0 };

  await update(ref(database, `${branchDataPath(branchId)}/categories`), updates);
  return { updated: Object.keys(updates).length };
}
