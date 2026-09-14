import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_ACCESS_DENIED, aiAccessDenial, canUseAi } from './aiAccess.js';
import { CAP, ROLE, can } from './permissions.js';

/** Wires the real capability matrix into the AI decision, as the hook does. */
function aiFor(role, { planIncludesAi = true } = {}) {
  return canUseAi({
    can: (capability) => can(role, capability),
    workspace: {},
    isAiEnabled: () => planIncludesAi,
  });
}

describe('the AI analyst needs both the plan and the role', () => {
  it('lets a manager on a subscribed branch use it', () => {
    assert.equal(aiFor(ROLE.MANAGER), true);
    assert.equal(aiFor(ROLE.OWNER), true);
  });

  it('refuses staff on a subscribed branch', () => {
    // The regression. isAiEnabled() alone reported true here, so a staff session
    // reached the assistant — including the background jobs that run on timers
    // and bill the model without anyone pressing a button.
    assert.equal(can(ROLE.STAFF, CAP.USE_AI), false, 'the matrix should say staff have no AI');
    assert.equal(aiFor(ROLE.STAFF), false);
  });

  it('still refuses a manager when the plan has no AI', () => {
    assert.equal(aiFor(ROLE.MANAGER, { planIncludesAi: false }), false);
    assert.equal(aiFor(ROLE.OWNER, { planIncludesAi: false }), false);
  });

  it('refuses an unrecognised role even on a subscribed branch', () => {
    for (const unknown of [null, undefined, '', 'admin', 42]) {
      assert.equal(aiFor(unknown), false, `unexpected AI access for ${JSON.stringify(unknown)}`);
    }
  });
});

describe('why access was refused', () => {
  it('separates a plan problem from a role problem', () => {
    // Distinguishable so a message can say which one to fix: upgrading the plan
    // will not help a staff member, and freeing up a role will not help a branch
    // that has not subscribed.
    assert.equal(
      aiAccessDenial({ roleAllowsAi: true, planIncludesAi: false }),
      AI_ACCESS_DENIED.PLAN
    );
    assert.equal(
      aiAccessDenial({ roleAllowsAi: false, planIncludesAi: true }),
      AI_ACCESS_DENIED.ROLE
    );
    assert.equal(aiAccessDenial({ roleAllowsAi: true, planIncludesAi: true }), null);
  });

  it('reports the plan first when neither is satisfied', () => {
    assert.equal(
      aiAccessDenial({ roleAllowsAi: false, planIncludesAi: false }),
      AI_ACCESS_DENIED.PLAN
    );
  });
});
