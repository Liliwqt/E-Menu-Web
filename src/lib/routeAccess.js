/**
 * What a session is allowed to see, decided outside the components.
 *
 * These rules used to live inline in the route guards, where the only way to
 * check them was to be signed in and load the app. That is how a wrong ordering
 * survived: an unreachable account record and a brand-new account both arrive as
 * a null workspace, the guards tested the onboarding redirect before the failure,
 * and a dropped connection sent an existing owner to the company-creation form
 * under a fresh id with their real data left behind.
 *
 * Kept as plain functions and plain values here, so the ordering is something a
 * test can pin down rather than something to be read carefully.
 */

import { ACCESS_STATUS } from './accessStatus.js';

export { ACCESS_STATUS };

export const ROUTE_DECISION = {
  /** Still resolving; show a spinner. */
  LOADING: 'loading',
  /** Not signed in, or not permitted on this route at all. */
  LOGIN: 'login',
  /** The account records could not be read. Offer a retry, never a form. */
  ACCESS_ERROR: 'access-error',
  /** A real new account: onboarding. */
  SETUP: 'setup',
  /** Signed in, but this is not the branch they belong to. */
  REDIRECT_HOME: 'redirect-home',
  /** Render the requested page. */
  RENDER: 'render',
};

export const SETUP_PATH = '/setup';

/**
 * Guard for every page that lives under a branch.
 *
 * Order matters and is the point of the function. `ACCESS_ERROR` is settled
 * before anything can route to the setup form, because that form writes a new
 * company and must only ever be reached by an account that genuinely has none.
 */
export function protectedRouteDecision({
  initialLoading,
  isAuthenticated,
  workspaceLoaded,
  workspaceStatus,
  workspace,
  branchId,
  canAccessBranch,
}) {
  if (initialLoading) return ROUTE_DECISION.LOADING;
  if (!isAuthenticated) return ROUTE_DECISION.LOGIN;
  if (!workspaceLoaded) return ROUTE_DECISION.LOADING;

  // Checked before onboarding: both a failed read and a new account leave
  // `workspace` null, and only one of them should see the setup form.
  if (workspaceStatus === ACCESS_STATUS.ERROR) return ROUTE_DECISION.ACCESS_ERROR;

  if (!workspace?.onboardingComplete) return ROUTE_DECISION.SETUP;

  if (branchId && !canAccessBranch(workspace, branchId)) return ROUTE_DECISION.REDIRECT_HOME;

  return ROUTE_DECISION.RENDER;
}

/**
 * Guard for the onboarding route itself, which is where the expensive mistake
 * would happen, so it repeats the check rather than trusting the redirect that
 * got here.
 */
export function setupRouteDecision({
  initialLoading,
  isAuthenticated,
  workspaceLoaded,
  workspaceStatus,
  workspace,
}) {
  if (initialLoading || (isAuthenticated && !workspaceLoaded)) {
    return ROUTE_DECISION.LOADING;
  }
  if (!isAuthenticated) return ROUTE_DECISION.LOGIN;
  if (workspaceStatus === ACCESS_STATUS.ERROR) return ROUTE_DECISION.ACCESS_ERROR;
  if (workspace?.onboardingComplete) return ROUTE_DECISION.REDIRECT_HOME;
  return ROUTE_DECISION.RENDER;
}
