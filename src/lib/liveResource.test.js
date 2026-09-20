import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchResource } from './liveResource.js';

test('delayed data stays loading, failed reads clear data and ignore late callbacks', () => {
  let success, failure, stopped = 0;
  const states = [];
  const stop = watchResource((branch, ok, fail) => {
    assert.equal(branch, 'branch-a'); success = ok; failure = fail;
    return () => stopped++;
  }, 'branch-a', [], state => states.push(state));
  assert.equal(states.at(-1).status, 'loading');
  success(['order']);
  assert.equal(states.at(-1).status, 'ready');
  failure(new Error('Permission denied'));
  assert.equal(states.at(-1).status, 'error');
  assert.deepEqual(states.at(-1).data, []);
  success(['stale order']);
  assert.equal(states.length, 3);
  stop();
  assert.equal(stopped, 1);
});
test('retired account/branch listeners cannot publish into the next scope', () => {
  let oldCallback;
  const states = [];
  const stop = watchResource((_, ok) => { oldCallback = ok; return () => {}; }, 'a', {}, state => states.push(state));
  stop();
  oldCallback({ secret: true });
  assert.equal(states.length, 1);
  watchResource((_, ok) => { ok({ fresh: true }); }, 'b', {}, state => states.push(state));
  assert.deepEqual(states.at(-1).data, { fresh: true });
});
test('synchronous listener setup failures are retryable errors, not empty data', () => {
  let last;
  watchResource(() => { throw new Error('setup'); }, 'a', [], state => { last = state; });
  assert.equal(last.status, 'error');
  assert.equal(last.error.message, 'setup');
});
