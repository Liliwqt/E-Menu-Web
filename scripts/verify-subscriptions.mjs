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
    branchProfile: { branchId: id, branchName: name, companyId: company, ownerUid: 'owner', managerUid: 'manager' },
    users: membership,
    categories: { Drinks: { coffee: { name: 'Coffee', price: 100, available: true }, tea: { name: 'Tea', price: 80, available: false, manualUnavailable: true } } },
    inventory: { Drinks: { coffee: { sizes: { Medium: { stock: 18, currentStock: 18 } } }, tea: { sizes: { Medium: { stock: 3, currentStock: 3 } } } } },
    logs: { '123E4567': { orderNumber: '123E4567', customerName: 'Alex', paymentStatus: 'CUSTOMER_REPORTED_PAID', timestamp: new Date(2026, 8, 20, 12).getTime(), total: 100, orderSource: 'android_kiosk', inventoryDeducted: true, items: [{ name: 'Coffee', price: 100, quantity: 1, subtotal: 100 }] }, '234E5678': { orderNumber: '234E5678', customerName: 'Sam', timestamp: new Date(2026, 8, 19, 12).getTime(), total: 80, orderSource: 'android_kiosk', inventoryDeducted: true, items: [{ name: 'Tea', price: 80, quantity: 1, subtotal: 80 }] } },
    analytics: { summary: { totalOrders: 2, totalRevenue: 180 } },
  };
}
const rules = await readFile('database.rules.json', 'utf8');
const rulesResponse = await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`, {method:'PUT', headers:{Authorization:'Bearer owner'},body:rules});
assert.ok(rulesResponse.ok, 'Install current rules in isolated namespace');
const secondFixture = fixture(second, 'Second');
secondFixture.categories = {Food:{toast:{name:'Toast',price:50,available:true}}};
secondFixture.inventory = {Food:{toast:{sizes:{Medium:{stock:20}}}}};
await api('', 'PUT', {billingEntitlements:{[company]:{[branch]:{companyId:company,branchId:branch,ownerUid:'owner',plan:'basic',subscriptionStatus:'active',periodStartAt:Date.now(),periodEndAt:Date.now()+86400000},[second]:{companyId:company,branchId:second,ownerUid:'owner',plan:'basic',subscriptionStatus:'active',periodStartAt:Date.now(),periodEndAt:Date.now()+86400000}}},[company]:{
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
const subscriptionArtifacts='../verification/subscriptions-2026-09-24';
await mkdir(subscriptionArtifacts,{recursive:true});
let browser;
const pages = [];
const errors = [];
async function session(role) {
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const payload = {iss:'https://securetoken.google.com/demo-menu-kiosk',aud:'demo-menu-kiosk',iat:0,exp:4102444800,auth_time:0,sub:role,user_id:role,firebase:{sign_in_provider:'custom',identities:{}}};
  const token = `${Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
  await context.addInitScript(({role,token})=>{window.__uxRole=role;window.__uxToken=token;},{role,token});
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(`${role}: ${error.message}`));
  page.setDefaultTimeout(15000);
  pages.push(context);
  return page;
}
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||'/snap/brave/current/opt/brave.com/brave/brave',headless:true,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets,LocalNetworkAccessChecksWebTransport']});
  const owner=await session('owner');
  const manager=await session('manager');
  const staff=await session('staff');
  for(const page of [owner,manager,staff]) {
    await page.goto('http://127.0.0.1:5188/subscription/main');
    await page.getByText('Basic plan active').waitFor();
    assert.equal(await page.getByRole('button',{name:/Switch to|Start.*trial/}).count(),0);
    if(page===owner) await page.screenshot({path:`${subscriptionArtifacts}/basic-owner.png`,fullPage:true});
  }
  await owner.goto('http://127.0.0.1:5188/orders/main');
  await owner.getByText('QR payment reported · unverified').first().waitFor();
  await owner.screenshot({path:`${subscriptionArtifacts}/basic-orders-payment-status.png`,fullPage:true});
  await owner.goto('http://127.0.0.1:5188/subscription/main');
  const entitlementPath=`billingEntitlements/${company}/${branch}`;
  const original=await api(entitlementPath);
  await api(entitlementPath,'PATCH',{plan:'starter'});
  for(const page of [owner,manager,staff]) await page.getByText('Starter plan active').waitFor();
  await manager.reload();
  await manager.getByText('Starter plan active').waitFor();
  await manager.goto('http://127.0.0.1:5188/home/main');
  await manager.getByText('AI Live Operations Analyst').waitFor({state:'hidden'});
  await api(entitlementPath,'PATCH',{plan:'premium'});
  for(const page of [owner,staff]) await page.getByText('Premium plan active').waitFor();
  await manager.reload();
  await manager.getByText('AI Live Operations Analyst').waitFor();
  await manager.screenshot({path:`${subscriptionArtifacts}/premium-manager.png`,fullPage:true});
  await manager.goto('http://127.0.0.1:5188/inventory/main');
  await manager.getByRole('button',{name:'Adjust stock for Coffee Medium'}).click();
  await owner.goto('http://127.0.0.1:5188/menu/main');
  await owner.getByRole('button',{name:'Edit Coffee'}).click();
  await api(entitlementPath,'PATCH',{periodEndAt:1});
  await manager.getByRole('button',{name:'Save changes'}).waitFor();
  assert.equal(await manager.getByRole('button',{name:'Save changes'}).isDisabled(),true);
  assert.equal(await owner.getByRole('button',{name:'Save changes'}).isDisabled(),true);
  await owner.goto('http://127.0.0.1:5188/subscription/main');
  await owner.getByText('Plan expired — read-only').waitFor();
  await manager.goto('http://127.0.0.1:5188/analytics/main');
  await manager.getByText(/read-only because its plan expired/i).waitFor();
  await manager.screenshot({path:`${subscriptionArtifacts}/expired-analytics.png`,fullPage:true});
  await staff.goto('http://127.0.0.1:5188/orders/main');
  await staff.getByText('Order #123E4567',{exact:true}).waitFor();
  await staff.getByText(/read-only because its plan expired/i).waitFor();
  await owner.goto('http://127.0.0.1:5188/subscription/second');
  await owner.getByText('Basic plan active').waitFor();
  await owner.goto('http://127.0.0.1:5188/subscription/main');
  await owner.getByText('Plan expired — read-only').waitFor();
  const deniedRules=rules.replace(/("billingEntitlements"\s*:\s*\{\s*"\$companyId"\s*:\s*\{\s*"\$branchId"\s*:\s*\{\s*"\.read"\s*:\s*)"[^"]*"/, '$1false');
  assert.notEqual(deniedRules,rules);
  assert.ok((await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`,{method:'PUT',headers:{Authorization:'Bearer owner'},body:deniedRules})).ok);
  await owner.reload();
  await owner.getByRole('alert').filter({hasText:/Could not load the branch subscription/}).waitFor();
  assert.ok((await fetch(`${root}/.settings/rules.json?ns=demo-menu-kiosk`,{method:'PUT',headers:{Authorization:'Bearer owner'},body:rules})).ok);
  await owner.getByRole('button',{name:'Retry subscription'}).click();
  await owner.getByText('Plan expired — read-only').waitFor();
  assert.deepEqual((await api(`${company}/branches/${branch}`)).logs,baseline.logs);
  const finalBranch=await api(`${company}/branches/${branch}`);
  assert.equal(finalBranch.inventory.Drinks.coffee.sizes.Medium.stock,18);
  assert.equal(finalBranch.inventory.Drinks.tea.sizes.Medium.stock,3);
  assert.deepEqual(finalBranch.users,baseline.users);
  assert.deepEqual(finalBranch.categories,baseline.categories);
  assert.deepEqual(errors,[]);
  console.log('PASS Basic, Starter, Premium, expiry, live owner/manager/staff sync, reload, branch switch and intact records');
} finally {
  for(const context of pages) await context.close();
  await browser?.close();
  await server.close();
}
