/** Isolated actual portal/BFF UI; requires the RTDB emulator and ai_browser_server on :8092. */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = process.env.AI_ARTIFACTS || '/tmp/touch-ai-security';
await mkdir(out, { recursive: true });
const company = 'company-ai-ui'; const main = 'branch-ai-ui-main'; const second = 'branch-ai-ui-second';
const api = async (path, method = 'GET', body) => {
  const response = await fetch(`http://127.0.0.1:9000/${path}.json?ns=demo-menu-kiosk`, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `Emulator ${path}: ${response.status}`); return response.json();
};
await api('.settings/rules', 'PUT', JSON.parse((await readFile('database.rules.json', 'utf8')).replace(/^\s*\/\/.*$/gm,'')));
const roles = ['owner','manager','staff'];
const members = Object.fromEntries(roles.map(role => [role,{uid:role,role,companyRole:role,companyId:company,branchIds:{[main]:true,[second]:true}}]));
const makeBranch = (id, name) => ({ branchProfile:{branchId:id,branchName:name,companyId:company,ownerUid:'owner',timezone:'Asia/Manila'}, users:members, categories:{Drinks:{coffee:{name:'Coffee',price:100,available:true}}},inventory:{Drinks:{coffee:{sizes:{Medium:{currentStock:10}}}}},logs:{one:{orderNumber:'123E4567',customerName:'PRIVATE_CUSTOMER',timestamp:Date.now(),total:180,inventoryDeducted:true,items:[{itemId:'coffee',name:'Coffee',quantity:1,subtotal:180}]}},analytics:{summary:{totalOrders:1,totalRevenue:180,averageOrderValue:180},products:{coffee:{name:'Coffee',quantitySold:1,revenue:180,orderCount:1}},daily:{[new Date().toISOString().slice(0,10)]:{orders:1,revenue:180}}} });
await api(company,'PUT',{companyProfile:{companyId:company,companyName:'Isolated test business',ownerUids:{owner:true}},users:members,branches:{[main]:makeBranch(main,'Main'),[second]:makeBranch(second,'Second')}});
const billing = plan => ({companyId:company,branchId:main,ownerUid:'owner',plan,subscriptionStatus:'active',periodStartAt:Date.now(),periodEndAt:Date.now()+86400000});
await api(`billingEntitlements/${company}`,'PUT',{[main]:billing('premium'),[second]:billing('basic')});
await api('aiControls', 'PUT', {});
const baseline = await api(company);
const authSource=`import React,{createContext,useContext,useState} from 'react';
import {can as allowed} from '../lib/permissions';
const Context=createContext(null);
export function AuthProvider({children}) {
 const [role,setRole]=useState(window.__aiRole || 'owner');
 window.__aiSetRole=next=>{window.__aiRole=next;setRole(next);};
 const workspace={companyId:'${company}',companyName:'Test business',branchId:'${main}',branchName:'Main',onboardingComplete:true,branches:{'${main}':{branchId:'${main}',name:'Main'},'${second}':{branchId:'${second}',name:'Second'}}};
 return <Context.Provider value={{user:role?{uid:role,email:role+'@private.example'}:null,workspace,workspaceLoaded:true,workspaceStatus:'ready',initialLoading:false,isAuthenticated:!!role,role,can:cap=>allowed(role,cap),nickname:role,isOwner:role==='owner',isManager:role==='manager',isStaff:role==='staff',logout:()=>window.__aiSetRole(null)}}>{children}</Context.Provider>;
}
export const useAuth=()=>useContext(Context);`;
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:5189,strictPort:true},
 plugins:[{name:'isolated-ai',enforce:'pre',transform(code,id){
  if(id.endsWith('/src/context/AuthContext.jsx')) return authSource;
  if(id.endsWith('/src/hooks/useInventoryProcessor.js')) return 'export function useInventoryProcessor() {}';
  if(id.endsWith('/src/hooks/useAnalyticsProcessor.js')) return 'export function useAnalyticsProcessor() {}';
  if(id.endsWith('/src/lib/firebase.js')) return code.replace('import { getDatabase }', 'import { getDatabase, connectDatabaseEmulator }')
    .replace('export const auth = getAuth(firebaseApp);','export const auth = { currentUser: { getIdToken: async () => window.__aiRole } };')
    .replace('export const database = getDatabase(firebaseApp);',`export const database = getDatabase(firebaseApp); connectDatabaseEmulator(database,'127.0.0.1',9000,{mockUserToken:{sub:window.__aiRole || 'owner',user_id:window.__aiRole || 'owner'}});`);
 }},(await import('@vitejs/plugin-react')).default()],define:Object.fromEntries(Object.entries({VITE_API_BASE_URL:'http://127.0.0.1:8092',VITE_FIREBASE_API_KEY:'fake',VITE_FIREBASE_PROJECT_ID:'demo-menu-kiosk',VITE_FIREBASE_DATABASE_URL:'https://demo-menu-kiosk.firebaseio.com',VITE_FIREBASE_AUTH_DOMAIN:'demo-menu-kiosk.firebaseapp.com',VITE_FIREBASE_APP_ID:'demo-app'}).map(([k,v])=>[`import.meta.env.${k}`,JSON.stringify(v)]))});
await server.listen(); let browser; const errors=[];
try {
 browser=await chromium.launch({executablePath:process.env.BROWSER_PATH || '/snap/brave/current/opt/brave.com/brave/brave',headless:true,args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks']});
 for(const role of roles) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(role=>{window.__aiRole=role;localStorage.setItem('ai_analyst_cache_v2_branch','PRIVATE_LEGACY');sessionStorage.setItem('emp_ai_chat_branch','PRIVATE_LEGACY');},role);
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
  const requests=[]; page.on('request',request=>{if(new URL(request.url()).pathname==='/api/ai/analysis')requests.push(JSON.parse(request.postData()));});
  await page.goto('http://127.0.0.1:5189/menu/main');
  await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
  const trigger=page.getByRole('button',{name:'AI',exact:true});
  if(role==='staff'){ assert.equal(await trigger.count(),0); assert.equal(requests.length,0); await page.screenshot({path:`${out}/staff-denied.png`}); await context.close(); continue; }
  await trigger.first().click(); const input=page.getByLabel('Message the AI analyst'); await input.waitFor();
  await input.fill('How can recorded revenue improve?'); await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Recorded revenue is ₱180. Compare the last completed period before changing prices.',{exact:true}).waitFor();
  const request=requests.find(r=>r.mode==='opschat'); assert.ok(request);
  assert.deepEqual(Object.keys(request).sort(),['branchId','companyId','conversation','forceRefresh','mode','question','requestId'].sort());
  assert.equal(request.companyId,company); assert.equal(request.branchId,main);
  assert.ok(!JSON.stringify(request).includes('@private.example')); assert.ok(!request.conversation.some(turn=>turn.text.includes("I'm your business analyst")));
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('ai_analyst_cache_')) || Object.keys(sessionStorage).some(k=>k.startsWith('emp_ai_chat_')||k==='aiFeedItems')),false);
  await page.screenshot({path:`${out}/${role}-chat.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for (const [label,mode] of [['Live ops pulse','live'],['Shift briefing','briefing'],['Find revenue leaks','leak']]) {
    const result=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/analysis' && JSON.parse(r.request().postData() || '{}').mode===mode);
    await page.getByRole('button',{name:label,exact:true}).click();
    assert.equal((await result).status(),200,`${role}/${mode}`);
    await page.getByLabel('Analyst is thinking').waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'What-if simulator',exact:true}).click();
  await input.fill('What happens if the coffee price rises by ₱5?');
  const simulation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/analysis' && JSON.parse(r.request().postData() || '{}').mode==='simulation');
  await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal((await simulation).status(),200);
  await page.getByLabel('Analyst is thinking').waitFor({state:'hidden'});
  await page.screenshot({path:`${out}/${role}-modes.png`});
  // Reject a pending response after branch access changes, even when network delivery arrives later.
  let resolve; const gate=new Promise(done=>{resolve=done;}); let started; const pending=new Promise(done=>{started=done;});
  await page.route('**/api/ai/analysis',async route=>{if(JSON.parse(route.request().postData()).mode!=='opschat')return route.fallback(); started(); await gate; await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({mode:'opschat',analysis:{mode:'opschat',answer:'PRIVATE_LATE_RESPONSE'},generatedAt:new Date().toISOString(),fromCache:false})}).catch(()=>{});});
  await input.fill('What about tomorrow?'); await page.getByRole('button',{name:'Send',exact:true}).click(); await pending;
  await page.evaluate(() => { history.pushState(null, '', '/menu/second'); window.dispatchEvent(new PopStateEvent('popstate')); }); resolve();
  await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
  assert.equal(await page.getByText('PRIVATE_LATE_RESPONSE').count(),0); assert.equal(await page.getByRole('button',{name:'AI',exact:true}).count(),0);
  await page.screenshot({path:`${out}/${role}-basic-branch.png`});
  await page.evaluate(() => window.__aiSetRole(null));
  await page.getByRole('heading', { name: /Welcome|Sign in|E-Menu|Touch/ }).first().waitFor().catch(() => {});
  assert.equal(await page.getByText('PRIVATE_LATE_RESPONSE').count(),0);
  await context.close(); console.log(`PASS ${role}: actual chat/BFF, minimal request, no storage, branch loss and delayed response`);
 }
 await api('aiControls', 'PUT', {});
 const reportContext=await browser.newContext({viewport:{width:1280,height:900}});
 await reportContext.addInitScript(()=>{window.__aiRole='owner';});
 await reportContext.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 const reports=await reportContext.newPage();reports.on('pageerror',error=>errors.push(error.message));
 await reports.goto('http://127.0.0.1:5189/analytics/main');
 await reports.getByRole('button',{name:'Written Report',exact:true}).click();
 await reports.getByRole('heading',{name:'AI Deep Analysis Report',exact:true}).waitFor();
 await reports.screenshot({path:`${out}/owner-deep-report.png`});
 const executive=reports.waitForResponse(r=>new URL(r.url()).pathname==='/api/ai/analysis' && JSON.parse(r.request().postData() || '{}').mode==='executive');
 await reports.getByRole('button',{name:'Launch Presentation',exact:true}).click();
 assert.equal((await executive).status(),200);
 await reports.getByRole('button',{name:'Close presentation',exact:true}).waitFor();
 await reports.screenshot({path:`${out}/owner-presentation.png`});
 await reports.getByRole('button',{name:'Close presentation',exact:true}).click();
 await reports.goto('http://127.0.0.1:5189/menu/main');
 const aiTrigger=reports.getByRole('button',{name:/AI Analyst|^AI$/}).first();
 await aiTrigger.waitFor();await aiTrigger.click();await reports.getByLabel('Message the AI analyst').waitFor();
 await api(`billingEntitlements/${company}/${main}/periodEndAt`,'PUT',Date.now()+2000);
 // After this update, the clock alone expires access; no second database event is sent.
 await aiTrigger.waitFor({state:'hidden'});
 assert.equal(await reports.getByRole('dialog',{name:'AI Business Analyst',exact:true}).count(),0);
 await reports.screenshot({path:`${out}/owner-expired.png`});
 await api(`billingEntitlements/${company}/${main}`,'PUT',billing('premium'));
 await reportContext.close();console.log('PASS actual live, handoff, leak, simulation, deep report, presentation and expiry without a database event');
 assert.deepEqual(errors,[]); const after=await api(company); assert.deepEqual(after,baseline,'Operational records and membership unchanged');
 console.log('PASS unchanged menu, stock, orders and membership; no page errors');
} finally { await browser?.close(); await server.close(); }
