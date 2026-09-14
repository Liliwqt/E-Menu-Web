import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managerHandoverNote, removalNote } from './teamNotices.js';

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
