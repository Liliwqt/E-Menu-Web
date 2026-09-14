import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchLabel, tidyBranchId } from './branchLabel.js';

const ID = 'branch-test1-branch1-85sr93';

const workspace = {
  branchId: ID,
  branchName: 'branch1',
  branches: {
    [ID]: { branchId: ID, name: 'branch1' },
    'branch-test1-branch2-aa11bb': { branchId: 'branch-test1-branch2-aa11bb', name: 'Branch 2' },
  },
};

test('names the branch the owner typed instead of its machine id', () => {
  assert.equal(branchLabel({ workspace, branchId: ID }), 'branch1');
});

test('names a branch that is not the one currently open', () => {
  // The id asked about is not the session's branch, so workspace.branchName is
  // the wrong answer here — the map is the only correct source.
  const label = branchLabel({ workspace, branchId: 'branch-test1-branch2-aa11bb' });
  assert.equal(label, 'Branch 2');
});

test('the open branch name is used when the map is missing', () => {
  // Workspaces created before the branches map existed still carry branchName.
  const legacy = { branchId: ID, branchName: 'Only Branch' };
  assert.equal(branchLabel({ workspace: legacy, branchId: ID }), 'Only Branch');
});

test('branchName is not reused for a different branch', () => {
  // Otherwise opening branch A and reading a link to branch B would caption B
  // with A's name, which is worse than an ugly id.
  const legacy = { branchId: ID, branchName: 'Only Branch' };
  const label = branchLabel({ workspace: legacy, branchId: 'branch-other-zz99yy' });
  assert.notEqual(label, 'Only Branch');
  assert.match(label, /Other/);
});

test('never renders the raw id when the branch is unknown', () => {
  const label = branchLabel({ workspace: {}, branchId: ID });
  assert.doesNotMatch(label, /^branch-/);
  assert.doesNotMatch(label, /85sr93/);
  assert.equal(label, 'Test1 Branch1');
});

test('the random suffix is not mistaken for part of the name', () => {
  assert.equal(tidyBranchId('branch-cafe-makati-a1b2c3'), 'Cafe Makati');
});

test('the suffix strip relies on ids always ending in one, which createBranchId guarantees', () => {
  // This is the assumption the strip rests on: createBranchId appends a 6-char
  // random segment to every id it mints, so the last segment is never part of the
  // name. An id that does NOT end in one therefore loses its final word here.
  // Such an id cannot be produced by the app — the rules would accept it, so it
  // is reachable by hand in the console — and the cost is a shortened label on a
  // branch that is already missing from the workspace. Recorded rather than
  // guarded, because guarding would mean showing "85sr93" to everyone.
  assert.equal(tidyBranchId('branch-cafe-makati'), 'Cafe');
  // Which is still better than the raw machine id it replaces.
  assert.equal(tidyBranchId('branch-cafe-makati-a1b2c3'), 'Cafe Makati');
});

test('an unhelpful id yields something readable rather than blank', () => {
  // Nothing here should produce an empty label, which would render as no branch
  // name at all.
  assert.equal(tidyBranchId('branch-'), 'branch-');
  assert.equal(tidyBranchId('branch-a1b2c3'), 'A1b2c3');
  assert.notEqual(tidyBranchId('branch-a1b2c3'), '');
});

test('handles nothing at all without throwing', () => {
  assert.equal(branchLabel(), '');
  assert.equal(branchLabel({}), '');
  assert.equal(branchLabel({ workspace, branchId: '' }), '');
  assert.equal(tidyBranchId(), '');
  assert.equal(tidyBranchId(null), '');
});

test('a label containing markup is returned unchanged, not interpreted', () => {
  // Names are user-supplied. React escapes them on render; this only asserts the
  // helper does not mangle or strip anything on the way through.
  const odd = { branches: { b1: { name: 'Café & Bar <Main>' } }, branchId: 'b1' };
  assert.equal(branchLabel({ workspace: odd, branchId: 'b1' }), 'Café & Bar <Main>');
});
