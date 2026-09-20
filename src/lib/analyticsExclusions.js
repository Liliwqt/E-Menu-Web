/**
 * Which orders count toward the analytics roll-up.
 *
 * Exclusions are an accounting adjustment, so they are kept beside the ledger
 * rather than written onto it: the order stays exactly as the device recorded it,
 * and the adjustment carries who made it and why. See the rules for why the flag
 * lives in its own node.
 *
 * This module deliberately imports nothing. The logic is a pure transform and a
 * pure predicate, so it can be reasoned about and tested without a database
 * client, and the same copy is used by the live lists and the rebuild.
 */

/**
 * Does this order count toward the roll-up?
 *
 * The production predicate starts here, so a test of this is a test of the real
 * decision rather than a stand-in for it.
 */
export function countsTowardAnalytics(order) {
  return order?.analyticsExcluded !== true;
}

/**
 * Folds the exclusion flag for one order onto a copy of it.
 *
 * An order with no flag is returned as the identical object, so callers that
 * already hold orders do not lose reference equality for the common case.
 */
export function excludeOrder(order, exclusions = {}) {
  const flag = (exclusions || {})[order?.orderId];
  if (!flag) return order;
  return {
    ...order,
    analyticsExcluded: flag.excluded === true,
    analyticsExcludedReason: flag.reason || '',
    analyticsExcludedBy: flag.by || '',
  };
}

/**
 * Folds exclusion flags into a list of orders.
 *
 * Keyed on `orderId`, the uuid, rather than on the list key: an order is keyed by
 * its uuid while live and by its short order number once it has been moved to the
 * bin, so a flag keyed on the list key would be orphaned by the move — which is
 * exactly when someone is likely to be correcting the books.
 *
 * A flag naming an order that is not in the list is ignored. That happens
 * legitimately when an order is hard-deleted while its flag remains.
 *
 * Flags are ADDED, not reconciled. An order that already carries
 * `analyticsExcluded` keeps whatever it has, so this expects the raw orders a
 * listener produced, where the field never appears. Passing back a previously
 * merged list would let a lifted flag survive; the flag node is the source of
 * truth, and it is read from the database on every call rather than cached.
 */
export function applyExclusions(orders = [], exclusions = {}) {
  return (orders || []).map((order) => excludeOrder(order, exclusions));
}

/**
 * Folds flags onto a raw `/logs` snapshot and returns [orderId, order] pairs.
 *
 * This is the step that makes an excluded order ineligible for the incremental
 * processor, and it is deliberately a pure function here rather than three lines
 * inside the hook: the hook subscribes to Firebase, so anything written there
 * can only be checked by signing in and watching. Written here, the decision the
 * processor relies on is one a test can make.
 *
 * `orderId` is added to each order because the snapshot key is the same value
 * while an order is live, and it is what the flags are keyed by.
 */
export function foldSnapshot(logsData = {}, exclusions = {}) {
  return Object.entries(logsData || {}).map(([orderId, orderData]) => [
    orderId,
    excludeOrder({ orderId, ...orderData }, exclusions),
  ]);
}
