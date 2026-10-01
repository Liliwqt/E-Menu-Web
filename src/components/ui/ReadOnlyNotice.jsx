import { useSubscription } from '../../context/SubscriptionContext';
import { isSubscriptionActive } from '../../lib/planFeatures';
import SubscriptionStatus from './SubscriptionStatus';

export default function ReadOnlyNotice() {
  const { billing, status } = useSubscription();
  if (status !== 'ready') return <SubscriptionStatus />;
  if (isSubscriptionActive(billing)) return null;
  return <div className="card card--pad" role="status">This branch is read-only because access is paused by expiry, cancellation or closure. Existing records remain visible; ask the owner to check Records and access on the Subscription page.</div>;
}
