/**
 * Recovering from a stale bundle.
 *
 * Every deploy replaces the hashed chunks, and the old files are deleted. A tab
 * that loaded the previous index.html still holds the old filenames, so the first
 * time it navigates to a page it has not fetched yet the import fails — the file
 * it asks for no longer exists. The user sees a crash on a page that is perfectly
 * fine in the current deploy.
 *
 * Reloading fixes it: the browser fetches the current index.html, which names the
 * chunks that exist now. Serving index.html with no-cache makes that reload
 * reliable, but no cache header can help a tab that is already open, because the
 * stale bundle is in that tab's memory rather than its cache. So the recovery
 * happens in the app.
 *
 * Kept as a decision function so the rule that matters — once per session, then
 * stop — can be tested without a browser. Looping would be worse than the crash:
 * a deploy that is genuinely broken would put the tab in a reload cycle, and the
 * user would have no way to see what went wrong.
 */

export const CHUNK_RELOAD_FLAG = 'emp-chunk-reload';

export const CHUNK_FAILURE_ACTION = {
  /** Fetch the current index.html and try again. */
  RELOAD: 'reload',
  /** Already tried once; let the error surface. */
  SURFACE: 'surface',
};

export function chunkFailureAction({ alreadyRetried = false } = {}) {
  return alreadyRetried ? CHUNK_FAILURE_ACTION.SURFACE : CHUNK_FAILURE_ACTION.RELOAD;
}
