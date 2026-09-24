import { useSubscription } from '../context/SubscriptionContext';
import { isSubscriptionActive } from '../lib/planFeatures';

export function useOperationalAccess() {
  const { billing, status } = useSubscription();
  return status === 'ready' && isSubscriptionActive(billing);
}
