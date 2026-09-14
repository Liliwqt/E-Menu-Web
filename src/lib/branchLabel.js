/**
 * What to call a branch on screen.
 *
 * Branch ids are machine keys — `branch-<company>-<branch>-<random>` — and three
 * things depend on them being exactly that: the routes, the kiosk enrolment
 * records, and the database rules that pattern-match `^branch-[a-z0-9-]+$`. They
 * are not free to change, and they are not meant to be read.
 *
 * They were being read anyway. Five screens asked a lookup table that used to
 * hold human names, and that table is now empty — it emptied when the hardcoded
 * administrator was removed — so `table[id]?.name || id` fell through to the id
 * on every render. The fallback was never wrong, just never reached, which is why
 * it went unnoticed.
 *
 * The name the owner typed is the label wherever it is known. The id is only
 * tidied when the branch is not in the workspace at all, which happens for a
 * stale link or a branch that has since been deleted.
 */

// The random suffix createBranchId appends, so a tidied id does not read as if
// the trailing characters were part of the name.
const RANDOM_SUFFIX = /-[a-z0-9]{6}$/;

/**
 * Falls back to a readable form of the id.
 *
 * This is a last resort and only cosmetic: it is used when the branch is not in
 * the workspace, so its real name is not available to show. It carefully does
 * nothing it cannot undo — a stem that would strip to empty is left alone.
 */
export function tidyBranchId(branchId) {
  const raw = String(branchId || '');
  if (!raw) return '';

  const withoutPrefix = raw.replace(/^branch-/, '');
  const withSuffixStripped = withoutPrefix.replace(RANDOM_SUFFIX, '');
  const stem = (withSuffixStripped || withoutPrefix).replace(/-+/g, ' ').trim();
  if (!stem) return raw;

  return stem.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * The label for one branch.
 *
 * `workspace.branches` is keyed by id and holds the name, so it answers for any
 * branch the company owns, not just the open one. `workspace.branchName` only
 * describes the branch the session is on, so it is used only when the id asked
 * about is that same branch — otherwise the wrong name would be shown for a
 * branch the reader is not looking at.
 */
export function branchLabel({ workspace, branchId } = {}) {
  if (!branchId) return '';

  const fromMap = workspace?.branches?.[branchId]?.name;
  if (fromMap) return fromMap;

  const isOpenBranch = workspace?.branchId === branchId;
  if (isOpenBranch && workspace?.branchName) return workspace.branchName;

  return tidyBranchId(branchId);
}
