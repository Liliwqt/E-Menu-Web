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
