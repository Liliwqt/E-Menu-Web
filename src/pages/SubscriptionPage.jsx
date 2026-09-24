import { useSubscription } from '../context/SubscriptionContext';
import SubscriptionStatus from '../components/ui/SubscriptionStatus';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check } from 'lucide-react';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import {
  PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, PLAN_PRICE_PHP,
  isSubscriptionActive, isTrialEndingSoon, trialDaysRemaining,
} from '../lib/planFeatures';
import { CAP } from '../lib/permissions';
import '../styles/subscription.css';

const PLANS = [
  { id: PLAN_BASIC, name: 'Basic', features: [
    'Menu, inventory, orders, team and device management',
    'Order payment status records (not verified settlement)',
    'Revenue graphs and standard reports',
  ] },
  { id: PLAN_STARTER, name: 'Starter', features: [
    'Everything in Basic',
    'Revenue-focused AI assistant, trend and gap analysis',
    'Business suggestions and AI-written reports',
    '300 generated AI responses per branch each period',
  ] },
  { id: PLAN_PREMIUM, name: 'Premium', features: [
    'Everything in Starter',
    'Live analyst, shift handoff, simulations and executive presentations',
    'Persistent, curated branch insights',
    '1,000 generated AI responses per branch each period',
  ] },
];

export default function SubscriptionPage() {
  const { branchId } = useBranchData();
  const { workspace, can } = useAuth();
  const navigate = useNavigate();
  const { billing, status } = useSubscription();
  if (status !== 'ready') return <div className="sub"><h1>Subscription</h1><SubscriptionStatus /></div>;

  const active = isSubscriptionActive(billing);
  const ending = isTrialEndingSoon(billing);
  const days = trialDaysRemaining(billing);
  const expiry = new Date(billing.periodEndAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const owner = can(CAP.MANAGE_BILLING);

  return (
    <div className="sub">
      <header className="sub__header">
        <button type="button" className="sub__back" onClick={() => navigate(`/home/${branchId}`)}>
          <ChevronLeft size={18} /> Back to dashboard
        </button>
        <div>
          <h1 className="sub__title">Subscription</h1>
          <p className="sub__subtitle">Plans are monthly per branch. All active plans include daily operations.</p>
        </div>
      </header>
      <div className={`sub__trial ${ending || !active ? 'is-ending' : ''}`} role="status">
        <div>
          <strong>{active ? `${billing.plan[0].toUpperCase() + billing.plan.slice(1)} ${billing.subscriptionStatus === 'trialing' ? 'trial' : 'plan'} active` : 'Plan expired — read-only'}</strong>
          {' · '}{active && billing.subscriptionStatus === 'trialing' ? `${days} day${days === 1 ? '' : 's'} left; ends ${expiry}` : `Period ends ${expiry}`}
          {!active && '. Existing records remain visible. New operations and AI are paused until payment is activated.'}
        </div>
      </div>
      <section className="sub__plans">
        {PLANS.map(option => (
          <article key={option.id} className={`sub__plan ${billing.plan === option.id ? 'is-current' : ''}`}>
            {billing.plan === option.id && <span className="sub__planBadge">Current tier</span>}
            <header>
              <h2>{option.name}</h2>
              <p className="sub__planPrice">₱{PLAN_PRICE_PHP[option.id].toLocaleString('en-PH')} / branch / month</p>
            </header>
            <ul className="sub__planFeatures">
              {option.features.map(feature => <li key={feature}><Check size={14} /> {feature}</li>)}
            </ul>
          </article>
        ))}
      </section>
      <div className="sub__trial" role="note">
        {owner
          ? <>To activate or renew, arrange payment with the service operator. Give them company ID <strong>{workspace.companyId}</strong> and branch ID <strong>{branchId}</strong>. Access changes only after payment is verified.</>
          : 'Ask the business owner to arrange a plan change or renewal.'}
      </div>
      <p className="sub__subtitle">Order payment statuses mean customer-reported QR payment or pay-at-counter. They do not confirm that money was received.</p>
    </div>
  );
}
