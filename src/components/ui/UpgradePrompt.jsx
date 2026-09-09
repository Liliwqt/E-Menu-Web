import { useNavigate } from 'react-router-dom';
import { Sparkles, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import '../../styles/upgrade-prompt.css';

export default function UpgradePrompt({ feature, title, description, branchId, compact = false }) {
  const navigate = useNavigate();
  const { workspace } = useAuth();
  const trialEnding =
    workspace?.plan === 'subscription' &&
    workspace?.subscriptionStatus === 'trialing' &&
    Number(workspace?.trialEndsAt || 0) - Date.now() < 3 * 24 * 60 * 60 * 1000;

  return (
    <div className={`up ${compact ? 'up--compact' : ''}`} role="region" aria-label={title}>
      <div className="up__icon">
        {trialEnding ? <Sparkles size={22} /> : <Lock size={22} />}
      </div>
      <div className="up__body">
        <h3 className="up__title">
          {trialEnding ? 'Your AI trial is ending soon' : title || 'Subscription required'}
        </h3>
        <p className="up__desc">
          {trialEnding
            ? 'Activate billing to keep AI features, or your workspace will revert to the Free plan.'
            : description || `The ${feature || 'requested'} feature is part of the Subscription plan. Start a 14-day AI trial to unlock it.`}
        </p>
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
      </div>
    </div>
  );
}
