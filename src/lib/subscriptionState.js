import { resolveBranchRef } from './branchRef.js';
import { canAccessBranch, getUserBranch } from '../config/authConfig.js';
import { isSubscriptionActive, PLAN_PRICE_PHP } from './planFeatures.js';

export function subscriptionBranch(workspace, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  let routeBranch;
  try { routeBranch = decodeURIComponent(parts[1] || ''); } catch { return null; }
  const branch = parts.length >= 2 ? resolveBranchRef(workspace, routeBranch) : getUserBranch(workspace);
  return canAccessBranch(workspace, branch) ? branch : null;
}

export function watchSubscription({ listen, emit, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let alive = true;
  let timer;
  const clear = () => { if (timer !== undefined) cancel(timer); };
  const publish = entitlement => {
    if (!alive) return;
    clear();
    if (!entitlement
        || !Object.hasOwn(PLAN_PRICE_PHP, entitlement.plan)
        || !['trialing', 'active'].includes(entitlement.subscriptionStatus)
        || !Number.isFinite(Number(entitlement.periodEndAt))) {
      emit({ status: 'error', billing: null });
      return;
    }
    const billing = {
      plan: entitlement.plan,
      subscriptionStatus: entitlement.subscriptionStatus,
      periodStartAt: Number(entitlement.periodStartAt),
      periodEndAt: Number(entitlement.periodEndAt),
      trialStartedAt: Number(entitlement.trialStartedAt || 0),
    };
    emit({ status: 'ready', billing, checkedAt: now() });
    const remaining = billing.periodEndAt - now();
    if (isSubscriptionActive(billing, now()) && remaining > 0) {
      timer = schedule(() => publish(entitlement), Math.min(remaining + 1, 60000));
    }
  };
  const stop = listen(publish, () => {
    if (!alive) return;
    clear(); emit({ status: 'error', billing: null });
  });
  return () => { alive = false; clear(); stop(); };
}
