/** Isolated UI verification. Requires the demo-menu-kiosk database emulator on
 * 127.0.0.1:9000 and PLAYWRIGHT_MODULE pointing to an installed playwright module.
 * Runs actual routes/pages/providers/APIs with a test AuthContext and emulator
 * identities; never signs in to or writes production. No native WebView claim.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.UX_ARTIFACTS || '/tmp/e-menu-ux';
await mkdir(out, { recursive: true });
const company = 'company-ux';
const branch = 'branch-ux-main';
const second = 'branch-ux-second';
const root = `http://127.0.0.1:9000`;
const api = async (path = '', method = 'GET', body) => {
  const response = await fetch(`${root}/${path}.json?ns=demo-menu-kiosk`, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${method} emulator ${path}: ${response.status}`);
  return response.json();
};
const roles = ['owner', 'manager', 'staff'];
const users = Object.fromEntries(roles.map(role => [role, { uid: role, role, companyRole: role, companyId: company, email: `${role}@example.test`, branchIds: { [branch]: true } }]));
const membership = Object.fromEntries(roles.map(role => [role, { uid: role, role }]));
function fixture(id, name) {
  return {
    branchProfile: { branchId: id, branchName: name, companyId: company, ownerUid: 'owner', managerUid: 'manager', plan: 'free', subscriptionStatus: 'inactive' },
    users: membership,
    categories: { Drinks: { coffee: { name: 'Coffee', price: 100, available: true }, tea: { name: 'Tea', price: 80, available: false, manualUnavailable: true } } },
    inventory: { Drinks: { coffee: { sizes: { Medium: { stock: 18, currentStock: 18 } } }, tea: { sizes: { Medium: { stock: 3, currentStock: 3 } } } } },
    logs: { '123E4567': { orderNumber: '123E4567', customerName: 'Alex', timestamp: new Date(2026, 8, 20, 12).getTime(), total: 100, orderSource: 'android_kiosk', inventoryDeducted: true, items: [{ name: 'Coffee', price: 100, quantity: 1, subtotal: 100 }] }, '234E5678': { orderNumber: '234E5678', customerName: 'Sam', timestamp: new Date(2026, 8, 19, 12).getTime(), total: 80, orderSource: 'android_kiosk', inventoryDeducted: true, items: [{ name: 'Tea', price: 80, quantity: 1, subtotal: 80 }] } },
    analytics: { summary: { totalOrders: 2, totalRevenue: 180 } },
  };
}
const rules = await readFile('database.rules.json', 'utf8');
const rulesResponse = await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT', headers:{Authorization:'Bearer owner'},body:rules});
assert.ok(rulesResponse.ok, 'Install current rules in isolated namespace');
const secondFixture = fixture(second, 'Second');
secondFixture.categories = {Food:{toast:{name:'Toast',price:50,available:true}}};
secondFixture.inventory = {Food:{toast:{sizes:{Medium:{stock:20}}}}};
await api('', 'PUT', {[company]:{
 companyProfile:{companyId:company,companyName:'UX Cafe',ownerUids:{owner:true}},
 users, branches:{[branch]:fixture(branch,'Main'),[second]:secondFixture},
}});

const baseline = await api(`${company}/branches/${branch}`);
const authSource = `import React, { createContext, useContext, useState } from 'react';
import { can as allowed } from '../lib/permissions';
const Context = createContext(null);
export function AuthProvider({children}) {
 const [role, setRole] = useState(window.__uxRole || 'staff');
 window.__uxSetRole = setRole;
 const workspace = {companyId:'${company}',companyName:'UX Cafe',branchId:'${branch}',branchName:'Main',onboardingComplete:true,branches:{'${branch}':{branchId:'${branch}',name:'Main'},'${second}':{branchId:'${second}',name:'Second'}}};
 return <Context.Provider value={{user:role ? {uid:role,email:role+'@example.test'} : null,workspace,workspaceLoaded:true,workspaceStatus:'ready',initialLoading:false,isAuthenticated:!!role,role,can:(cap)=>allowed(role,cap),nickname:role,isOwner:role==='owner',isManager:role==='manager',isStaff:role==='staff',setWorkspaceFromProps:()=>{},logout:()=>setRole(null)}}>{children}</Context.Provider>;
}
export const useAuth=()=>useContext(Context);`;
const server = await createServer({
  configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 5188, strictPort: true },
  plugins: [
    { name: 'isolated-workflow-fixture', enforce: 'pre', transform(code, id) {
      if (id.endsWith('/src/context/AuthContext.jsx')) return authSource;
      if (id.endsWith('/src/lib/menuApi.js')) return code.replace(
        'export function onCategoriesChange(branchId, callback, onError) {',
        'export function onCategoriesChange(branchId, callback, onError) { const originalCallback = callback; const delay = window.__uxDelay || 0; callback = (...args) => setTimeout(() => originalCallback(...args), delay);'
      );
      if (id.endsWith('/src/lib/firebase.js')) return code
        .replace("import { getDatabase }", "import { getDatabase, connectDatabaseEmulator }")
        .replace('export const database = getDatabase(firebaseApp);', `export const database = getDatabase(firebaseApp); connectDatabaseEmulator(database, '127.0.0.1', 9000, { mockUserToken: {sub:window.__uxRole || 'staff', user_id:window.__uxRole || 'staff'} });`)
        .replace('let authToken = null;', 'let authToken = window.__uxToken;')
        .replace('url.startsWith(databaseURL)', 'url.startsWith("http://127.0.0.1:9000/")')
        .replace('`${databaseURL}/${encoded}.json`', '`http://127.0.0.1:9000/${encoded}.json?ns=demo-menu-kiosk`');
    } },
    (await import('@vitejs/plugin-react')).default(),
  ],
  define: Object.fromEntries(Object.entries({ VITE_FIREBASE_API_KEY: 'fake-api-key', VITE_FIREBASE_PROJECT_ID: 'demo-menu-kiosk', VITE_FIREBASE_DATABASE_URL: 'https://demo-menu-kiosk.firebaseio.com', VITE_FIREBASE_AUTH_DOMAIN: 'demo-menu-kiosk.firebaseapp.com', VITE_FIREBASE_APP_ID: 'demo-app' }).map(([k,v])=>[`import.meta.env.${k}`,JSON.stringify(v)])),
});
await server.listen();
let browser;
const pageErrors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || '/snap/brave/current/opt/brave.com/brave/brave', headless: true, args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets,LocalNetworkAccessChecksWebTransport'] });
  for (const role of roles) {
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
    const payload = { iss: 'https://securetoken.google.com/demo-menu-kiosk', aud: 'demo-menu-kiosk', iat: 0, exp: 4102444800, auth_time: 0, sub: role, user_id: role, firebase: { sign_in_provider: 'custom', identities: {} } };
    const token = `${Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    await context.addInitScript(({role,token}) => { window.__uxRole=role; window.__uxToken=token; }, {role,token});
    // This test may only contact local services; Firebase production traffic is refused.
    await context.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return ['127.0.0.1','localhost'].includes(host) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER',msg.text()); });
    page.on('pageerror', e => (console.log('PAGE ERROR', e.message),pageErrors.push(`${role}: ${e.message}`)));
    await page.goto('http://127.0.0.1:5188/menu/main');
    await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Edit Coffee',exact:true}).count(), role === 'staff' ? 0 : 1);
    assert.equal(await page.getByRole('button',{name:'Delete Coffee',exact:true}).count(), role === 'staff' ? 0 : 1);
    await page.getByLabel('Search menu').fill('tea');
    assert.equal(await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).count(),0);
    await page.getByLabel('Availability',{exact:true}).selectOption('available');
    await page.getByText('No menu items match',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Clear filters',exact:true}).first().click();
    if (role === 'staff') {
      // Hold a rejected REST write long enough to exercise pending/double clicks.
      let writes=0;
      await page.route('**/categories/Drinks/coffee.json*', async route => {
        if(route.request().method() !== 'PATCH') return route.fallback();
        writes++;
        await new Promise(resolve=>setTimeout(resolve,350));
        await route.fulfill({status:403,contentType:'application/json',body:'{"error":"Permission denied"}'});
      });
      const toggle=page.getByRole('button',{name:'Mark Coffee sold out',exact:true});
      await toggle.evaluate(button=>{button.click();button.click();});
      await page.getByRole('alert').filter({hasText:/permission|denied|failed|403/i}).waitFor();
      assert.equal(writes,1);
      assert.equal((await api(`${company}/branches/${branch}/categories/Drinks/coffee`)).available,true);
      await page.unroute('**/categories/Drinks/coffee.json*');
      await toggle.click();
      await page.getByRole('button',{name:'Mark Coffee available',exact:true}).waitFor();
      assert.equal((await api(`${company}/branches/${branch}/categories/Drinks/coffee`)).manualUnavailable,true);
      await page.reload();
      await page.getByRole('button',{name:'Mark Coffee available',exact:true}).click();
      await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
    }
    for (const width of [390,768,1280]) {
      await page.setViewportSize({width,height:900});
      for(const theme of ['light','dark']) {
        await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        await page.screenshot({path:`${out}/${role}-menu-${width}-${theme}.png`,fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${role} menu overflow ${width}`);
      }
    }
    await page.setViewportSize({width:1280,height:900});
    await page.goto('http://127.0.0.1:5188/inventory/main?status=critical');
    await page.getByRole('button',{name:'Adjust stock for Tea Medium',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Adjust stock for Coffee Medium',exact:true}).count(),0);
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    const stockButton=page.getByRole('button',{name:'Adjust stock for Coffee Medium',exact:true});
    await stockButton.click();
    await page.getByLabel('Stock quantity').fill('20');
    await page.getByLabel('Note (optional)').fill('UX verification');
    const dialog=page.getByRole('dialog');
    assert.match(await dialog.innerText(),/Current.*18 units/s);
    assert.match(await dialog.innerText(),/After saving.*20 units/s);
    if (role === 'staff') {
      const denied = rules.replace(/"\.write"\s*:\s*"[^"]*"/g, '".write": false');
      const response = await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT',headers:{Authorization:'Bearer owner'},body:denied});
      assert.ok(response.ok);
      await page.getByRole('button',{name:'Save changes',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Stock quantity').inputValue(),'20');
      assert.equal(await page.getByLabel('Note (optional)').inputValue(),'UX verification');
      assert.equal((await api(`${company}/branches/${branch}/inventory/Drinks/coffee/sizes/Medium`)).stock,18);
      await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT',headers:{Authorization:'Bearer owner'},body:rules});
    }
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal((await api(`${company}/branches/${branch}/inventory/Drinks/coffee/sizes/Medium`)).stock,20);
    await stockButton.click();
    await page.keyboard.press('Shift+Tab');
    assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await stockButton.evaluate(el=>el===document.activeElement),true);
    await api(`${company}/branches/${branch}/inventory/Drinks/coffee/sizes/Medium`,'PATCH',{stock:18,currentStock:18});
    for (const width of [390,768,1280]) {
      await page.setViewportSize({width,height:900});
      for (const theme of ['light','dark']) {
        await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        await page.screenshot({path:`${out}/${role}-inventory-${width}-${theme}.png`,fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`inventory overflow ${width}`);
      }
    }
    await page.goto('http://127.0.0.1:5188/orders/main');
    await page.getByText('Order #123E4567',{exact:true}).waitFor();
    await page.getByLabel('From',{exact:true}).fill('2026-09-20');
    await page.getByLabel('Through',{exact:true}).fill('2026-09-20');
    assert.equal(await page.getByText('Order #234E5678',{exact:true}).count(),0);
    await page.getByLabel('Search orders').fill('Alex');
    await page.getByText('Order #123E4567',{exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Clear filters',exact:true}).click();
    await page.getByText('Order #234E5678',{exact:true}).waitFor();
    for (const width of [390,768,1280]) {
      await page.setViewportSize({width,height:900});
      for (const theme of ['light','dark']) {
        await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        await page.screenshot({path:`${out}/${role}-orders-${width}-${theme}.png`,fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`orders overflow ${width}`);
      }
    }
    await page.goto('http://127.0.0.1:5188/home/main');
    await page.getByRole('button',{name:'Menu & availability',exact:true}).waitFor();
    await page.getByRole('button',{name:'1 critical stock entries',exact:true}).click();
    await page.getByRole('button',{name:'Adjust stock for Tea Medium',exact:true}).waitFor();
    await page.goto('http://127.0.0.1:5188/menu/main');
    await page.getByLabel('Search menu').fill('Coffee');
    // Client navigation, not a reload, verifies the BranchScope key resets filters.
    await page.evaluate(()=>{window.__uxDelay=700;history.pushState({},'', '/menu/second');dispatchEvent(new PopStateEvent('popstate'));});
    await page.getByRole('status',{name:'Loading menu',exact:true}).waitFor();
    assert.equal(await page.getByText('Coffee',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Mark Toast sold out',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Search menu').inputValue(),'');
    assert.equal(await page.getByText('Coffee',{exact:true}).count(),0);
    await page.evaluate(()=>{window.__uxDelay=0;});
    if (role === 'staff') {
      const deniedRead = rules.replace(/"\.read"\s*:\s*"[^"]*"/g, '".read": false');
      await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT',headers:{Authorization:'Bearer owner'},body:deniedRead});
      await page.goto('http://127.0.0.1:5188/menu/main');
      await page.getByRole('button',{name:'Retry menu',exact:true}).waitFor();
      assert.equal(await page.getByText('Your menu starts here',{exact:true}).count(),0);
      await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT',headers:{Authorization:'Bearer owner'},body:rules});
      await page.getByRole('button',{name:'Retry menu',exact:true}).click();
      await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
    }
    if (role === 'owner') {
      await page.setViewportSize({width:390,height:900});
      await page.getByRole('button',{name:'More',exact:true}).click();
      await page.getByRole('dialog',{name:'More navigation'}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'More navigation'}).waitFor({state:'hidden'});
      await page.setViewportSize({width:1280,height:900});
      await page.getByLabel('Search menu').fill('draft-filter');
      await page.evaluate(()=>window.__uxSetRole('manager'));
      await page.getByRole('button',{name:'Mark Toast sold out',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Search menu').inputValue(),'');
      await page.evaluate(()=>window.__uxSetRole(null));
      await page.waitForURL('http://127.0.0.1:5188/');
      assert.equal(await page.getByText('Toast',{exact:true}).count(),0);
    }
    if (role === 'staff') {
      const original = await api(`${company}/branches/${second}/categories`);
      await api(`${company}/branches/${second}/categories`, 'DELETE');
      await page.goto('http://127.0.0.1:5188/menu/second');
      await page.getByText('Your manager can add items to this branch.',{exact:true}).waitFor();
      await api(`${company}/branches/${second}/categories`, 'PUT', original);
    }
    await context.close();
    console.log(`PASS ${role}: real routes, filters, stock preview/save, focus, branch reset, responsive themes`);
  }
  const after=await api(`${company}/branches/${branch}`);
  assert.deepEqual(after.logs,baseline.logs);
  assert.deepEqual(after.users,baseline.users);
  assert.deepEqual(after.branchProfile,baseline.branchProfile);
  assert.equal(after.inventory.Drinks.coffee.sizes.Medium.stock,18);
  assert.equal(after.inventory.Drinks.tea.sizes.Medium.stock,3);
  for (const [category, items] of Object.entries(after.inventory)) {
    for (const key of Object.keys(items)) assert.ok(after.categories[category]?.[key], `orphan stock ${category}/${key}`);
  }
  console.log('Inventory rows with no matching menu item: (none)');
  assert.deepEqual(pageErrors,[]);
  console.log(`PASS: ledger, membership, Free plan and stock preserved; screenshots ${out}`);
} finally { await browser?.close(); await server.close(); }
