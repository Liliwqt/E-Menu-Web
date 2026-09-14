/**
 * Access configuration — derived from the user's workspace, not hardcoded.
 *
 * The branch assignment is stored in the Realtime Database at
 *   /users/{uid}/workspace/branchId
 * which is created during onboarding and enforced by the Realtime Database
 * Security Rules. There is no email allowlist and no privileged account: an
 * account's access comes from the records it owns, and the first owner is whoever
 * completes onboarding.
 *
 * If a signed-in user has no workspace, the React router redirects them to
 * /setup to complete onboarding.
 *
 * This file previously carried a hardcoded administrator address, which bypassed
 * branch scoping entirely and granted owner rights everywhere. It existed to seed
 * the first production owner, which onboarding now does properly, so it was a
 * single-address backdoor in a public repository with nothing left to justify it.
 */
export const AUTH_CONFIG = {
  branches: {},
};

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
