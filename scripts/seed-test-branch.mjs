/**
 * Puts a small amount of realistic data into one test branch, so the screens
 * that need orders to exist can actually be exercised.
 *
 * Admin credentials, so it bypasses the security rules. That is deliberate: the
 * whole point is to produce records the app could not produce without a physical
 * kiosk, and the rules are what stop the portal from writing orders.
 *
 *   node scripts/seed-test-branch.mjs seed     put the data in
 *   node scripts/seed-test-branch.mjs verify   read back what is there
 *   node scripts/seed-test-branch.mjs clean    take it all out again
 *
 * Defaults to the Test1 company. Pass another branch id as a second argument.
 */

const COMPANY = 'company-test1-xm5llx';
const BRANCH = 'branch-test1-branch1-85sr93';
const BASE = 'https://device-streaming-ded679cd-default-rtdb.asia-southeast1.firebasedatabase.app';

const command = process.argv[2] || 'verify';
const companyId = process.argv[3] || COMPANY;
const branchId = process.argv[4] || BRANCH;
const branchPath = `${companyId}/branches/${branchId}`;

// Recipes for the two items, so a total on the dashboard can be checked by hand.
const MENU = [
  { category: 'Drinks', itemId: 'iced_latte', name: 'Iced Latte', price: 120 },
  { category: 'Drinks', itemId: 'cappuccino', name: 'Cappuccino', price: 110 },
];

// Fixed uuids rather than generated ones, so clean() can find them again and
// repeated runs of seed() do not pile up orders.
const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const ORDER_NUMBER = '5EED0001';

function orderBody(now) {
  return {
    orderId: ORDER_ID,
    submittedByUid: 'seed-script',
    orderNumber: ORDER_NUMBER,
    customerName: 'Seed Order',
    items: [
      { name: 'Iced Latte', size: 'Medium', quantity: 1, price: 120, subtotal: 120 },
      { name: 'Cappuccino', size: 'Medium', quantity: 1, price: 110, subtotal: 110 },
    ],
    total: 230,
    paymentMethod: 'COUNTER',
    paymentStatus: 'PAY_AT_COUNTER',
    timestamp: now,
    inventoryProcessed: true,
    inventoryProcessedAt: now,
    orderSource: 'android_kiosk',
  };
}

async function authHeaders() {
  const { getAccessToken } = await import('./firebase-cli-auth.mjs');
  const accessToken = await getAccessToken();
  return { Authorization: `Bearer ${accessToken}` };
}

async function put(headers, path, body) {
  const res = await fetch(`${BASE}/${path}.json`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status} ${await res.text()}`);
}

async function del(headers, path) {
  const res = await fetch(`${BASE}/${path}.json`, { method: 'DELETE', headers });
  if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status} ${await res.text()}`);
}

async function read(headers, path) {
  const res = await fetch(`${BASE}/${path}.json`, { headers });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed() {
  const headers = await authHeaders();
  const now = Date.now();

  // Menu first, stock second, with a pause between.
  //
  // useInventoryProcessor watches the categories node and, for any menu size with
  // no inventory row, writes a default of stock: 1. Writing both at once races it:
  // the default can land after the real value and silently replace it. The pause
  // lets those defaults be created first, so the stock written below is an update
  // to a row that already exists and the processor has nothing left to do. It only
  // ever fills missing rows, so it cannot clobber an existing one.
  for (const entry of MENU) {
    await put(headers, `${branchPath}/categories/${entry.category}/${entry.itemId}`, {
      name: entry.name,
      price: entry.price,
      available: true,
      sizes: { Medium: { price: entry.price, available: true } },
    });
  }

  console.log('menu written, waiting for the inventory processor to create its defaults…');
  await sleep(3000);

  for (const entry of MENU) {
    // Both stock fields are written because the app writes both for backward
    // compatibility and reads whichever is present.
    await put(headers, `${branchPath}/inventory/${entry.category}/${entry.itemId}/sizes/Medium`, {
      stock: 20,
      currentStock: 20,
      productName: entry.name,
      warningLevel: 5,
      criticalLevel: 2,
      unit: 'cups',
      lastUpdated: new Date(now).toISOString(),
      lastModifiedBy: 'seed-script',
    });
  }

  // One completed order, placed today so it lands in today's figures.
  await put(headers, `${branchPath}/logs/${ORDER_ID}`, orderBody(now));

  console.log('seeded:');
  console.log(`  2 menu items under categories/Drinks`);
  console.log(`  2 stock rows (Medium, 20 each) under inventory/Drinks`);
  console.log(`  1 order, total 230, at logs/${ORDER_ID}`);
  await verify();
}

async function verify() {
  const headers = await authHeaders();
  const [categories, inventory, logs] = await Promise.all([
    read(headers, `${branchPath}/categories`),
    read(headers, `${branchPath}/inventory`),
    read(headers, `${branchPath}/logs`),
  ]);

  console.log('');
  console.log(`categories : ${categories ? Object.keys(categories).join(', ') : '(none)'}`);
  if (categories?.Drinks) {
    for (const [id, item] of Object.entries(categories.Drinks)) {
      console.log(`             ${id} -> ${item.name}, ${item.price}`);
    }
  }
  console.log(`inventory  : ${inventory ? Object.keys(inventory).join(', ') : '(none)'}`);
  if (inventory?.Drinks) {
    for (const [id, item] of Object.entries(inventory.Drinks)) {
      const sizes = Object.entries(item.sizes || {}).map(([s, d]) => `${s}=${d.stock}`).join(' ');
      console.log(`             ${id} -> ${sizes}`);
    }
  }
  const orderList = logs ? Object.values(logs) : [];
  console.log(`orders     : ${orderList.length}`);
  for (const o of orderList) {
    console.log(`             #${o.orderNumber} total ${o.total} (${o.items?.length || 0} lines)`);
  }
  console.log(`orders sum : ${orderList.reduce((sum, o) => sum + Number(o.total || 0), 0)}`);
}

async function clean() {
  const headers = await authHeaders();
  for (const entry of MENU) {
    await del(headers, `${branchPath}/categories/${entry.category}/${entry.itemId}`);
    await del(headers, `${branchPath}/inventory/${entry.category}/${entry.itemId}`);
  }
  // Remove the categories/Drinks node if seeding is all that was in it.
  const remaining = await read(headers, `${branchPath}/categories/Drinks`);
  if (!remaining) await del(headers, `${branchPath}/categories/Drinks`);

  await del(headers, `${branchPath}/logs/${ORDER_ID}`);
  // Any exclusion flags the manual pass created, so the run leaves nothing behind.
  await del(headers, `${branchPath}/analyticsExclusions`);
  await del(headers, `${branchPath}/inventoryHistory`);
  await del(headers, `${branchPath}/menuLogs`);

  console.log('cleaned: categories, inventory, the seeded order, and any exclusions');
  await verify();
}

const commands = { seed, verify, clean };
const run = commands[command];
if (!run) {
  console.error(`unknown command "${command}" — use seed, verify or clean`);
  process.exit(1);
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
