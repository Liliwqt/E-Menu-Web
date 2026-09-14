import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyExclusions, countsTowardAnalytics, excludeOrder } from './analyticsExclusions.js';

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
