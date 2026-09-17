import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { subscriptionBranch, watchSubscription } from './subscriptionState.js';
const workspace = { companyId: 'company-test', branchId: 'branch-first', onboardingComplete: true, branches: { 'branch-first': { name: 'First' }, 'branch-second': { name: 'Second' } } };
test('billing scope follows authorized route rather than stale home branch', () => {
  assert.equal(subscriptionBranch(workspace, '/subscription/second'), 'branch-second');
  assert.equal(subscriptionBranch(workspace, '/home/branch-first'), 'branch-first');
  assert.equal(subscriptionBranch(workspace, '/'), 'branch-first');
  assert.equal(subscriptionBranch(workspace, '/home/unknown'), null);
  assert.equal(subscriptionBranch(null, '/home/first'), null);
  assert.equal(subscriptionBranch(workspace, '/home/%bad'), null);
});
function harness() {
  const states = []; let next, fail, tick; let stopped = false; let time = 100;
  const stop = watchSubscription({ listen(n, f) { next=n; fail=f; return () => {stopped=true;}; }, emit: s => states.push(s), now: () => time, schedule: fn => {tick=fn;return 1;}, cancel: () => {tick=null;} });
  return { states, next: x => next(x), fail: () => fail(), stop, stopped: () => stopped, expire() {time=201;tick();} };
}
test('shared billing updates replace stale trial and synchronize subsequent transitions', () => {
  const h=harness(); h.next({plan:'free',subscriptionStatus:'inactive'});
  assert.deepEqual(h.states.at(-1).billing,{plan:'free',subscriptionStatus:'inactive',trialEndsAt:null});
  h.next({plan:'subscription',subscriptionStatus:'trialing',trialEndsAt:200});
  assert.equal(h.states.at(-1).billing.plan,'subscription');
  h.next({plan:'free',subscriptionStatus:'inactive'});
  assert.equal(h.states.at(-1).billing.trialEndsAt,null); h.stop();
});
test('missing records and permission errors clear billing; retry uses a fresh listener', () => {
  const h=harness(); h.next({plan:'subscription',subscriptionStatus:'active'});h.fail();
  assert.deepEqual(h.states.at(-1),{status:'error',billing:null});
  h.next(null);assert.equal(h.states.at(-1).status,'error');h.stop();
  const retry=harness();retry.next({plan:'free',subscriptionStatus:'inactive'});assert.equal(retry.states.at(-1).status,'ready');retry.stop();
});
test('unsubscribed callbacks cannot leak an old account or branch plan', () => {
  const h=harness();h.stop();h.next({plan:'subscription',subscriptionStatus:'active'});h.fail();
  assert.equal(h.stopped(),true);assert.equal(h.states.length,0);
});
test('trial expiry publishes a fresh value without a database event', () => {
  const h=harness();h.next({plan:'subscription',subscriptionStatus:'trialing',trialEndsAt:200});h.expire();
  assert.equal(h.states.length,2);assert.equal(h.states.at(-1).checkedAt,201);h.stop();
});
test('billing changes are a single atomic multi-location write', async () => {
  const source=fs.readFileSync(new URL('./workspaceApi.js',import.meta.url),'utf8');
  for(const name of ['upgradeToSubscription','downgradeToFree']) {
    const start=source.indexOf(`export async function ${name}`);const end=source.indexOf('\n}',start)+2;
    const writes=[];
    const c=vm.createContext({loadWorkspace:async()=>({companyId:'company-test'}),branchPath:(c,b)=>`${c}/branches/${b}`,serverTimestamp:()=>123,TRIAL_DURATION_MS:1000,PLAN_SUBSCRIPTION:'subscription',PLAN_FREE:'free',SUBSCRIPTION_STATUS:{TRIALING:'trialing',INACTIVE:'inactive'},database:{},ref:(_,p)=>p,update:async(p,v)=>writes.push({p,v})});
    vm.runInContext(source.slice(start,end).replace('export ','')+`;globalThis.run=${name}`,c);
    await c.run('owner','branch-first');assert.equal(writes.length,1);assert.equal(writes[0].p,undefined);
    const values=writes[0].v;
    for(const field of ['plan','subscriptionStatus','trialEndsAt','updatedAt'])assert.equal(values[`company-test/users/owner/workspace/${field}`],values[`company-test/branches/branch-first/branchProfile/${field}`]);
    c.update=async()=>{throw Error('denied');};await assert.rejects(c.run('owner','branch-first'),/denied/);
  }
});
test('subscription consumers use shared billing and provider wraps the AI scheduler', () => {
  for(const file of ['../pages/SubscriptionPage.jsx','../pages/KiosksPage.jsx','../hooks/useAiAccess.js','../components/ui/UpgradePrompt.jsx'])assert.match(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/useSubscription\(/,file);
  const main=fs.readFileSync(new URL('../main.jsx',import.meta.url),'utf8');assert.ok(main.includes('<SubscriptionProvider>'));assert.ok(main.indexOf('<SubscriptionProvider>')<main.indexOf('<LiveAnalystProvider>'));
  const provider=fs.readFileSync(new URL('../context/SubscriptionContext.jsx',import.meta.url),'utf8');assert.match(provider,/state\?\.key === key/);assert.match(provider,/state.attempt === attempt/);assert.match(provider,/state.scope === scope/);
});
