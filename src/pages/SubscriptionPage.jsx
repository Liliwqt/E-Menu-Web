import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Sparkles, Loader2 } from 'lucide-react';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
  isSubscriptionActive,
  isTrialEndingSoon,
  trialDaysRemaining,
  FEATURE,
  FEATURE_METADATA,
} from '../lib/planFeatures';
import { upgradeToSubscription, downgradeToFree } from '../lib/workspaceApi';
import { PLAN_FREE, PLAN_SUBSCRIPTION } from '../lib/planFeatures';
import { CAP } from '../lib/permissions';
import '../styles/subscription.css';

const PLANS = [
  {
    id: PLAN_FREE,
    name: 'Free',
    price: '₱0',
    description: 'Run the daily restaurant operation without AI.',
    features: [
      'Menu and inventory management',
      'Live kiosk orders',
      'Basic sales dashboard',
      'Order history',
    ],
  },
  {
    id: PLAN_SUBSCRIPTION,
    name: 'Subscription',
    price: '14-day AI trial',
    description: 'Everything in Free, plus AI operations intelligence.',
    features: [
      'AI Operations Analyst (Live & Realtime)',
      'AI Shift Handoff (Daily Business Brief)',
      'Executive Presentation generator',
      'Revenue Leak Detection',
      'AI Chat Assistant with memory',
      'Smart Recommendations',
      'Deep Analytics with forecasting',
      'Multiple kiosk management',
    ],
  },
];

export default function SubscriptionPage() {
  const { branchId } = useBranchData();
  const navigate = useNavigate();
  const { user, workspace, setWorkspaceFromProps, can } = useAuth();
  // Billing is the company owner's call. Managers and staff can read what the
  // branch is on, which is useful when a feature is locked, but cannot change it.
  const canManageBilling = can(CAP.MANAGE_BILLING);
  // Confirming in the page rather than through the browser. The dialog this used
  // to call is refused in a sandboxed frame and returns false in the Android
  // WebView, so the plan switch quietly did nothing there.
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const subscriptionActive = isSubscriptionActive(workspace);
  const trialEnding = isTrialEndingSoon(workspace, 3);
  const daysLeft = trialDaysRemaining(workspace);

  async function handleUpgrade() {
    if (!user?.uid || !branchId || !canManageBilling) return;
    setError('');
    setWorking(true);
    try {
      const updated = await upgradeToSubscription(user.uid, branchId);
      if (setWorkspaceFromProps) setWorkspaceFromProps(updated);
    } catch (err) {
      setError(err.message || 'Could not start the trial.');
    } finally {
      setWorking(false);
    }
  }

  async function handleDowngrade() {
    if (!user?.uid || !branchId || !canManageBilling) return;
    setError('');
    setWorking(true);
    try {
      const updated = await downgradeToFree(user.uid, branchId);
      if (setWorkspaceFromProps) setWorkspaceFromProps(updated);
    } catch (err) {
      setError(err.message || 'Could not switch to the Free plan.');
    } finally {
      setWorking(false);
      setConfirmDowngrade(false);
    }
  }

  return (
    <div className="sub">
      <header className="sub__header">
        <button type="button" className="sub__back" onClick={() => navigate(`/home/${branchId}`)}>
          <ChevronLeft size={18} /> Back to dashboard
        </button>
        <div>
          <h1 className="sub__title">Subscription</h1>
          <p className="sub__subtitle">
            The Free plan covers your daily operations. The Subscription plan unlocks AI analyst,
            proactive insights, and multi-kiosk management.
          </p>
        </div>
      </header>

      {subscriptionActive && workspace?.subscriptionStatus === 'trialing' && (
        <div className={`sub__trial ${trialEnding ? 'is-ending' : ''}`} role="status">
          <Sparkles size={18} />
          <div>
            <strong>AI trial active.</strong> {daysLeft} day{daysLeft === 1 ? '' : 's'} remaining.
            {trialEnding && ' Your trial is ending soon — activate billing to keep AI features.'}
          </div>
        </div>
      )}

      {error && <div className="sub__error" role="alert">{error}</div>}

      <section className="sub__plans">
        {PLANS.map((option) => {
          const isCurrent =
            (option.id === PLAN_SUBSCRIPTION && subscriptionActive) ||
            (option.id === PLAN_FREE && !subscriptionActive);

          return (
            <article key={option.id} className={`sub__plan ${isCurrent ? 'is-current' : ''}`}>
              {isCurrent && <span className="sub__planBadge">Current plan</span>}
              <header>
                <h2>{option.name}</h2>
                <p className="sub__planPrice">{option.price}</p>
                <p className="sub__planDesc">{option.description}</p>
              </header>
              <ul className="sub__planFeatures">
                {option.features.map((feature) => (
                  <li key={feature}><Check size={14} /> {feature}</li>
                ))}
              </ul>
              <div className="sub__planActions">
                {!canManageBilling ? (
                  isCurrent ? (
                    <span className="sub__planCurrent">This is your branch's plan</span>
                  ) : (
                    <span className="sub__planCurrent">Ask the business owner to change plans</span>
                  )
                ) : option.id === PLAN_SUBSCRIPTION ? (
                  !subscriptionActive ? (
                    <button
                      type="button"
                      className="sub__btn sub__btn--primary"
                      onClick={handleUpgrade}
                      disabled={working}
                    >
                      {working ? <Loader2 size={16} className="sub__spin" /> : <Sparkles size={16} />}
                      Start 14-day AI trial
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="sub__btn sub__btn--ghost"
                      onClick={() => setConfirmDowngrade(true)}
                      disabled={working}
                    >
                      {working ? <Loader2 size={16} className="sub__spin" /> : null}
                      Switch to Free
                    </button>
                  )
                ) : (
                  !subscriptionActive ? (
                    <span className="sub__planCurrent">You are on this plan</span>
                  ) : (
                    <button
                      type="button"
                      className="sub__btn sub__btn--ghost"
                      onClick={() => setConfirmDowngrade(true)}
                      disabled={working}
                    >
                      Switch to Free
                    </button>
                  )
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="sub__featureMatrix">
        <h2>Feature comparison</h2>
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Free</th>
              <th>Subscription</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(FEATURE).map((featureKey) => {
              const meta = FEATURE_METADATA[featureKey];
              return (
                <tr key={featureKey}>
                  <td>
                    <strong>{meta.label}</strong>
                    <span>{meta.description}</span>
                  </td>
                  <td>{featureKey === FEATURE.MULTI_KIOSK || featureKey === FEATURE.TEAM_MEMBERS || AI_FEATURES.has(featureKey) ? '—' : <Check size={16} />}</td>
                  <td><Check size={16} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={confirmDowngrade}
        title="Switch to the Free plan?"
        message={'The AI analyst, proactive insights and multi-kiosk management stop working '
          + 'immediately. Your menu, orders and stock are not affected, and you can start '
          + 'the trial again from this screen.'}
        confirmLabel="Switch to Free"
        workingLabel="Switching…"
        working={working}
        onConfirm={handleDowngrade}
        onClose={() => setConfirmDowngrade(false)}
      />
    </div>
  );
}

const AI_FEATURES = new Set([
  FEATURE.AI_ANALYST,
  FEATURE.AI_HANDOFF,
  FEATURE.EXECUTIVE_PRESENTATION,
  FEATURE.REVENUE_LEAK,
  FEATURE.AI_CHAT,
  FEATURE.SMART_RECOMMENDATIONS,
  FEATURE.DEEP_ANALYTICS,
]);
