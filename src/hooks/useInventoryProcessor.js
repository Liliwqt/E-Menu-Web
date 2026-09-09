import { useEffect } from 'react';
import { database, branchDataPath } from '../lib/firebase';
import { ref, onValue, off } from 'firebase/database';
import {
  extractMenuItems,
  readStock,
  syncInventoryWithMenu,
  syncMenuAvailabilityFromData,
} from '../lib/inventoryApi';

export function useInventoryProcessor(branchId, enabled = true) {
  useEffect(() => {
    if (!branchId || !enabled) return;

    // Android kiosk orders create their log entry and decrement tracked stock in the same
    // Firebase multi-location update. The dashboard is intentionally read/sync-only here:
    // consuming logs in the browser would double-decrement kiosk inventory and make stock
    // depend on an open management session.
    syncInventoryWithMenu(branchId, 'inventory-processor', { syncAvailability: false }).catch(error => {
      console.error('Failed to sync inventory records:', error);
    });

    const categoriesRef = ref(database, `${branchDataPath(branchId)}/categories`);
    const inventoryRef = ref(database, `${branchDataPath(branchId)}/inventory`);

    let latestCategories = null;
    let latestInventory = null;
    let hasCategories = false;
    let hasInventory = false;
    let previousStockByItem = null;
    let previousMenuItemIds = null;
    let isSyncing = false;
    let syncPending = false;
    let isEnsuringInventory = false;

    function buildStockMap(menuItems, inventoryData) {
      const stockByItem = {};
      Object.entries(menuItems).forEach(([compositeKey, menuData]) => {
        const itemId = menuData._originalId || compositeKey;
        const catName = menuData._category || 'Uncategorized';
        const invItem = inventoryData?.[catName]?.[itemId] || {};
        const sizesObj = invItem.sizes || {};

        let totalStock = 0;
        Object.values(sizesObj).forEach(sizeData => {
          totalStock += readStock(sizeData);
        });

        stockByItem[compositeKey] = Object.keys(sizesObj).length > 0 ? totalStock : 1;
      });
      return stockByItem;
    }

    const reconcileAvailability = async () => {
      if (!hasCategories || !hasInventory) return;

      if (isSyncing) {
        syncPending = true;
        return;
      }

      try {
        isSyncing = true;

        do {
          syncPending = false;
          const menuItems = extractMenuItems(latestCategories);
          const stockByItem = buildStockMap(menuItems, latestInventory);
          const menuItemIds = new Set(Object.keys(menuItems));
          const itemIdsToSync = new Set();

          if (!previousStockByItem || !previousMenuItemIds) {
            menuItemIds.forEach((itemId) => itemIdsToSync.add(itemId));
          } else {
            menuItemIds.forEach((itemId) => {
              if (!previousMenuItemIds.has(itemId) || previousStockByItem[itemId] !== stockByItem[itemId]) {
                itemIdsToSync.add(itemId);
              }
            });
          }

          previousStockByItem = stockByItem;
          previousMenuItemIds = menuItemIds;

          if (itemIdsToSync.size > 0) {
            await syncMenuAvailabilityFromData(
              branchId,
              latestCategories,
              latestInventory || {},
              itemIdsToSync
            );
          }
        } while (syncPending);
      } catch (error) {
        console.error('Error syncing menu availability from inventory:', error);
      } finally {
        isSyncing = false;
      }
    };

    const ensureInventoryRecords = () => {
      if (!hasCategories || !hasInventory || isEnsuringInventory) return;

      const menuItems = extractMenuItems(latestCategories);
      const hasMissingInventory = Object.entries(menuItems).some(([compositeKey, menuData]) => {
        const itemId = menuData._originalId || compositeKey;
        const catName = menuData._category || 'Uncategorized';
        const invItem = latestInventory?.[catName]?.[itemId] || {};
        const invSizes = invItem.sizes || {};
        const menuSizes = menuData.sizes ? Object.keys(menuData.sizes) : ['Medium'];
        return menuSizes.some(sizeName => !invSizes[sizeName]);
      });
      if (!hasMissingInventory) return;

      isEnsuringInventory = true;
      syncInventoryWithMenu(branchId, 'availability-sync', { syncAvailability: false })
        .catch((error) => {
          console.error('Failed to sync inventory records for menu items:', error);
        })
        .finally(() => {
          isEnsuringInventory = false;
        });
    };

    const categoryHandler = (snapshot) => {
      latestCategories = snapshot.exists() ? snapshot.val() : {};
      hasCategories = true;

      ensureInventoryRecords();
      reconcileAvailability();
    };

    const inventoryHandler = (snapshot) => {
      latestInventory = snapshot.exists() ? snapshot.val() : {};
      hasInventory = true;
      ensureInventoryRecords();
      reconcileAvailability();
    };

    onValue(categoriesRef, categoryHandler);
    onValue(inventoryRef, inventoryHandler);

    return () => {
      off(categoriesRef, 'value', categoryHandler);
      off(inventoryRef, 'value', inventoryHandler);
    };
  }, [branchId, enabled]);
}

export default useInventoryProcessor;
