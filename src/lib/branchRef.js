/**
 * Reading and writing a branch in a URL.
 *
 * Branch ids are machine keys — `branch-<company>-<branch>-<random>` — and they
 * are what the routes, the kiosk enrolment records and the database rules are all
 * keyed on. They cannot be changed without invalidating a kiosk's saved
 * configuration, so the id stays exactly as it is and the URL carries it too.
 *
 * Which leaves the URL reading like `/home/branch-test1-branch1-85sr93`. That is
 * a faithful identifier and a poor address, so the URL may name the branch instead
 * — `/home/branch1` — and the app maps it back to the id before touching any data.
 *
 * Both forms resolve, so a link saved before this still works, and a link copied
 * after it is readable. Anything that cannot be resolved is refused rather than
 * guessed at: a wrong branch resolved silently would show one branch's data under
 * another's name.
 *
 * Resolution is per-viewer, against the branches that viewer's own workspace
 * names. It cannot reach a branch the reader could not already open, so it adds no
 * access.
 */

/**
 * The branches a workspace can name, in one shape.
 *
 * Both functions below read through this deliberately. If the set that produces a
 * URL and the set that reads it back ever disagreed, a URL could be written that
 * the app then refused to open — which is an endless redirect, not an error.
 */
function branchEntries(workspace) {
  const map = workspace?.branches;
  if (map && typeof map === 'object' && Object.keys(map).length > 0) {
    return Object.entries(map).map(([id, branch]) => ({ id, name: branch?.name || '' }));
  }
  // Workspaces created before the branches map existed describe one branch only.
  if (workspace?.branchId) {
    return [{ id: workspace.branchId, name: workspace.branchName || '' }];
  }
  return [];
}

/** A branch name as a URL segment. Not unique — see branchRefFor. */
export function slugifyBranchName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * The branch id a URL segment refers to, or null.
 *
 * The id is checked first, so an id always wins over a name that happens to look
 * like one. A name is accepted only when exactly one branch has it: two branches
 * called "Main" would otherwise resolve to whichever came first in the object,
 * which could quietly show the wrong one.
 */
export function resolveBranchRef(workspace, ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;

  const entries = branchEntries(workspace);

  if (entries.some((entry) => entry.id === raw)) return raw;

  const matches = entries.filter((entry) => slugifyBranchName(entry.name) === raw);
  return matches.length === 1 ? matches[0].id : null;
}

/**
 * The URL segment to use for a branch.
 *
 * Prefers the name, and falls back to the id whenever a name would be ambiguous,
 * empty, or indistinguishable from an id. Falling back is not a failure: the id
 * resolves for everyone, which is exactly what a link needs to be shareable.
 */
export function branchRefFor(workspace, branchId) {
  if (!branchId) return '';

  const entries = branchEntries(workspace);
  const self = entries.find((entry) => entry.id === branchId);
  if (!self) return branchId;

  const slug = slugifyBranchName(self.name);
  if (!slug || slug === branchId) return branchId;
  // A name that spells out another branch's id would shadow it.
  if (entries.some((entry) => entry.id === slug)) return branchId;

  const sharing = entries.filter((entry) => slugifyBranchName(entry.name) === slug);
  return sharing.length === 1 ? slug : branchId;
}

/**
 * Swaps the last path segment, which is where the branch ref sits in every route
 * this app defines.
 *
 * Empty segments are dropped, so a trailing slash is not carried into the new
 * path. `location.pathname` is used rather than the full href, so nothing here
 * touches a query string or a hash.
 */
export function withBranchRef(pathname, ref) {
  const path = String(pathname || '');
  if (!path || !ref) return path;

  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return '/';

  segments[segments.length - 1] = ref;
  return `/${segments.join('/')}`;
}
