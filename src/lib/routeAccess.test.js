import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_STATUS, ROUTE_DECISION, protectedRouteDecision, setupRouteDecision } from './routeAccess.js';

/** A signed-in session whose records loaded fine and who has a branch to show. */
const signedIn = {
  initialLoading: false,
  isAuthenticated: true,
  workspaceLoaded: true,
  workspaceStatus: ACCESS_STATUS.READY,
  workspace: { onboardingComplete: true, companyId: 'company-a', branchId: 'branch-a' },
  branchId: 'branch-a',
  canAccessBranch: () => true,
};

describe('an unreachable account is never mistaken for a new one', () => {
  // The regression these exist for. Onboarding writes a new company, so routing a
  // dropped connection there does not just show the wrong screen — it offers to
  // create a second company for an owner who already has one, under a fresh id,
  // leaving their real data in the company they can no longer see.
  it('sends a failed read to the retry screen, not the setup form', () => {
    const decision = protectedRouteDecision({
      ...signedIn,
      workspaceStatus: ACCESS_STATUS.ERROR,
      workspace: null,
    });
    assert.equal(decision, ROUTE_DECISION.ACCESS_ERROR);
  });

  it('sends a genuine new account to the setup form', () => {
    const decision = protectedRouteDecision({
      ...signedIn,
      workspaceStatus: ACCESS_STATUS.NONE,
      workspace: null,
    });
    assert.equal(decision, ROUTE_DECISION.SETUP);
  });

  it('still refuses the setup form on the setup route itself', () => {
    // The redirect that reaches /setup could be stale or typed. This route is the
    // one that commits the write, so it does not rely on the redirect being right.
    const decision = setupRouteDecision({
      initialLoading: false,
      isAuthenticated: true,
      workspaceLoaded: true,
      workspaceStatus: ACCESS_STATUS.ERROR,
      workspace: null,
    });
    assert.equal(decision, ROUTE_DECISION.ACCESS_ERROR);
  });

  it('keeps the two apart even though both carry a null workspace', () => {
    const failed = protectedRouteDecision({
      ...signedIn,
      workspaceStatus: ACCESS_STATUS.ERROR,
      workspace: null,
    });
    const missing = protectedRouteDecision({
      ...signedIn,
      workspaceStatus: ACCESS_STATUS.NONE,
      workspace: null,
    });
    assert.notEqual(failed, missing);
  });
});

describe('waiting for the records to load', () => {
  it('shows a spinner rather than deciding early', () => {
    // Deciding before the load finishes would bounce a signed-in owner off their
    // own pages on every refresh, since role is null until it resolves.
    assert.equal(
      protectedRouteDecision({ ...signedIn, workspaceLoaded: false, workspaceStatus: ACCESS_STATUS.LOADING }),
      ROUTE_DECISION.LOADING
    );
    assert.equal(
      protectedRouteDecision({ ...signedIn, initialLoading: true }),
      ROUTE_DECISION.LOADING
    );
  });

  it('does not flash the setup form while an authenticated session loads', () => {
    assert.equal(
      setupRouteDecision({
        initialLoading: false,
        isAuthenticated: true,
        workspaceLoaded: false,
        workspaceStatus: ACCESS_STATUS.LOADING,
        workspace: null,
      }),
      ROUTE_DECISION.LOADING
    );
  });
});

describe('signed-out sessions', () => {
  it('sends a signed-out visitor to the login route', () => {
    assert.equal(
      protectedRouteDecision({ ...signedIn, isAuthenticated: false }),
      ROUTE_DECISION.LOGIN
    );
  });

  it('sends a signed-out visitor to the login route from the setup route too', () => {
    assert.equal(
      setupRouteDecision({
        initialLoading: false,
        isAuthenticated: false,
        workspaceLoaded: true,
        workspaceStatus: ACCESS_STATUS.NONE,
        workspace: null,
      }),
      ROUTE_DECISION.LOGIN
    );
  });
});

describe('a loaded session', () => {
  it('renders the page', () => {
    assert.equal(protectedRouteDecision(signedIn), ROUTE_DECISION.RENDER);
  });

  it('bounces a branch the account cannot reach back to its own', () => {
    assert.equal(
      protectedRouteDecision({ ...signedIn, canAccessBranch: () => false }),
      ROUTE_DECISION.REDIRECT_HOME
    );
  });

  it('renders a branch-scoped page when there is no branch in the path', () => {
    assert.equal(
      protectedRouteDecision({ ...signedIn, branchId: undefined, canAccessBranch: () => false }),
      ROUTE_DECISION.RENDER
    );
  });

  it('sends a half-finished signup back to onboarding', () => {
    assert.equal(
      protectedRouteDecision({
        ...signedIn,
        workspace: { onboardingComplete: false, companyId: 'company-a' },
      }),
      ROUTE_DECISION.SETUP
    );
  });

  it('redirects a completed signup away from the setup route', () => {
    assert.equal(
      setupRouteDecision({
        initialLoading: false,
        isAuthenticated: true,
        workspaceLoaded: true,
        workspaceStatus: ACCESS_STATUS.READY,
        workspace: { onboardingComplete: true, companyId: 'company-a', branchId: 'branch-a' },
      }),
      ROUTE_DECISION.REDIRECT_HOME
    );
  });

  it('renders the setup form for a loaded account that has no workspace', () => {
    assert.equal(
      setupRouteDecision({
        initialLoading: false,
        isAuthenticated: true,
        workspaceLoaded: true,
        workspaceStatus: ACCESS_STATUS.NONE,
        workspace: null,
      }),
      ROUTE_DECISION.RENDER
    );
  });
});
