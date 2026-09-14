import { useAuth } from '../context/AuthContext';
import { isUserAdmin } from '../config/authConfig';
import { isAiEnabled } from '../lib/workspaceApi';
import { canUseAi } from '../lib/aiAccess';

/**
 * Whether the signed-in session may use the AI analyst — see lib/aiAccess.js for
 * why this is a role check as well as a plan check.
 *
 * Every AI surface should read this rather than isAiEnabled(workspace), which
 * only answers the plan half.
 */
export function useAiAccess() {
  const { can, workspace, user } = useAuth();
  return canUseAi({
    can,
    workspace,
    isAiEnabled,
    isAdmin: isUserAdmin(user?.email),
  });
}
