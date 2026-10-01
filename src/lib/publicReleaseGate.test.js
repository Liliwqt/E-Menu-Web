import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function check(value) {
  const env = { ...process.env, TOUCH_LIVE_TEST_DEPLOY: value };
  delete env.NODE_TEST_CONTEXT; // Run the CLI normally, outside the parent's test protocol.
  return spawnSync(process.execPath, ['scripts/check-public-release.mjs'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8',
    env,
  });
}
test('ordinary release still rejects unapproved policies', () => {
  const result = check('');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Policies have not been approved/);
});
test('explicit live testing preserves draft status and outstanding requirements', () => {
  const result = check('1');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /public policies remain DRAFT/);
  assert.match(result.stdout, /Gmail delivery/);
  assert.equal(check('true').status, 1);
});
