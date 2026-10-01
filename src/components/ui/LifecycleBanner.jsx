import { Link } from 'react-router-dom';
import { useSubscription } from '../../context/SubscriptionContext';
export default function LifecycleBanner() {
  const { lifecycle, branchId } = useSubscription();
  if (!lifecycle || lifecycle.status === 'active') return null;
  const deadline = lifecycle.deleteAt ? new Date(lifecycle.deleteAt).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
  }) : null;
  return <div className="sub__trial is-ending" role="status">
    {lifecycle.status === 'warning_pending' ? 'This branch has been inactive for 12 months. The owner email warning is awaiting delivery; deletion is not scheduled yet.'
      : lifecycle.status === 'inactivity_grace' ? 'This inactive branch is scheduled for deletion. Resume activity or download your records.'
      : 'Branch closure is in progress. New writes and ordering are paused. Download records or recover before deletion begins.'}
    {deadline && <> Deadline: {deadline} Philippine time.</>}{' '}
    <Link to={`/subscription/${branchId}`}>Records and access</Link>
  </div>;
}
