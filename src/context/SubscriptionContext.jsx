import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { onValue, ref } from 'firebase/database';
import { database } from '../lib/firebase';
import { subscriptionBranch, watchSubscription } from '../lib/subscriptionState';
import { useAuth } from './AuthContext';
import { recordBranchActivity } from '../lib/lifecycleApi';

const SubscriptionContext = createContext(null);
export function SubscriptionProvider({ children }) {
  const { user, role, workspace, workspaceStatus } = useAuth();
  const { pathname } = useLocation();
  const branchId = workspaceStatus === 'ready' ? subscriptionBranch(workspace, pathname) : null;
  const companyId = workspace?.companyId;
  const key = user?.uid && companyId && branchId ? `${user.uid}/${companyId}/${branchId}` : null;
  const [lifecycleState, setLifecycleState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);
  const scope = useMemo(() => ({}), [key, attempt]);
  useEffect(() => {
    if (!key) return undefined;
    return watchSubscription({
      listen: (next, fail) => onValue(ref(database, `billingEntitlements/${companyId}/${branchId}`), snapshot => next(snapshot.val()), fail),
      emit: next => setState({ ...next, key, attempt, scope }),
    });
  }, [key, companyId, branchId, attempt, scope]);
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const stop = onValue(ref(database, `${companyId}/branches/${branchId}/lifecycle`), snapshot => {
      if (alive) setLifecycleState({ key, scope, status: 'ready', value: snapshot.val() || { status: 'active' } });
    }, () => { if (alive) setLifecycleState({ key, scope, status: 'error', value: null }); });
    if (role === 'owner' || role === 'manager') recordBranchActivity(companyId, branchId).catch(() => {});
    return () => { alive = false; stop(); };
  }, [key, scope, companyId, branchId, role, pathname]);
  const lifecycleReady = lifecycleState?.key === key && lifecycleState.scope === scope;
  const lifecycle = lifecycleReady ? lifecycleState.value : null;
  // Mask stale state during render, before effect cleanup executes.
  const current = key && state?.key === key && state.attempt === attempt && state.scope === scope
    ? state : { status: 'loading', billing: null };
  const exposed = !lifecycleReady || lifecycleState.status !== 'ready'
    ? { status: lifecycleReady ? 'error' : 'loading', billing: null }
    : { ...current, billing: current.billing && (['closing', 'deleting', 'deleted'].includes(lifecycle?.status) || (lifecycle?.billingBlocked === true && current.billing.subscriptionStatus !== 'cancelled'))
      ? { ...current.billing, subscriptionStatus: 'inactive' } : current.billing };
  return <SubscriptionContext.Provider value={{ ...exposed, lifecycle, branchId, retry: () => setAttempt(n => n + 1) }}>{children}</SubscriptionContext.Provider>;
}
export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) throw new Error('useSubscription requires SubscriptionProvider');
  return value;
}
