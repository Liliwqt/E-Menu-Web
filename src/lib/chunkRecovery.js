/**
 * Recovering from a stale bundle.
 *
 * Every deploy replaces the hashed chunks and deletes the old files. A tab that
 * loaded the previous index.html still holds the old filenames, so the first time
 * it opens a page it has not fetched yet, the import fails — what it asks for no
 * longer exists. The server answers with index.html rather than a 404, because of
 * the catch-all rewrite that makes deep links work, so the browser reports a MIME
 * mismatch rather than a missing file.
 *
 * Reloading fixes it, and the reload has to defeat the cache. A plain
 * location.reload() re-requests the same URL, and if index.html is still within
 * its freshness window the browser answers from its own cache — with the very
 * document that caused the failure. An hour of max-age on index.html was enough
 * to make that a loop: reload, same stale HTML, same missing chunk, reload.
 *
 * So the retry navigates to a URL with a marker on it. That is a URL the browser
 * has never fetched, so it must go to the network, and the path is untouched, so
 * the app routes to the same page. The marker is removed once the app is running.
 *
 * Loop protection is inherent rather than tracked in storage: if the marker is
 * already present, a cache-busting reload has been tried for this page and failed
 * again, so the error surfaces to the ErrorBoundary instead of retrying. That also
 * means a later navigation gets its own attempt, and a genuinely broken deploy
 * still shows the user what happened instead of spinning.
 */

export const RECOVERY_PARAM = '_r';

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/** Parses an href, absolute or root-relative, without needing a document. */
function parse(href) {
  if (ABSOLUTE_URL.test(href)) return new URL(href);
  return new URL(href, 'http://localhost');
}

function format(url, href) {
  if (ABSOLUTE_URL.test(href)) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Was this navigation already a cache-busting retry? */
export function hasRecoveryMarker(href) {
  return parse(href).searchParams.has(RECOVERY_PARAM);
}

/** The same URL plus a marker, so the browser cannot answer from its cache. */
export function buildRecoveryUrl(href, stamp = Date.now()) {
  const url = parse(href);
  url.searchParams.set(RECOVERY_PARAM, String(stamp));
  return format(url, href);
}

/** The URL without the marker, for keeping the address bar clean. */
export function stripRecoveryMarker(href) {
  const url = parse(href);
  if (!url.searchParams.has(RECOVERY_PARAM)) return null;
  url.searchParams.delete(RECOVERY_PARAM);
  return format(url, href);
}

export const CHUNK_FAILURE_ACTION = {
  /** Navigate to a cache-busting URL and try again. */
  RETRY_FRESH: 'retry-fresh',
  /** Already retried; let the error surface. */
  SURFACE: 'surface',
};

export function chunkFailureAction({ href } = {}) {
  return hasRecoveryMarker(href)
    ? CHUNK_FAILURE_ACTION.SURFACE
    : CHUNK_FAILURE_ACTION.RETRY_FRESH;
}
