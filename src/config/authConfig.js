/**
 * Access configuration — derived from the user's workspace, not hardcoded.
 *
 * The branch assignment is now stored in the Realtime Database at
 *   /users/{uid}/workspace/branchId
 * which is created during onboarding and enforced by the Realtime Database
 * Security Rules. This file no longer holds an email allowlist; the admin
 * shortcut is the only hardcoded exception (used to seed the very first
 * production owner during setup).
 *
 * If a signed-in user has no workspace, the React router redirects them to
 * /setup to complete onboarding.
 */
export const AUTH_CONFIG = {
  adminEmail: 'fitzhofer@gmail.com',
  branches: {},
};

export function isUserAdmin(email) {
  return email === AUTH_CONFIG.adminEmail;
}

export function getUserBranch(workspace) {
  if (!workspace?.onboardingComplete || !workspace.companyId) return null;
  const branchId = workspace.branchId;
  const knownBranches = workspace.branches || {};
  if (branchId && (knownBranches[branchId] || /^branch-[a-z0-9-]+$/.test(branchId))) return branchId;
  return null;
}

export function canAccessBranch(workspace, requestedBranchId) {
  if (!workspace?.onboardingComplete || !workspace.companyId || !requestedBranchId) return false;
  if (!/^branch-[a-z0-9-]+$/.test(requestedBranchId)) return false;
  const knownBranches = workspace.branches || {};
  return knownBranches[requestedBranchId] != null || workspace.branchId === requestedBranchId;
}
