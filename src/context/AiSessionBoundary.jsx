import { useLayoutEffect } from 'react';
import { useAuth } from './AuthContext';
import { useSubscription } from './SubscriptionContext';
import { isAiEnabled } from '../lib/planFeatures';
import { aiSession, clearLegacyAiStorage } from '../lib/aiSession.js';

export function AiSessionBoundary({ children }) {
  const { user, workspace, role } = useAuth();
  const { status, billing, branchId } = useSubscription();
  const allowed = status === 'ready' && ['owner', 'manager'].includes(role) && isAiEnabled(billing);
  const key = JSON.stringify([user?.uid, workspace?.companyId, branchId, allowed, billing?.plan, billing?.subscriptionStatus, billing?.periodStartAt, billing?.periodEndAt]);
  useLayoutEffect(() => {
    clearLegacyAiStorage(localStorage, sessionStorage);
    aiSession.reset(allowed ? { uid: user.uid, companyId: workspace.companyId, branchId, billing } : null);
    return () => aiSession.reset();
  }, [key]); // primitives encode the complete access scope
  return <div key={key} style={{ display: 'contents' }}>{children}</div>;
}
