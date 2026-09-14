import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CAP, ROLE, can, normalizeRole, roleLabel } from './permissions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const SELF = resolve(HERE, 'permissions.js');

/**
 * Capabilities nobody ever calls can(CAP.x) for, with the reason.
 *
 * Every other capability has to be referenced somewhere in the app, because an
 * unreferenced one means a feature that is described in the matrix but gated
 * nowhere. USE_AI sat in this state: the matrix said manager-and-above, and all
 * five AI surfaces checked the plan alone. Nothing failed, nothing looked wrong,
 * and a staff account on a subscribed branch got the analyst, including the
 * background jobs that run on timers. An allowlist that has to be edited by hand
 * turns that into a decision rather than an oversight.
 *
 * Keep this list short. If an entry needs a paragraph, it probably needs a gate.
 */
const INTENTIONALLY_UNGATED = {
  [CAP.ADJUST_STOCK]: 'Granted to every role, so there is no state to hide. The rules allow any branch member to write stock.',
  [CAP.TOGGLE_AVAILABILITY]: 'Granted to every role, so there is no state to hide. The rules allow any branch member to write the menu item.',
};

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(js|jsx)$/.test(entry.name)) continue;
    // The matrix defines the capabilities; the tests describe them. Neither is a
    // place where a capability gets enforced, so neither counts as a reference.
    if (full === SELF || full.endsWith('.test.js')) continue;
    found.push(full);
  }
  return found;
}

/** Every `CAP.NAME` mentioned anywhere in the app. */
function referencedCapabilities() {
  const referenced = new Set();
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const [, name] of source.matchAll(/\bCAP\.([A-Z_]+)\b/g)) {
      referenced.add(name);
    }
  }
  return referenced;
}

describe('every capability is either enforced or explained', () => {
  it('has no capability that is gated nowhere without a stated reason', () => {
    const referenced = referencedCapabilities();
    const unexplained = Object.entries(CAP)
      .filter(([name]) => !referenced.has(name) && !INTENTIONALLY_UNGATED[CAP[name]])
      .map(([name]) => name);

    assert.deepEqual(
      unexplained,
      [],
      `These capabilities are defined but never checked, so whatever they describe is `
        + `reachable by every role. Gate them, or add them to INTENTIONALLY_UNGATED with a reason:\n`
        + unexplained.map((n) => `  ${n}`).join('\n')
    );
  });

  it('does not carry a stale exemption for a capability that no longer exists', () => {
    const capabilities = Object.values(CAP);
    for (const name of Object.keys(INTENTIONALLY_UNGATED)) {
      assert.ok(
        capabilities.includes(name),
        `INTENTIONALLY_UNGATED lists ${name}, which is not a capability`
      );
    }
  });

  it('does not exempt a capability that is actually referenced now', () => {
    // A stale exemption is how a gate gets quietly removed: someone adds the
    // check, the allowlist entry stays, and the entry then hides the next
    // removal. Referenced capabilities lose their exemption.
    const referenced = referencedCapabilities();
    const stale = Object.keys(INTENTIONALLY_UNGATED).filter((name) => referenced.has(name));
    assert.deepEqual(stale, []);
  });
});

describe('the capability matrix', () => {
  const ownerOnly = [CAP.MANAGE_BRANCHES, CAP.MANAGE_BILLING, CAP.MANAGE_MANAGERS, CAP.EMPTY_TRASH];
  const managerPlus = [
    CAP.MANAGE_MENU, CAP.MANAGE_ITEMS, CAP.DELETE_MENU_ITEM, CAP.DELETE_CATEGORY,
    CAP.RENAME_CATEGORY, CAP.EDIT_THRESHOLDS, CAP.TRASH_ORDER, CAP.CORRECT_ANALYTICS,
    CAP.MANAGE_KIOSKS, CAP.EXPORT_REPORTS, CAP.USE_AI, CAP.MANAGE_STAFF,
  ];
  const everyone = [CAP.TOGGLE_AVAILABILITY, CAP.ADJUST_STOCK, CAP.VIEW_ANALYTICS];

  it('keeps the owner-only powers out of a manager\u2019s reach', () => {
    for (const cap of ownerOnly) {
      assert.equal(can(ROLE.OWNER, cap), true, `owner should have ${cap}`);
      assert.equal(can(ROLE.MANAGER, cap), false, `manager should not have ${cap}`);
      assert.equal(can(ROLE.STAFF, cap), false, `staff should not have ${cap}`);
    }
  });

  it('gives managers everything below the owner-only tier', () => {
    // Each of these was a real gap at some point: thresholds, kiosks, billing and
    // the AI analyst were all reachable by a role that should not have had them.
    for (const cap of managerPlus) {
      assert.equal(can(ROLE.MANAGER, cap), true, `manager should have ${cap}`);
      assert.equal(can(ROLE.STAFF, cap), false, `staff should not have ${cap}`);
    }
  });

  it('leaves staff the three things a shift cannot run without', () => {
    for (const cap of everyone) {
      assert.equal(can(ROLE.STAFF, cap), true, `staff should have ${cap}`);
      assert.equal(can(ROLE.MANAGER, cap), true, `manager should have ${cap}`);
      assert.equal(can(ROLE.OWNER, cap), true, `owner should have ${cap}`);
    }
  });

  it('accounts for every capability in exactly one tier', () => {
    // Counting rather than spot-checking. A new capability added to no tier is
    // held by nobody, which is silent, and one added to two lists goes unnoticed.
    // Compared by value: CAP is keyed by name, and the tiers are built from its
    // values.
    const tiers = [ownerOnly, managerPlus, everyone].flat();
    assert.equal(new Set(tiers).size, tiers.length, 'a capability appears in two tiers');
    assert.deepEqual(
      Object.values(CAP).sort(),
      tiers.sort(),
      'the tiers and the capability list have drifted apart'
    );
  });

  it('grants nothing to a role it does not recognise', () => {
    // Fail-closed. A malformed roster row must not widen access. Note that
    // 'Owner' is deliberately absent from this list: normalising case is the
    // intended behaviour, so only genuinely unknown values belong here.
    for (const unknown of [null, undefined, '', 'admin', 'superuser', 'ownerr', 42, {}]) {
      for (const cap of Object.values(CAP)) {
        assert.equal(can(unknown, cap), false, `unexpected access for ${JSON.stringify(unknown)}`);
      }
    }
    assert.equal(normalizeRole('owner'), ROLE.OWNER);
    // Case and padding are normalised rather than treated as different roles, so
    // a hand-edited record does not silently fail closed on a typo.
    assert.equal(normalizeRole('MANAGER'), ROLE.MANAGER);
    assert.equal(normalizeRole('  Staff '), ROLE.STAFF);
    assert.equal(roleLabel('nonsense'), 'Unassigned');
    assert.equal(roleLabel('OWNER'), 'Business Owner');
  });
});
