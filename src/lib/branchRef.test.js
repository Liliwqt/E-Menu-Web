import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchRefFor, resolveBranchRef, slugifyBranchName, withBranchRef } from './branchRef.js';

const ID = 'branch-test1-branch1-85sr93';
const ID2 = 'branch-test1-branch2-aa11bb';

const workspace = {
  branchId: ID,
  branchName: 'branch1',
  branches: {
    [ID]: { branchId: ID, name: 'branch1' },
    [ID2]: { branchId: ID2, name: 'Branch 2' },
  },
};

test('names a branch in the url instead of showing its id', () => {
  assert.equal(branchRefFor(workspace, ID), 'branch1');
  assert.equal(branchRefFor(workspace, ID2), 'branch-2');
});

test('the url form resolves back to the branch id', () => {
  assert.equal(resolveBranchRef(workspace, 'branch1'), ID);
  assert.equal(resolveBranchRef(workspace, 'branch-2'), ID2);
});

test('the id form still resolves, so older links keep working', () => {
  assert.equal(resolveBranchRef(workspace, ID), ID);
  assert.equal(resolveBranchRef(workspace, ID2), ID2);
});

test('a written url always reads back as the same branch', () => {
  // This is the property that matters: if it failed, the app would redirect to a
  // url it then refused to open, which loops rather than errors.
  for (const id of [ID, ID2]) {
    assert.equal(resolveBranchRef(workspace, branchRefFor(workspace, id)), id);
  }
});

test('an id wins over a name that looks like one', () => {
  const shadow = {
    branches: {
      'branch-main': { branchId: 'branch-main', name: 'Something Else' },
      'branch-x': { branchId: 'branch-x', name: 'branch-main' },
    },
  };
  // 'branch-main' is a real id, so it resolves to itself rather than to the
  // branch that happens to be called 'branch-main'.
  assert.equal(resolveBranchRef(shadow, 'branch-main'), 'branch-main');
});

test('a name that would shadow another id is not used for the url', () => {
  const shadow = {
    branches: {
      'branch-main': { branchId: 'branch-main', name: 'Something Else' },
      'branch-x': { branchId: 'branch-x', name: 'branch-main' },
    },
  };
  assert.equal(branchRefFor(shadow, 'branch-x'), 'branch-x');
});

test('two branches with the same name fall back to ids', () => {
  // Otherwise the link would open whichever came first in the object, and could
  // show the wrong branch's data under the right branch's name.
  const twins = {
    branches: {
      'branch-a': { branchId: 'branch-a', name: 'Main' },
      'branch-b': { branchId: 'branch-b', name: 'Main' },
    },
  };
  assert.equal(branchRefFor(twins, 'branch-a'), 'branch-a');
  assert.equal(branchRefFor(twins, 'branch-b'), 'branch-b');
  assert.equal(resolveBranchRef(twins, 'main'), null);
  // …and each still resolves by id, so those links work.
  assert.equal(resolveBranchRef(twins, 'branch-a'), 'branch-a');
});

test('a workspace without the branches map still round-trips', () => {
  // Workspaces created before the map existed carry one branch and its name.
  const legacy = { branchId: ID, branchName: 'Only Branch' };
  assert.equal(branchRefFor(legacy, ID), 'only-branch');
  assert.equal(resolveBranchRef(legacy, 'only-branch'), ID);
  assert.equal(resolveBranchRef(legacy, ID), ID);
});

test('an unknown branch yields nothing rather than a guess', () => {
  assert.equal(resolveBranchRef(workspace, 'branch-does-not-exist'), null);
  assert.equal(resolveBranchRef(workspace, 'renamed'), null);
  assert.equal(branchRefFor(workspace, 'branch-unknown'), 'branch-unknown');
});

test('a nameless branch keeps its id as the address', () => {
  const nameless = { branches: { 'branch-a': { branchId: 'branch-a', name: '' } } };
  assert.equal(branchRefFor(nameless, 'branch-a'), 'branch-a');
  assert.equal(resolveBranchRef(nameless, 'branch-a'), 'branch-a');
});

test('names with punctuation and accents reduce to a usable segment', () => {
  assert.equal(slugifyBranchName('Café & Bar <Main>'), 'caf-bar-main');
  assert.equal(slugifyBranchName('  Nivel Hills  '), 'nivel-hills');
  assert.equal(slugifyBranchName(''), '');
  assert.equal(slugifyBranchName(null), '');

  const odd = { branches: { 'branch-a': { branchId: 'branch-a', name: 'Nivel Hills' } } };
  assert.equal(branchRefFor(odd, 'branch-a'), 'nivel-hills');
  assert.equal(resolveBranchRef(odd, 'nivel-hills'), 'branch-a');
});

test('empty input is handled without throwing', () => {
  assert.equal(branchRefFor(workspace, ''), '');
  assert.equal(branchRefFor(workspace), '');
  assert.equal(resolveBranchRef(workspace, ''), null);
  assert.equal(resolveBranchRef(workspace, '   '), null);
  assert.equal(resolveBranchRef({}, ID), null);
  assert.equal(resolveBranchRef(), null);
});

test('the last path segment is the one replaced', () => {
  assert.equal(withBranchRef('/home/' + ID, 'branch1'), '/home/branch1');
  assert.equal(withBranchRef('/analytics-history/' + ID, 'branch1'), '/analytics-history/branch1');
  assert.equal(withBranchRef('/home/' + ID + '/', 'branch1'), '/home/branch1');
});

test('a path with nothing to replace is left alone', () => {
  assert.equal(withBranchRef('', 'branch1'), '');
  assert.equal(withBranchRef('/home/' + ID, ''), '/home/' + ID);
  assert.equal(withBranchRef('/'), '/');
});
