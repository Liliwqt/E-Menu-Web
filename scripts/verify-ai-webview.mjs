import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const {build}=await import(root+'/node_modules/vite/dist/node/index.js');
const {default:react}=await import(root+'/node_modules/@vitejs/plugin-react/dist/index.js');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='/tmp/ai-webview-build';
const artifacts=process.env.AI_ARTIFACTS || '/tmp/touch-ai-webview';
await fs.mkdir(artifacts,{recursive:true});
const menu={Drinks:{coffee:{name:'Coffee',price:100,available:true},tea:{name:'Tea',price:80,available:false,manualUnavailable:true}}};
const inventory={Drinks:{coffee:{sizes:{Medium:{stock:18,currentStock:18}}},tea:{sizes:{Medium:{stock:3,currentStock:3}}}}};
const merged=Object.fromEntries(Object.entries(menu.Drinks).map(([id,item])=>[`Drinks___${id}_sizes_Medium`,{productName:item.name,_category:'Drinks',_itemId:id,_sizeName:'Medium',stock:inventory.Drinks[id].sizes.Medium.stock,unit:'units',warningLevel:10,criticalLevel:5}]));
const logs=[{orderNum:'123E4567',customerName:'Alex',timestamp:new Date(2026,8,20,12).getTime(),total:100,orderSource:'android_kiosk',items:[{name:'Coffee',price:100,quantity:1,subtotal:100}]},{orderNum:'234E5678',customerName:'Sam',timestamp:new Date(2026,8,19,12).getTime(),total:80,orderSource:'android_kiosk',items:[{name:'Tea',price:80,quantity:1,subtotal:80}]}];
function replaceFunction(code,name,body){
 const start=code.indexOf(`export function ${name}(`);
 if(start<0)throw Error('Missing '+name);
 const open=code.indexOf('{',start);let depth=1,i=open+1;
 // Existing listener function bodies contain balanced template/object braces.
 for(;depth&&i<code.length;i++){if(code[i]==='{')depth++;if(code[i]==='}')depth--;}
 return code.slice(0,open+1)+body+code.slice(i-1);
}
const listener=data=>`const timer=setTimeout(()=>callback(${JSON.stringify(data)}),20); return ()=>clearTimeout(timer);`;
await build({configFile:false,root,plugins:[{name:'isolated-device-fixture',enforce:'pre',transform(code,id){
 if(id.endsWith('/src/context/AuthContext.jsx'))return `import React,{createContext,useContext} from 'react';import {can} from '../lib/permissions';const C=createContext(null);export function AuthProvider({children}){const role=new URLSearchParams(location.search).get('deviceRole')||'manager';const workspace={companyId:'company-device-test',companyName:'DEVICE TEST',branchId:'branch-device-main',branchName:'Main',onboardingComplete:true,branches:{'branch-device-main':{branchId:'branch-device-main',name:'Main'}}};return <C.Provider value={{user:{uid:role,email:role+'@example.test'},workspace,workspaceLoaded:true,workspaceStatus:'ready',initialLoading:false,isAuthenticated:true,role,nickname:'DEVICE TEST',can:cap=>can(role,cap),isOwner:false,isManager:role==='manager',isStaff:role==='staff',logout:()=>{}}}>{children}</C.Provider>};export const useAuth=()=>useContext(C);`;
 if(id.endsWith('/src/lib/firebase.js'))return code.replace('export const auth = getAuth(firebaseApp);','export const auth = {currentUser:{getIdToken:async()=>\"FIXTURE_TOKEN\"}};');
 if(id.endsWith('/src/context/SubscriptionContext.jsx'))return `export const SubscriptionProvider=({children})=>children;export const useSubscription=()=>({billing:{plan:'premium',subscriptionStatus:'active',periodStartAt:1,periodEndAt:4102444800000},status:'ready',branchId:'branch-device-main',retry:()=>{}});`;
 if(id.endsWith('/src/hooks/useInventoryProcessor.js'))return 'export function useInventoryProcessor() {}';
 if(id.endsWith('/src/hooks/useAnalyticsProcessor.js'))return 'export function useAnalyticsProcessor() {}';
 if(id.endsWith('/src/lib/menuApi.js')){
  code=replaceFunction(code,'onCategoriesChange',`const timer=setTimeout(()=>callback(['Drinks'],${JSON.stringify(menu)}),20);return ()=>clearTimeout(timer);`);
  code=replaceFunction(code,'onLogsChange',listener(logs));
  code=replaceFunction(code,'onDeletedLogsChange',listener([]));
  code=replaceFunction(code,'onMenuLogsChange',listener([]));return code;
 }
 if(id.endsWith('/src/lib/inventoryApi.js'))return replaceFunction(code,'onMenuAndInventoryChange',listener(merged));
 if(id.endsWith('/src/lib/analyticsApi.js')){code=replaceFunction(code,'onAnalyticsChange',listener({summary:{totalOrders:2,totalRevenue:180},daily:{},products:{}}));return replaceFunction(code,'onAnalyticsExclusionsChange',listener({}));}
}},react()],define:Object.fromEntries(Object.entries({VITE_FIREBASE_API_KEY:'fake-api-key',VITE_FIREBASE_PROJECT_ID:'demo-device-test',VITE_FIREBASE_DATABASE_URL:'https://demo-device-test.firebaseio.com',VITE_FIREBASE_AUTH_DOMAIN:'demo-device-test.firebaseapp.com',VITE_FIREBASE_APP_ID:'demo-app'}).map(([k,v])=>[`import.meta.env.${k}`,JSON.stringify(v)])),build:{outDir:out,emptyOutDir:true},logLevel:'warn'});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223', {noDefaults:true});
const context=browser.contexts()[0];const page=context.pages()[0];
const originalURL=page.url();const originalTheme=await page.evaluate(()=>localStorage.getItem('aiops-theme'));
const errors=[];const requests=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
await context.routeWebSocket('**/*',ws=>ws.close());
await context.route('**/*',async route=>{
 const request=route.request();const url=new URL(request.url());
 if(request.method()==='POST' && url.hostname==='e-menu-web-production.up.railway.app' && url.pathname==='/api/ai/analysis') {
  const payload=JSON.parse(request.postData());requests.push(payload);
  assert.equal(request.headers().authorization,'Bearer FIXTURE_TOKEN');
  const answer={mode:'opschat',answer:'WebView isolated response: recorded revenue is ₱180.',recommendation:'Review demand.',keyPoints:['Only selected branch data is used.'],urgency:'LOW',confidence:0.8,simulation:{expectedRevenueChange:null,riskLevel:null,summary:null}};
  const analysis=payload.mode==='opschat'?answer:{mode:payload.mode,insight:{message:'Recorded revenue is ₱180.',action:'Review demand.',priority:'LOW'}};
  return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':'https://touch-menu-web.online','Cache-Control':'no-store'},contentType:'application/json',body:JSON.stringify({mode:payload.mode,requestId:payload.requestId,analysis,fromCache:false,generatedAt:new Date().toISOString()})});
 }
 if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'https://touch-menu-web.online','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'authorization,content-type'}});
 if(url.hostname!=='touch-menu-web.online')return route.abort();
 assert.ok(['GET','HEAD'].includes(request.method()),'No business writes');
 const file=url.pathname.startsWith('/assets/')?path.join(out,url.pathname):path.join(out,'index.html');
 try{return route.fulfill({status:200,body:await fs.readFile(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:''});}
});
try{
 for(const role of ['manager','staff']){
  await page.goto(`https://touch-menu-web.online/menu/main?deviceRole=${role}`);
  await page.getByRole('button',{name:'Mark Coffee sold out',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>typeof window.AndroidKiosk),'object');
  const trigger=page.getByRole('button',{name:'AI',exact:true});
  if(role==='manager'){
   await trigger.first().click();const input=page.getByLabel('Message the AI analyst');await input.fill('How can recorded revenue improve?');
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await page.getByText('WebView isolated response: recorded revenue is ₱180.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('ai_analyst_cache_'))||Object.keys(sessionStorage).some(k=>k.startsWith('emp_ai_chat_')||k==='aiFeedItems')),false);
   const payload=requests.find(r=>r.mode==='opschat');assert.ok(payload);assert.equal(payload.companyId,'company-device-test');assert.equal(payload.branchId,'branch-device-main');
   assert.ok(!JSON.stringify(payload).includes('@example.test'));assert.ok(!('model' in payload)&&!('messages' in payload));
  }else assert.equal(await trigger.count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${artifacts}/webview-${role}.png`});
  console.log('PASS debug WebView',role,'AI authorization, request contract, ephemeral chat, bridge and layout');
 }
 assert.deepEqual(errors,[]);console.log('PASS no page errors, no provider/business/payment requests');
}finally{
 await page.evaluate(value=>{if(value===null)localStorage.removeItem('aiops-theme');else localStorage.setItem('aiops-theme',value);},originalTheme).catch(()=>{});
 await context.unrouteAll({behavior:'wait'});await browser.close();
 const restore=await chromium.connectOverCDP('http://127.0.0.1:9223', {noDefaults:true});
 await restore.contexts()[0].pages()[0].goto(originalURL);
 await restore.close();
}
