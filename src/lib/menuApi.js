import { fetchWithAppCheck, dbUrl as baseDbUrl, branchDataPath, auth } from './firebase';

// Builds a branch-scoped REST path for fetchWithAppCheck.
function dbUrl(path, branchId) {
  const finalPath = branchId ? `${branchDataPath(branchId)}/${path}` : path;
  return baseDbUrl(finalPath);
}

/**
 * Validates a category name.
 * Throws error if invalid.
 */
function validateCategoryName(name) {
  if (!name || !name.trim()) throw new Error('Please enter a category name');
  if (name.includes('/') || name.includes('.') || name.includes('#') || name.includes('$') || name.includes('[')) {
    throw new Error('Category name cannot contain /, ., #, $, [, or ]');
  }
}

/**
 * Validates an item name.
 * Throws error if invalid.
 */
function validateItemName(name) {
  if (!name || !name.trim()) throw new Error('Please enter an item name');
}

/**
 * Returns a list of all category names from the "categories" node.
 * Uses shallow=true to fetch only keys.
 */
export async function getAllCategories(branchId) {
  try {
    const res = await fetchWithAppCheck(dbUrl('categories', branchId) + '?shallow=true');
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    if (!data) return [];
    // keys in data are the category names
    return Object.keys(data);
  } catch (e) {
    console.error('Error fetching categories:', e);
    return [];
  }
}

// Category names are keys in the shallow list, so existence is a simple lookup.
async function categoryExists(category, branchId) {
  const categories = await getAllCategories(branchId);
  return categories.includes(category);
}

export async function addCategory(branchId, categoryName) {
  const name = categoryName.trim();
  validateCategoryName(name);

  const exists = await categoryExists(name, branchId);
  if (exists) throw new Error('This category already exists');

  // We write a placeholder to ensure the key exists even with no items.
  // Firebase deletes keys with no children, so we add a metadata child.
  await fetchWithAppCheck(dbUrl(`categories/${name}`, branchId), {
    method: 'PUT',
    body: JSON.stringify({ _createdAt: Date.now() }),
    headers: { 'Content-Type': 'application/json' },
  });
  await addMenuLog(branchId, `Added category: ${name}`);
}

export async function removeCategory(branchId, categoryName) {
  validateCategoryName(categoryName);
  await fetchWithAppCheck(dbUrl(`categories/${categoryName}`, branchId), { method: 'DELETE' });
  await addMenuLog(branchId, `Removed category: ${categoryName}`);
}

export async function renameCategory(branchId, oldName, newName) {
  const trimmedNew = newName.trim();
  if (!trimmedNew || trimmedNew === oldName) return;
  validateCategoryName(trimmedNew);

  const exists = await categoryExists(trimmedNew, branchId);
  if (exists) throw new Error('This category name already exists');

  // 1. Fetch old data
  const res = await fetchWithAppCheck(dbUrl(`categories/${oldName}`, branchId));
  const data = await res.json();
  const payload = data || { _createdAt: Date.now() };

  // 2. Write to new key
  await fetchWithAppCheck(dbUrl(`categories/${trimmedNew}`, branchId), {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });

  // 3. Delete old key
  await fetchWithAppCheck(dbUrl(`categories/${oldName}`, branchId), { method: 'DELETE' });
  await addMenuLog(branchId, `Renamed category: ${oldName} → ${trimmedNew}`);
}

export async function addItemToFirebase(branchId, category, itemId, item) {
  const menuItem = {
    ...item,
    available: item.available !== false,
  };

  await fetchWithAppCheck(dbUrl(`categories/${category}/${itemId}`, branchId), {
    method: 'PUT',
    body: JSON.stringify(menuItem),
    headers: { 'Content-Type': 'application/json' },
  });

  const inventoryRes = await fetchWithAppCheck(dbUrl(`inventory/${category}/${itemId}`, branchId));
  const existingInventory = await inventoryRes.json();
  
  if (!existingInventory || existingInventory.error || !existingInventory.sizes) {
    const defaultSizes = {};
    const menuSizes = menuItem.sizes ? Object.keys(menuItem.sizes) : ['Medium'];
    
    menuSizes.forEach(sizeName => {
      defaultSizes[sizeName] = {
        productName: menuItem.name || itemId,
        stock: 1,
        currentStock: 1,
        lastUpdated: new Date().toISOString(),
        lastModifiedBy: 'menu-add',
      };
    });
    
    await fetchWithAppCheck(dbUrl(`inventory/${category}/${itemId}/sizes`, branchId), {
      method: 'PUT',
      body: JSON.stringify(defaultSizes),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await addMenuLog(branchId, `Added item: ${menuItem.name || itemId} to ${category}`);
}

export async function deleteItem(branchId, category, itemKey) {
  await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId), { method: 'DELETE' });

  // If we deleted the last item, the category might disappear if we don't ensure it exists.
  // The simplest way to keep category alive is to ensure `_createdAt` is there.
  // Let's just touch `_createdAt` to be safe.
  await fetchWithAppCheck(dbUrl(`categories/${category}/_createdAt`, branchId), {
    method: 'PUT',
    body: JSON.stringify(Date.now()),
    headers: { 'Content-Type': 'application/json' },
  });
  await addMenuLog(branchId, `Deleted item: ${itemKey} from ${category}`);
}

export async function updateItem(branchId, category, itemKey, item) {
  if (item.name) validateItemName(item.name);
  await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId), {
    method: 'PUT',
    body: JSON.stringify(item),
    headers: { 'Content-Type': 'application/json' },
  });
  await addMenuLog(branchId, `Updated item: ${item.name || itemKey} in ${category}`);
}

/** Set item's isBestSeller boolean (true/false) in the database; no separate Best Sellers category. */
export async function setBestSeller(branchId, category, itemKey, value) {
  const res = await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId));
  const item = await res.json();
  if (!item) throw new Error('Item not found');
  item.isBestSeller = value === true;
  await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId), {
    method: 'PUT',
    body: JSON.stringify(item),
    headers: { 'Content-Type': 'application/json' },
  });
  const action = value ? `Set ${item.name || itemKey} as best seller in ${category}` : `Removed best seller: ${item.name || itemKey} in ${category}`;
  await addMenuLog(branchId, action);
}

export function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        // Improved resolution: 1000px instead of 400px
        const max = 1000;
        if (w > h && w > max) {
          h = (h * max) / w;
          w = max;
        } else if (h > max) {
          w = (w * max) / h;
          h = max;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // Improved quality: 0.8 instead of 0.5
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (e) {
        resolve(dataUrl);
      }
    };
    img.src = dataUrl;
  });
}

export async function updateImageInFirebase(branchId, category, itemKey, imageData) {
  if (!imageData?.startsWith('data:')) throw new Error('Invalid image format');
  if (imageData.length > 5000000) throw new Error('Image too large after compression');
  const res = await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId));
  const item = await res.json();
  if (!item) throw new Error('Item not found');
  item.imageUrl = imageData;
  await fetchWithAppCheck(dbUrl(`categories/${category}/${itemKey}`, branchId), {
    method: 'PUT',
    body: JSON.stringify(item),
    headers: { 'Content-Type': 'application/json' },
  });
  await addMenuLog(branchId, `Updated image for ${item.name || itemKey} in ${category}`);
}
// User Nickname Management
export async function loadUserNickname(uid) {
  if (!uid) return '';
  try {
    const accountRes = await fetchWithAppCheck(baseDbUrl(`accounts/${uid}`));
    const account = await accountRes.json();
    if (!account?.companyId) return '';
    const res = await fetchWithAppCheck(baseDbUrl(`${account.companyId}/users/${uid}/nickname`));
    const data = await res.json();
    if (data && !data.error && typeof data === 'string') {
      return data;
    }
    return '';
  } catch (e) {
    console.error('Error loading user nickname:', e);
    return '';
  }
}

export async function saveUserNickname(uid, email, nickname) {
  if (!uid) return;
  try {
    const accountRes = await fetchWithAppCheck(baseDbUrl(`accounts/${uid}`));
    const account = await accountRes.json();
    if (!account?.companyId) throw new Error('Company account is not configured.');
    await fetchWithAppCheck(baseDbUrl(`${account.companyId}/users/${uid}/nickname`), {
      method: 'PUT',
      body: JSON.stringify(nickname),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Error saving user nickname:', e);
    throw e;
  }
}

// Real-time listeners using Firebase SDK
import { ref, onValue, off } from 'firebase/database';
import { database } from './firebase';

function parseLogsSnapshot(snapshot) {
  const data = snapshot.val();
  if (!data) return [];
  return Object.entries(data)
    .map(([key, value]) => ({ orderNum: key, ...value }))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// Subscribe to real-time logs updates. Returns an unsubscribe function.
export function onLogsChange(branchId, callback) {
  const logsRef = ref(database, `${branchDataPath(branchId)}/logs`);
  const handler = (snapshot) => {
    callback(parseLogsSnapshot(snapshot));
  };
  onValue(logsRef, handler);
  return () => off(logsRef, 'value', handler);
}

// Subscribe to real-time categories + items updates. Returns an unsubscribe function.
export function onCategoriesChange(branchId, callback) {
  const catRef = ref(database, `${branchDataPath(branchId)}/categories`);
  const handler = (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      callback([], {});
      return;
    }
    const categoryNames = Object.keys(data);
    const categoryItems = {};
    for (const cat of categoryNames) {
      const catData = data[cat];
      if (catData && typeof catData === 'object') {
        const filtered = {};
        for (const [key, value] of Object.entries(catData)) {
          if (!key.startsWith('_')) {
            filtered[key] = value;
          }
        }
        categoryItems[cat] = filtered;
      } else {
        categoryItems[cat] = {};
      }
    }
    callback(categoryNames, categoryItems);
  };
  onValue(catRef, handler);
  return () => off(catRef, 'value', handler);
}

// Subscribe to real-time deletedLogs updates. Returns an unsubscribe function.
export function onDeletedLogsChange(branchId, callback) {
  const deletedRef = ref(database, `${branchDataPath(branchId)}/deletedLogs`);
  const handler = (snapshot) => {
    callback(parseLogsSnapshot(snapshot));
  };
  onValue(deletedRef, handler);
  return () => off(deletedRef, 'value', handler);
}

// Moves a log from '{branchId}/logs' to '{branchId}/deletedLogs'
export async function deleteLogToBin(branchId, orderNum, logData) {
  if (logData?.orderSource === 'android_kiosk') {
    throw new Error('Kiosk orders are immutable and cannot be moved to trash from the portal.');
  }

  try {
    // 1. Write to deletedLogs
    await fetchWithAppCheck(dbUrl(`deletedLogs/${orderNum}`, branchId), {
      method: 'PUT',
      body: JSON.stringify(logData),
      headers: { 'Content-Type': 'application/json' },
    });
    // 2. Delete from logs
    await fetchWithAppCheck(dbUrl(`logs/${orderNum}`, branchId), {
      method: 'DELETE',
    });
  } catch (e) {
    console.error('Error moving log to trash bin:', e);
    throw e;
  }
}

// Clear all deleted logs
export async function clearDeletedLogs(branchId) {
  try {
    await fetchWithAppCheck(dbUrl('deletedLogs', branchId), {
      method: 'DELETE',
    });
  } catch (e) {
    console.error('Error clearing trash bin:', e);
    throw e;
  }
}

// ===== Menu Audit Logs =====

// Write a menu change audit log entry
export async function addMenuLog(branchId, action) {
  const email = auth.currentUser?.email || 'unknown';
  const entry = { email, action, timestamp: Date.now() };
  try {
    await fetchWithAppCheck(dbUrl('menuLogs', branchId), {
      method: 'POST',
      body: JSON.stringify(entry),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Error writing menu log:', e);
  }
}

// Real-time listener for menu audit logs. Returns unsubscribe function.
export function onMenuLogsChange(branchId, callback) {
  const logsRef = ref(database, `${branchDataPath(branchId)}/menuLogs`);
  const handler = (snapshot) => {
    const data = snapshot.val();
    if (!data) { callback([]); return; }
    const entries = Object.entries(data)
      .map(([key, value]) => ({ id: key, ...value }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    callback(entries);
  };
  onValue(logsRef, handler);
  return () => off(logsRef, 'value', handler);
}
