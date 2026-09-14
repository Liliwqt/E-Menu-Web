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
