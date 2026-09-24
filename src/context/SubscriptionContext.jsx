import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { onValue, ref } from 'firebase/database';
import { database } from '../lib/firebase';
import { subscriptionBranch, watchSubscription } from '../lib/subscriptionState';
import { useAuth } from './AuthContext';

const SubscriptionContext = createContext(null);
export function SubscriptionProvider({ children }) {
  const { user, workspace, workspaceStatus } = useAuth();
  const { pathname } = useLocation();
  const branchId = workspaceStatus === 'ready' ? subscriptionBranch(workspace, pathname) : null;
  const companyId = workspace?.companyId;
  const key = user?.uid && companyId && branchId ? `${user.uid}/${companyId}/${branchId}` : null;
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
  // Mask stale state during render, before effect cleanup executes.
  const current = key && state?.key === key && state.attempt === attempt && state.scope === scope
    ? state : { status: 'loading', billing: null };
  return <SubscriptionContext.Provider value={{ ...current, branchId, retry: () => setAttempt(n => n + 1) }}>{children}</SubscriptionContext.Provider>;
}
export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) throw new Error('useSubscription requires SubscriptionProvider');
  return value;
}
