import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE } from './permissions.js';
import {
  managerHandoverNote,
  removalNote,
  removalLeavesBranchUnmanaged,
  unmanagedBranchWarning,
} from './teamNotices.js';

const member = (uid, role) => ({ uid, role });

test('says nothing when no manager was replaced', () => {
  assert.equal(managerHandoverNote({}), '');
  assert.equal(managerHandoverNote(), '');
  assert.equal(managerHandoverNote({ replacedManagerUid: null, replacedDemoted: false }), '');
});

test('names the demotion when the handover completed', () => {
  const note = managerHandoverNote({ replacedManagerUid: 'uid-old', replacedDemoted: true });
  assert.match(note, /previous manager is now staff/);
  assert.doesNotMatch(note, /still holds/);
});

test('never claims the old manager lost access when the handover failed', () => {
  // The failure case is the one worth being loud about: the owner is otherwise
  // told someone was replaced while that person keeps their manager access.
  const note = managerHandoverNote({ replacedManagerUid: 'uid-old', replacedDemoted: false });
  assert.match(note, /still holds the manager role/);
  assert.doesNotMatch(note, /is now staff/);
  assert.match(note, /remove them/);
});

test('a completed handover is not reported as a failure, and vice versa', () => {
  const done = managerHandoverNote({ replacedManagerUid: 'a', replacedDemoted: true });
  const failed = managerHandoverNote({ replacedManagerUid: 'a', replacedDemoted: false });
  assert.notEqual(done, failed);
});

test('says nothing when the account record was cleared', () => {
  assert.equal(removalNote({ accountRemoved: true }), '');
  assert.equal(removalNote({}), '');
  assert.equal(removalNote(), '');
});

test('a leftover sign-in record is described as access already gone, not access kept', () => {
  // Access is revoked by the membership records either way, so this must not read
  // as a security failure — it is a tidiness problem with a visible symptom.
  const note = removalNote({ accountRemoved: false });
  assert.match(note, /sign-in record could not be cleared/);
  assert.doesNotMatch(note, /still has access|access to this branch/i);
});

test('warns only when the branch is about to lose its last manager', () => {
  const only = { member: member('m1', ROLE.MANAGER), members: [member('m1', ROLE.MANAGER), member('s1', ROLE.STAFF)] };
  assert.equal(removalLeavesBranchUnmanaged(only), true);

  const oneOfTwo = {
    member: member('m1', ROLE.MANAGER),
    members: [member('m1', ROLE.MANAGER), member('m2', ROLE.MANAGER)],
  };
  assert.equal(removalLeavesBranchUnmanaged(oneOfTwo), false);
});

test('removing staff or the owner never triggers the warning', () => {
  const staff = { member: member('s1', ROLE.STAFF), members: [member('o1', ROLE.OWNER), member('s1', ROLE.STAFF)] };
  assert.equal(removalLeavesBranchUnmanaged(staff), false);

  const owner = { member: member('o1', ROLE.OWNER), members: [member('o1', ROLE.OWNER)] };
  assert.equal(removalLeavesBranchUnmanaged(owner), false);
});

test('a manager is recognised through the same normalisation the rest of the app uses', () => {
  // The role is hand-edited in the console sometimes and picks up stray case or
  // space; treating that as "not the manager" would drop the warning silently.
  const messy = {
    member: { uid: 'm1', role: ' Manager ' },
    members: [{ uid: 'm1', role: 'Manager' }, { uid: 's1', role: ROLE.STAFF }],
  };
  assert.equal(removalLeavesBranchUnmanaged(messy), true);
});

test('the warning says who covers the branch instead of implying it is stuck', () => {
  const warning = unmanagedBranchWarning({ branchName: 'branch1' });
  assert.match(warning, /branch1/);
  assert.match(warning, /only manager/);
  assert.match(warning, /falls back to you/);
  assert.doesNotMatch(warning, /cannot|unable|blocked/i);
});

test('no warning is rendered from an empty or partial state', () => {
  assert.equal(removalLeavesBranchUnmanaged({}), false);
  assert.equal(removalLeavesBranchUnmanaged(), false);
  assert.equal(removalLeavesBranchUnmanaged({ member: member('m1', ROLE.MANAGER) }), true);
});
