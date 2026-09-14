import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_STATUS, resolveAccessStatus } from './accessStatus.js';

describe('classifying a finished load', () => {
  it('reports a workspace as ready', () => {
    assert.equal(
      resolveAccessStatus({ workspace: { companyId: 'company-a' } }),
      ACCESS_STATUS.READY
    );
  });

  it('reports a loaded account with no workspace as none', () => {
    assert.equal(resolveAccessStatus({ workspace: null }), ACCESS_STATUS.NONE);
  });

  it('reports a failed read as an error, never as an empty account', () => {
    // The whole reason these are separate values. A failure that reports as NONE
    // is indistinguishable from a new signup, and the setup form that follows
    // creates a second company for an owner who already has one.
    assert.equal(
      resolveAccessStatus({ loadFailed: true, workspace: null }),
      ACCESS_STATUS.ERROR
    );
    assert.notEqual(
      resolveAccessStatus({ loadFailed: true }),
      ACCESS_STATUS.NONE
    );
  });

  it('prefers the failure even if a stale workspace was passed alongside it', () => {
    assert.equal(
      resolveAccessStatus({ loadFailed: true, workspace: { companyId: 'company-a' } }),
      ACCESS_STATUS.ERROR
    );
  });

  it('treats a missing argument as an empty account rather than a failure', () => {
    assert.equal(resolveAccessStatus(), ACCESS_STATUS.NONE);
  });
});
