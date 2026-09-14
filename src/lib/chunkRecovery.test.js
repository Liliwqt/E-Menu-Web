import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_FAILURE_ACTION, chunkFailureAction } from './chunkRecovery.js';

describe('recovering from a chunk that belongs to a previous deploy', () => {
  it('reloads the first time a page fails to load', () => {
    assert.equal(
      chunkFailureAction({ alreadyRetried: false }),
      CHUNK_FAILURE_ACTION.RELOAD
    );
  });

  it('surfaces the error the second time, rather than reloading again', () => {
    // A deploy that is genuinely broken must not put the tab in a reload cycle.
    // Surfacing it means the ErrorBoundary explains what happened.
    assert.equal(
      chunkFailureAction({ alreadyRetried: true }),
      CHUNK_FAILURE_ACTION.SURFACE
    );
  });

  it('treats a missing argument as a first failure', () => {
    assert.equal(chunkFailureAction(), CHUNK_FAILURE_ACTION.RELOAD);
    assert.equal(chunkFailureAction({}), CHUNK_FAILURE_ACTION.RELOAD);
  });

  it('only ever produces the two actions the caller handles', () => {
    const actions = new Set([
      chunkFailureAction({ alreadyRetried: false }),
      chunkFailureAction({ alreadyRetried: true }),
    ]);
    assert.deepEqual([...actions].sort(), ['reload', 'surface']);
  });
});
