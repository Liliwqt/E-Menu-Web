import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_FAILURE_ACTION,
  RECOVERY_PARAM,
  buildRecoveryUrl,
  chunkFailureAction,
  hasRecoveryMarker,
  stripRecoveryMarker,
} from './chunkRecovery.js';

const HREF = 'https://touch-menu-web.online/inventory/branch-test1-branch1-85sr93';

describe('a stale chunk is retried once, on a URL the browser cannot serve from cache', () => {
  it('does not treat an ordinary navigation as a retry', () => {
    assert.equal(hasRecoveryMarker(HREF), false);
    assert.equal(chunkFailureAction({ href: HREF }), CHUNK_FAILURE_ACTION.RETRY_FRESH);
  });

  it('builds a different URL, so the document has to come from the network', () => {
    // The whole point: reloading the same URL can be answered with the cached
    // document, which is the one that caused the failure.
    const retry = buildRecoveryUrl(HREF, 1700000000000);
    assert.notEqual(retry, HREF);
    assert.equal(hasRecoveryMarker(retry), true);
  });

  it('keeps the path, so the app still routes to the same page', () => {
    // A marker on the root would send the user to the login page instead of the
    // page they were trying to reach. Deep links have to survive the retry.
    const retry = buildRecoveryUrl(HREF, 1700000000000);
    assert.ok(retry.includes('/inventory/branch-test1-branch1-85sr93'), retry);
    assert.ok(retry.startsWith('https://touch-menu-web.online/'), retry);
  });

  it('surfaces the error on the second failure rather than retrying forever', () => {
    // Loop protection without any stored state: the marker is on the URL, so the
    // second attempt knows it has already been through this.
    const retry = buildRecoveryUrl(HREF, 1700000000000);
    assert.equal(chunkFailureAction({ href: retry }), CHUNK_FAILURE_ACTION.SURFACE);
  });

  it('gives the next navigation its own attempt', () => {
    // The marker is stripped once the app runs, so a later failure is a first
    // failure again. A session-wide "already retried" flag would have disabled
    // recovery for the rest of the tab's life.
    assert.equal(chunkFailureAction({ href: HREF }), CHUNK_FAILURE_ACTION.RETRY_FRESH);
  });
});

describe('stripping the marker back off', () => {
  it('restores the original URL', () => {
    const retry = buildRecoveryUrl(HREF, 1700000000000);
    assert.equal(stripRecoveryMarker(retry), HREF);
  });

  it('reports nothing to strip when there is no marker', () => {
    assert.equal(stripRecoveryMarker(HREF), null);
  });

  it('keeps any other query parameters, which may be meaningful', () => {
    const withFilter = `${HREF}?view=low`;
    const retry = buildRecoveryUrl(withFilter, 1700000000000);
    assert.equal(stripRecoveryMarker(retry), `${HREF}?view=low`);
  });

  it('leaves the hash alone', () => {
    const withHash = `${HREF}#row-3`;
    const retry = buildRecoveryUrl(withHash, 1700000000000);
    assert.equal(stripRecoveryMarker(retry), withHash);
  });
});

describe('hrefs the app can actually produce', () => {
  it('handles a root-relative href and returns one', () => {
    const retry = buildRecoveryUrl('/inventory/branch-x', 1700000000000);
    assert.ok(retry.startsWith('/inventory/branch-x?'), retry);
    assert.equal(hasRecoveryMarker(retry), true);
    assert.equal(stripRecoveryMarker(retry), '/inventory/branch-x');
  });

  it('handles the root itself', () => {
    const retry = buildRecoveryUrl('/', 1700000000000);
    assert.equal(stripRecoveryMarker(retry), '/');
  });

  it('replaces a marker that is already there rather than stacking them', () => {
    const once = buildRecoveryUrl(HREF, 1);
    const twice = buildRecoveryUrl(once, 2);
    assert.equal(twice.split(RECOVERY_PARAM).length - 1, 1, twice);
  });
});
