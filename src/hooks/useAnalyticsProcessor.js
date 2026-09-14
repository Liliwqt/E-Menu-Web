import { useEffect, useRef } from 'react';
import { database, branchDataPath } from '../lib/firebase';
import { ref, onValue, off } from 'firebase/database';
import {
  initializeAnalytics,
  initializeProcessedOrderLedger,
  isAnalyticsOrder,
  onAnalyticsExclusionsChange,
  processOrderAnalytics,
} from '../lib/analyticsApi';
import { foldSnapshot } from '../lib/analyticsExclusions';

export function useAnalyticsProcessor(branchId, enabled = true) {
  // The latest exclusion flags. Held in a ref because the snapshot loop below is
  // async and can outlive the render that started it; reading from a closure
  // would use whatever was true when the listener was attached.
  const exclusionsRef = useRef({});

  useEffect(() => {
    if (!branchId || !enabled) return undefined;

    initializeAnalytics(branchId).catch(error => {
      console.error('Failed to initialize analytics:', error);
    });

    // Set up real-time listener for order logs. Logs are only the event source;
    // analytics writes persist separately under {branchId}/analytics.
    const logsRef = ref(database, `${branchDataPath(branchId)}/logs`);

    const stopExclusions = onAnalyticsExclusionsChange(branchId, (flags) => {
      exclusionsRef.current = flags || {};
    });

    let isProcessing = false;
    let pendingSnapshot = null;
    let ledgerInitialized = false;

    /**
     * Applies the exclusion flags to a raw `/logs` snapshot.
     *
     * This step is not optional. An exclusion is stored in its own node, so the
     * raw order carries no `analyticsExcluded` field and isAnalyticsOrder() reads
     * it as eligible. Without the fold, excluding an order removed it from the
     * totals only until the next `/logs` event: the rebuild leaves it out of
     * processedOrders too, so the incremental path below saw it as unprocessed
     * and counted it again. A new order arriving, or a page reload, was enough to
     * silently undo a correction.
     *
     * The fold itself lives in lib/analyticsExclusions.js, as a pure function,
     * precisely so it can be tested — a hook that talks to Firebase can only be
     * checked by signing in and watching.
     */
    const withExclusions = (logsData) => foldSnapshot(logsData, exclusionsRef.current);

    const handleOrdersChange = async (snapshot) => {
      pendingSnapshot = snapshot.val() || {};
      if (isProcessing) return;

      try {
        isProcessing = true;
        while (pendingSnapshot) {
          const dataToProcess = pendingSnapshot;
          pendingSnapshot = null;

          // Folded before anything decides what counts. The ledger initialiser
          // needs it as much as the loop does: it seeds processedOrders from the
          // same snapshot, so an excluded order would otherwise be marked as
          // already counted without ever having been counted.
          const orders = withExclusions(dataToProcess);

          if (!ledgerInitialized) {
            await initializeProcessedOrderLedger(branchId, Object.fromEntries(orders));
            ledgerInitialized = true;
          }

          for (const [orderId, orderData] of orders) {
            if (!isAnalyticsOrder(orderData)) continue;
            try {
              await processOrderAnalytics(branchId, orderId, orderData);
            } catch (error) {
              console.error(`Error processing analytics for order ${orderId}:`, error);
            }
          }
        }
      } catch (error) {
        console.error('Error in analytics processor:', error);
      } finally {
        isProcessing = false;
      }
    };

    onValue(logsRef, handleOrdersChange);

    return () => {
      off(logsRef, 'value', handleOrdersChange);
      stopExclusions();
    };
  }, [branchId, enabled]);
}

export default useAnalyticsProcessor;
