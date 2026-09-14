import { getAccessToken, readRepoEnv } from './firebase-cli-auth.mjs';

const db = readRepoEnv('VITE_FIREBASE_DATABASE_URL');
const headers = { Authorization: `Bearer ${await getAccessToken()}` };
const read = (p) => fetch(`${db}/${p}.json`, { headers }).then((r) => r.json());

const BRANCH = 'company-test1-xm5llx/branches/branch-test1-branch1-85sr93';
const categories = (await read(`${BRANCH}/categories`)) || {};
const inventory = (await read(`${BRANCH}/inventory`)) || {};

const menuCats = Object.keys(categories);
const invCats = Object.keys(inventory);

const menuItems = new Set();
for (const [cat, items] of Object.entries(categories)) {
  for (const key of Object.keys(items || {})) {
    if (key === '_createdAt') continue;
    menuItems.add(`${cat}/${key}`);
  }
}

const invItems = new Set();
for (const [cat, items] of Object.entries(inventory)) {
  for (const key of Object.keys(items || {})) invItems.add(`${cat}/${key}`);
}

console.log('menu categories     :', menuCats.join(', ') || '(none)');
console.log('inventory categories:', invCats.join(', ') || '(none)');

const catsOnlyInInventory = invCats.filter((c) => !menuCats.includes(c));
const catsOnlyInMenu = menuCats.filter((c) => !invCats.includes(c));
console.log('\ncategories in inventory but NOT on the menu:',
  catsOnlyInInventory.length ? catsOnlyInInventory.join(', ') : '(none — no orphans)');
console.log('categories on the menu but NOT in inventory:',
  catsOnlyInMenu.length ? catsOnlyInMenu.join(', ') : '(none)');

const orphanItems = [...invItems].filter((k) => !menuItems.has(k));
console.log('\ninventory rows with no matching menu item:',
  orphanItems.length ? orphanItems.join(', ') : '(none)');
