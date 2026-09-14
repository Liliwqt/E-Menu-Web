import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyExclusions, countsTowardAnalytics, excludeOrder, foldSnapshot } from './analyticsExclusions.js';

const order = (orderId, over = {}) => ({
  orderId,
  orderNum: orderId.slice(0, 8),
  items: [{ name: "Coffee", quantity: 1, price: 100, subtotal: 100 }],
  total: 100,
  orderSource: "android_kiosk",
  ...over,
});

const flag = (over = {}) => ({ excluded: true, reason: "Duplicate order", by: "uid-1", ...over });

describe("folding exclusion flags onto orders", () => {
  it("leaves an order with no flag exactly as it was", () => {
    const original = order("order-1");
    const [result] = applyExclusions([original], {});
    assert.equal(result, original, "an unflagged order should pass through untouched");
    assert.equal(countsTowardAnalytics(result), true);
  });

  it("marks a flagged order as excluded so the roll-up skips it", () => {
    const [result] = applyExclusions([order("order-1")], { "order-1": flag() });
    assert.equal(result.analyticsExcluded, true);
    assert.equal(result.analyticsExcludedReason, "Duplicate order");
    assert.equal(result.analyticsExcludedBy, "uid-1");
    assert.equal(countsTowardAnalytics(result), false, "the rebuild must leave it out");
  });

  it("restores an order once its flag is lifted", () => {
    // Lifting is a delete of the flag, and the merge is applied to the raw order
    // the listener produced — which never carries the field itself, because the
    // flag is kept in its own node rather than on the order.
    const raw = order("order-1");
    const flagged = applyExclusions([raw], { "order-1": flag() });
    assert.equal(countsTowardAnalytics(flagged[0]), false, "flagged orders are left out");

    const restored = applyExclusions([raw], {});
    assert.equal(restored[0].analyticsExcluded, undefined);
    assert.equal(countsTowardAnalytics(restored[0]), true, "lifting the flag puts it back");
  });

  it("does not treat a false flag as an exclusion", () => {
    const [result] = applyExclusions([order("order-1")], { "order-1": flag({ excluded: false }) });
    assert.equal(result.analyticsExcluded, false);
    assert.equal(countsTowardAnalytics(result), true);
  });

  it("does not reconsider a flag it is not given", () => {
    // Stated as a test because it is a real trap: the merge adds flags, it does
    // not reconcile them. Production passes the raw listener output, so this only
    // bites a caller that feeds back a previously merged list.
    const alreadyMerged = applyExclusions([order("order-1")], { "order-1": flag() });
    const again = applyExclusions(alreadyMerged, {});
    assert.equal(again[0].analyticsExcluded, true, "an added flag is not removed by a later empty merge");
  });

  it("keys on orderId rather than the list key", () => {
    // The regression this shape exists for: an order is keyed by its uuid while
    // live and by its short order number once trashed, so a flag keyed on the
    // list key would be lost the moment an order moved to the bin.
    const inTrash = [order("order-1", { orderNum: "AB12CD34" })];
    const [result] = applyExclusions(inTrash, { "order-1": flag() });
    assert.equal(result.analyticsExcluded, true, "the flag should follow the order, not the key");
  });

  it("ignores a flag for an order that is no longer in the list", () => {
    const orders = [order("order-1")];
    const result = applyExclusions(orders, { "order-gone": flag() });
    assert.equal(result.length, 1);
    assert.equal(result[0].analyticsExcluded, undefined);
  });

  it("survives the empty and missing shapes the listeners produce", () => {
    assert.deepEqual(applyExclusions([], {}), []);
    assert.deepEqual(applyExclusions(), []);
    assert.deepEqual(applyExclusions(null, null), []);
    assert.equal(excludeOrder(order("order-1"), null).analyticsExcluded, undefined);
  });

  it("counts an order whose exclusion flag is absent, not merely falsy", () => {
    assert.equal(countsTowardAnalytics({ orderId: "x" }), true);
    assert.equal(countsTowardAnalytics(null), true, "a missing order is not an excluded one");
    assert.equal(countsTowardAnalytics(undefined), true);
  });
});

describe("what the merge does not do", () => {
  it("does not touch the order's own figures", () => {
    // The flag is an accounting adjustment kept beside the ledger. The order has
    // to come out of this identical, or the "you can restore it anyway" promise
    // stops being true.
    const original = order("order-1");
    const [result] = applyExclusions([original], { "order-1": flag() });
    assert.equal(result.total, original.total);
    assert.deepEqual(result.items, original.items);
    assert.equal(result.orderSource, original.orderSource);
    assert.equal(result.orderId, original.orderId);
  });

  it("does not mutate the input", () => {
    const orders = [order("order-1")];
    applyExclusions(orders, { "order-1": flag() });
    assert.equal(orders[0].analyticsExcluded, undefined, "the caller's array was modified");
  });
});

describe("every incremental path folds before deciding eligibility", () => {
  // The regression these exist for. Excluding an order used to be undone by the
  // next thing that touched /logs. The rebuild left the order out of
  // processedOrders, the incremental processor then saw it as unprocessed and
  // counted it again, and because the flag is not on the order, nothing in that
  // path could tell it had been excluded. A single new order, or a page reload,
  // was enough — a correction that appeared to work and then quietly reverted.
  //
  // These test foldSnapshot() rather than the pure merge, because foldSnapshot is
  // what the processor actually calls. A test of the merge alone would have
  // passed while the processor never used it.

  it("cannot tell an excluded order from an eligible one until the flags are folded in", () => {
    const raw = order("order-1");
    const flags = { "order-1": flag() };

    // Stated as an assertion because it is the whole reason the fold has to
    // happen first: on its own the order looks perfectly eligible.
    assert.equal(countsTowardAnalytics(raw), true, "a raw order carries no sign of its flag");

    // And once folded, it does not count.
    assert.equal(countsTowardAnalytics(excludeOrder(raw, flags)), false);
  });

  it("marks the excluded order in the snapshot the processor reads", () => {
    const snapshot = { "order-1": order("order-1"), "order-2": order("order-2") };
    const folded = Object.fromEntries(foldSnapshot(snapshot, { "order-1": flag() }));

    assert.equal(countsTowardAnalytics(folded["order-1"]), false);
    assert.equal(countsTowardAnalytics(folded["order-2"]), true, "the others still count");
  });

  it("would count everything if the snapshot were passed through raw", () => {
    // The failing shape is asserted here on purpose, so the fix cannot be undone
    // by someone deciding the fold is redundant. Passing the raw snapshot is what
    // the processor did, and it counted an excluded order every time.
    const snapshot = { "order-1": order("order-1") };
    const raw = Object.fromEntries(Object.entries(snapshot).map(([orderId, o]) => [orderId, o]));

    assert.equal(countsTowardAnalytics(raw["order-1"]), true);
    assert.notDeepEqual(
      raw["order-1"],
      Object.fromEntries(foldSnapshot(snapshot, { "order-1": flag() }))["order-1"],
      "folding must change the order the processor sees"
    );
  });

  it("carries orderId onto the folded order so the flags can be keyed", () => {
    // The snapshot key alone is not enough: it is the uuid while an order is live
    // and the order number once trashed, and the flags are keyed by the uuid.
    const folded = Object.fromEntries(foldSnapshot({ "key-1": order("the-uuid") }, { "the-uuid": flag() }));
    assert.equal(folded["key-1"].orderId, "the-uuid");
    assert.equal(countsTowardAnalytics(folded["key-1"]), false);
  });

  it("stays excluded across repeated folds of the same raw snapshot", () => {
    // The processor re-reads the whole snapshot on every /logs event, so the same
    // raw order is decided again and again. It has to come out excluded every
    // time, not just the first.
    const snapshot = { "order-1": order("order-1") };
    const flags = { "order-1": flag() };
    for (let pass = 0; pass < 3; pass += 1) {
      const folded = Object.fromEntries(foldSnapshot(snapshot, flags));
      assert.equal(
        countsTowardAnalytics(folded["order-1"]),
        false,
        `pass ${pass + 1} counted an excluded order`
      );
    }
  });

  it("counts the rest of the snapshot normally alongside an exclusion", () => {
    const snapshot = {
      "order-1": order("order-1"),
      "order-2": order("order-2"),
      "order-3": order("order-3"),
    };
    const folded = foldSnapshot(snapshot, { "order-2": flag() });
    assert.deepEqual(folded.map(([, o]) => countsTowardAnalytics(o)), [true, false, true]);
  });

  it("goes back to counting once the flag is lifted", () => {
    const snapshot = { "order-1": order("order-1") };
    assert.equal(countsTowardAnalytics(Object.fromEntries(foldSnapshot(snapshot, { "order-1": flag() }))["order-1"]), false);
    assert.equal(countsTowardAnalytics(Object.fromEntries(foldSnapshot(snapshot, {}))["order-1"]), true);
  });

  it("handles the empty snapshot the listener produces on a branch with no orders", () => {
    assert.deepEqual(foldSnapshot({}, { "order-1": flag() }), []);
    assert.deepEqual(foldSnapshot(), []);
    assert.deepEqual(foldSnapshot(null, null), []);
  });
});

describe("the processor is wired to fold, and would fail loudly if it stopped", () => {
  // A hedge, and labelled as one. The tests above prove the fold is correct; they
  // cannot prove the processor calls it, because they hand it snapshots directly.
  // Confirmed by putting the pass-through back into the hook: every test above
  // still passed, which is exactly the regression that shipped.
  //
  // Testing the hook for real needs a React renderer and a Firebase double, which
  // this project has neither of. So the wiring is pinned by reading the source,
  // as with the rules mirror. It is a heuristic — it cannot tell whether the
  // folded value is passed on, only that the fold is present — but it fails
  // loudly on the specific mistake, which is replacing the call with the raw
  // snapshot, and that mistake is invisible at runtime.
  const hookPath = resolve(dirname(fileURLToPath(import.meta.url)), '../hooks/useAnalyticsProcessor.js');
  const source = readFileSync(hookPath, 'utf8');

  it("folds the snapshot rather than passing the raw listener data to the processor", () => {
    assert.match(
      source,
      /foldSnapshot\(/,
      "useAnalyticsProcessor must fold exclusion flags before deciding eligibility, "
        + "or excluding an order is silently undone by the next /logs event"
    );
  });

  it("does not iterate the raw snapshot directly", () => {
    // The failing shape, named so it cannot come back: this is what the processor
    // did, and it counted excluded orders every time.
    assert.doesNotMatch(
      source,
      /Object\.entries\(dataToProcess/,
      "the processor is iterating the raw snapshot, which carries no exclusion flags"
    );
  });

  it("keeps the exclusions subscription that feeds the fold", () => {
    assert.match(source, /onAnalyticsExclusionsChange\(/, "the fold has no flags without this");
  });
});
