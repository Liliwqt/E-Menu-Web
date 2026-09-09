import { useEffect } from 'react';
import { database, branchDataPath } from '../lib/firebase';
import { ref, onValue, off } from 'firebase/database';
import {
  initializeAnalytics,
  initializeProcessedOrderLedger,
  isAnalyticsOrder,
  processOrderAnalytics,
} from '../lib/analyticsApi';

export function useAnalyticsProcessor(branchId, enabled = true) {
  useEffect(() => {
    if (!branchId || !enabled) return;

    initializeAnalytics(branchId).catch(error => {
      console.error('Failed to initialize analytics:', error);
    });

    // Set up real-time listener for order logs. Logs are only the event source;
    // analytics writes persist separately under {branchId}/analytics.
    const logsRef = ref(database, `${branchDataPath(branchId)}/logs`);

    let isProcessing = false;
    let pendingSnapshot = null;
    let ledgerInitialized = false;

    const handleOrdersChange = async (snapshot) => {
      pendingSnapshot = snapshot.val() || {};
      if (isProcessing) return;

      try {
        isProcessing = true;
        while (pendingSnapshot) {
          const dataToProcess = pendingSnapshot;
          pendingSnapshot = null;

          if (!ledgerInitialized) {
            await initializeProcessedOrderLedger(branchId, dataToProcess);
            ledgerInitialized = true;
          }

          const orders = Object.entries(dataToProcess || {});
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
    };
  }, [branchId, enabled]);
}

export default useAnalyticsProcessor;
