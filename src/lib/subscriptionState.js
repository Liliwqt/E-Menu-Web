import { resolveBranchRef } from './branchRef.js';
import { canAccessBranch, getUserBranch } from '../config/authConfig.js';

export function subscriptionBranch(workspace, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  let routeBranch;
  try { routeBranch = decodeURIComponent(parts[1] || ''); } catch { return null; }
  const branch = parts.length >= 2 ? resolveBranchRef(workspace, routeBranch) : getUserBranch(workspace);
  return canAccessBranch(workspace, branch) ? branch : null;
}

// Own listener lifetime and expiry ticks together; callbacks from an old scope
// must never repopulate billing after logout or navigation.
export function watchSubscription({ listen, emit, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let alive = true;
  let timer;
  const clear = () => { if (timer !== undefined) cancel(timer); };
  const publish = profile => {
    if (!alive) return;
    clear();
    if (!profile || !['free', 'subscription'].includes(profile.plan) || !profile.subscriptionStatus) {
      emit({ status: 'error', billing: null });
      return;
    }
    const billing = { plan: profile.plan, subscriptionStatus: profile.subscriptionStatus, trialEndsAt: profile.trialEndsAt ?? null };
    emit({ status: 'ready', billing, checkedAt: now() });
    const remaining = Number(billing.trialEndsAt) - now();
    if (billing.subscriptionStatus === 'trialing' && remaining > 0) {
      timer = schedule(() => publish(profile), Math.min(remaining + 1, 60_000));
    }
  };
  const stop = listen(publish, () => {
    if (!alive) return;
    clear(); emit({ status: 'error', billing: null });
  });
  return () => { alive = false; clear(); stop(); };
}
