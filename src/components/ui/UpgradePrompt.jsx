import { useNavigate } from 'react-router-dom';
import { Sparkles, Lock, ArrowRight, ShieldQuestion } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AI_ACCESS_DENIED } from '../../lib/aiAccess';
import '../../styles/upgrade-prompt.css';

export default function UpgradePrompt({ feature, title, description, branchId, compact = false, deniedBy = null }) {
  const navigate = useNavigate();
  const { workspace } = useAuth();
  const trialEnding =
    workspace?.plan === 'subscription' &&
    workspace?.subscriptionStatus === 'trialing' &&
    Number(workspace?.trialEndsAt || 0) - Date.now() < 3 * 24 * 60 * 60 * 1000;

  // A role problem is not a billing problem, and the person reading this cannot
  // fix either one from here. Pointing them at the plans page would be worse than
  // saying nothing: subscribing would not help, and the route is closed to them
  // anyway, so the button would do nothing at all when pressed.
  const roleDenied = deniedBy === AI_ACCESS_DENIED.ROLE;

  return (
    <div className={`up ${compact ? 'up--compact' : ''}`} role="region" aria-label={title}>
      <div className="up__icon">
        {roleDenied ? <ShieldQuestion size={22} /> : trialEnding ? <Sparkles size={22} /> : <Lock size={22} />}
      </div>
      <div className="up__body">
        <h3 className="up__title">
          {roleDenied
            ? 'AI tools are for managers'
            : trialEnding ? 'Your AI trial is ending soon' : title || 'Subscription required'}
        </h3>
        <p className="up__desc">
          {roleDenied
            ? 'The AI analyst is available to branch managers and the business owner. Everything else on this dashboard is yours to use.'
            : trialEnding
              ? 'Activate billing to keep AI features, or your workspace will revert to the Free plan.'
              : description || `The ${feature || 'requested'} feature is part of the Subscription plan. Start a 14-day AI trial to unlock it.`}
        </p>
        {!roleDenied && (
          <div className="up__actions">
            <button
              type="button"
              className="up__btn up__btn--primary"
              onClick={() => navigate(`/subscription/${branchId}`)}
            >
              {trialEnding ? 'Activate billing' : 'View plans'}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
