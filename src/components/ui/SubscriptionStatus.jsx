import { useSubscription } from '../../context/SubscriptionContext';
export default function SubscriptionStatus() {
  const { status, retry } = useSubscription();
  if (status === 'ready') return null;
  if (status === 'loading') return <p role="status">Loading subscription…</p>;
  return <div role="alert">Could not load the branch subscription. <button type="button" onClick={retry}>Retry subscription</button></div>;
}
