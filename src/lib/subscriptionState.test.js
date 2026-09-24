import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { subscriptionBranch, watchSubscription } from './subscriptionState.js';
import { canUseAiMode, hasFeature, isSubscriptionActive, PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, FEATURE } from './planFeatures.js';

const workspace = { companyId: 'company-test', branchId: 'branch-first', onboardingComplete: true, branches: { 'branch-first': { name: 'First' }, 'branch-second': { name: 'Second' } } };
test('billing scope follows authorized route rather than stale home branch', () => {
  assert.equal(subscriptionBranch(workspace, '/subscription/second'), 'branch-second');
  assert.equal(subscriptionBranch(workspace, '/home/branch-first'), 'branch-first');
  assert.equal(subscriptionBranch(workspace, '/'), 'branch-first');
  assert.equal(subscriptionBranch(workspace, '/home/unknown'), null);
});
function harness() {
  const states = []; let next, fail, tick; let stopped = false; let time = 100;
  const stop = watchSubscription({ listen(n, f) { next=n; fail=f; return () => {stopped=true;}; }, emit: s => states.push(s), now: () => time, schedule: fn => {tick=fn;return 1;}, cancel: () => {tick=null;} });
  return { states, next: x => next(x), fail: () => fail(), stop, stopped: () => stopped, expire() {time=201;tick();} };
}
const trial = { plan: PLAN_STARTER, subscriptionStatus: 'trialing', periodStartAt: 100, trialStartedAt: 100, periodEndAt: 200 };
test('shared entitlement replaces stale tier and expires without a database event', () => {
  const h=harness(); h.next(trial);
  assert.equal(h.states.at(-1).billing.plan, PLAN_STARTER);
  h.next({ ...trial, plan: PLAN_PREMIUM, subscriptionStatus: 'active' });
  assert.equal(h.states.at(-1).billing.plan, PLAN_PREMIUM);
  h.expire();
  assert.equal(h.states.at(-1).checkedAt, 201);
  assert.equal(isSubscriptionActive(h.states.at(-1).billing, 201), false);
  h.stop();
});
test('missing records, errors and retired callbacks cannot retain access', () => {
  const h=harness(); h.next(trial); h.fail();
  assert.deepEqual(h.states.at(-1),{status:'error',billing:null});
  h.next(null);assert.equal(h.states.at(-1).status,'error');h.stop();
  const length=h.states.length;h.next(trial);h.fail();assert.equal(h.states.length,length);
  assert.equal(h.stopped(),true);
});
test('tier matrix and expired periods fail closed', () => {
  const basic = { ...trial, plan: PLAN_BASIC, subscriptionStatus: 'active' };
  const starter = { ...trial, subscriptionStatus: 'active' };
  const premium = { ...starter, plan: PLAN_PREMIUM };
  assert.equal(hasFeature(basic, FEATURE.MULTI_DEVICES, 150), true);
  assert.equal(canUseAiMode(basic, 'opschat', 150), false);
  assert.equal(canUseAiMode(starter, 'opschat', 150), true);
  assert.equal(canUseAiMode(starter, 'deep', 150), true);
  assert.equal(canUseAiMode(starter, 'live', 150), false);
  assert.equal(canUseAiMode(premium, 'live', 150), true);
  assert.equal(canUseAiMode(premium, 'simulation', 150), true);
  assert.equal(canUseAiMode(premium, 'simulation', 201), false);
});
test('subscription consumers use protected entitlement and provider wraps AI scheduler', () => {
  for(const file of ['../pages/SubscriptionPage.jsx','../pages/DevicesPage.jsx','../hooks/useAiAccess.js','../components/ui/UpgradePrompt.jsx'])
    assert.match(fs.readFileSync(new URL(file,import.meta.url),'utf8'),/useSubscription\(/,file);
  const main=fs.readFileSync(new URL('../main.jsx',import.meta.url),'utf8');
  assert.ok(main.indexOf('<SubscriptionProvider>')<main.indexOf('<LiveAnalystProvider>'));
  const provider=fs.readFileSync(new URL('../context/SubscriptionContext.jsx',import.meta.url),'utf8');
  assert.match(provider,/billingEntitlements\/\$\{companyId\}\/\$\{branchId\}/);
  assert.match(provider,/state\?\.key === key/);
});
