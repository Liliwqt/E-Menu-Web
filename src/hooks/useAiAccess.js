import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { canUseAiMode, isAiEnabled } from '../lib/planFeatures';
import { aiAccessDenial, canUseAi } from '../lib/aiAccess';
import { CAP } from '../lib/permissions';

function resolveAiAccess() {
  const { can } = useAuth();
  const { billing: workspace } = useSubscription();
  return {
    allowed: canUseAi({ can, workspace, isAiEnabled }),
    deniedBy: aiAccessDenial({
      roleAllowsAi: can(CAP.USE_AI),
      planIncludesAi: isAiEnabled(workspace),
    }),
  };
}

/**
 * Whether the signed-in session may use the AI analyst — see lib/aiAccess.js for
 * why this is a role check as well as a plan check.
 *
 * Every AI surface should read this rather than isAiEnabled(workspace), which
 * only answers the plan half.
 */
export function useAiAccess() {
  return resolveAiAccess().allowed;
}

/**
 * Why AI is unavailable, for the screens that have to explain it.
 *
 * A plan problem and a role problem need different words. Telling a staff member
 * to start a trial is wrong twice over: the branch may already be subscribed, and
 * they cannot subscribe anyway — billing is the owner's. Returns null when AI is
 * available, and the reason otherwise.
 */
export function useAiDenial() {
  return resolveAiAccess().deniedBy;
}


export function useAiModeAccess(mode) {
  const { can } = useAuth();
  const { billing } = useSubscription();
  return can(CAP.USE_AI) && canUseAiMode(billing, mode);
}
