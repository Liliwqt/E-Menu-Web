import { ROLE, normalizeRole } from './permissions.js';

/**
 * Wording for what happened to the branch's previous manager.
 *
 * Adding a manager replaces the sitting one, who steps down to staff. That is
 * worth saying out loud — the owner changed someone else's access as a side
 * effect of a form they filled in about a different person — and it must not be
 * said at all when the handover did not actually happen. Silence here would read
 * as "the old manager no longer has manager access", which is the one thing that
 * has to be true when it is claimed.
 */
export function managerHandoverNote({ replacedManagerUid, replacedDemoted } = {}) {
  if (!replacedManagerUid) return '';
  return replacedDemoted
    ? ' The branch\u2019s previous manager is now staff, because a branch has one manager.'
    : ' The branch\u2019s previous manager still holds the manager role \u2014 reload the page and '
      + 'remove them if they should not.';
}

/**
 * Whether removing this member leaves the branch with nobody managing it.
 *
 * A branch has one manager, so this is true when the member being removed is the
 * only one on the roster. It is not an error state — a branch with no manager is
 * what every business starts with, and its owner takes over — but the owner is
 * about to do it as a side effect of removing a person, so it is worth naming.
 */
export function removalLeavesBranchUnmanaged({ member, members = [] } = {}) {
  if (normalizeRole(member?.role) !== ROLE.MANAGER) return false;
  return !members.some(
    (other) => other.uid !== member.uid && normalizeRole(other.role) === ROLE.MANAGER
  );
}

/**
 * Wording for the branch losing its manager.
 *
 * Says what still works, because the alternative reading — that the branch is now
 * stuck — would stop an owner from removing a manager who has left the company.
 */
export function unmanagedBranchWarning({ branchName } = {}) {
  return `This is the only manager on ${branchName || 'this branch'}. Removing them leaves it `
    + 'without one, and running it falls back to you until another manager is appointed.';
}

/**
 * Wording for a removal whose account record could not be cleared.
 *
 * Access is gone either way — the membership records are what the rules read — so
 * this is not a warning about access. It is that the person will be greeted by a
 * business setup form if they sign in again, which is worth saying before the
 * owner finds out from them.
 */
export function removalNote({ accountRemoved } = {}) {
  // Only an explicit failure is reported. An absent value means the outcome was
  // not captured, and claiming the record survived when that is unknown would be
  // a false alarm every time the note is rendered from a partial state.
  if (accountRemoved !== false) return '';
  return ' Their sign-in record could not be cleared, so signing in again will ask them to '
    + 'set up a business rather than turn them away.';
}
