import { createContext, useContext, useMemo } from 'react';
import { useAnalyticsProcessor } from '../hooks/useAnalyticsProcessor';
import { useInventoryProcessor } from '../hooks/useInventoryProcessor';
import { formatDateKey, formatWeekKey, formatMonthKey, onAnalyticsChange, onAnalyticsExclusionsChange, applyExclusions } from '../lib/analyticsApi';
import { onMenuAndInventoryChange } from '../lib/inventoryApi';
import { onLogsChange, onDeletedLogsChange } from '../lib/menuApi';
import { detectPatterns } from '../lib/patternInsights';
import { setBranchContext } from '../lib/firebase';
import { useLiveResource } from '../hooks/useLiveResource';
import { useAuth } from './AuthContext';

const BranchDataContext = createContext(null);
const EMPTY_OBJECT = {};
const EMPTY_LIST = [];

/**
 * Single source of truth for a branch's live data.
 *
 * V1 opened duplicate Firebase listeners in the layout AND every page.
 * V2 subscribes once here and shares the streams app-wide, halving
 * Firestore/RTDB reads and re-renders. The same background processors
 * (analytics ledger + inventory consumption) run exactly as in V1, so the
 * database behavior is a drop-in match.
 */
export function BranchDataProvider({ branchId, children }) {
  const { workspace } = useAuth();
  if (branchId && workspace?.companyId) setBranchContext(branchId, workspace.companyId);
  const analyticsResource = useLiveResource(onAnalyticsChange, branchId, null);
  const inventoryResource = useLiveResource(onMenuAndInventoryChange, branchId, EMPTY_OBJECT);
  const logsResource = useLiveResource(onLogsChange, branchId, EMPTY_LIST);
  const trashResource = useLiveResource(onDeletedLogsChange, branchId, EMPTY_LIST);
  const exclusionsResource = useLiveResource(onAnalyticsExclusionsChange, branchId, EMPTY_OBJECT);
  const analytics = analyticsResource.data;
  const inventory = inventoryResource.data;
  const logs = logsResource.data;
  const deletedLogs = trashResource.data;
  const exclusions = exclusionsResource.data;
  const inventoryLoaded = inventoryResource.status === 'ready';
  const logsLoaded = logsResource.status === 'ready';

  useAnalyticsProcessor(branchId, true);
  useInventoryProcessor(branchId, true);

  const logsWithExclusions = useMemo(() => applyExclusions(logs, exclusions), [logs, exclusions]);
  const deletedLogsWithExclusions = useMemo(
    () => applyExclusions(deletedLogs, exclusions),
    [deletedLogs, exclusions]
  );

  const currentKeys = useMemo(() => {
    const now = new Date();
    return { today: formatDateKey(now), week: formatWeekKey(now), month: formatMonthKey(now) };
  }, [branchId]);

  // Deterministic operational patterns (operating hours, peak windows,
  // weekday effects, pairings, cadence, anomalies) — shown on the dashboard
  // and injected into every AI prompt so insights are grounded in evidence.
  const patterns = useMemo(
    () => detectPatterns({ analytics: analytics || {}, logs: logsWithExclusions, inventory }),
    [analytics, logsWithExclusions, inventory]
  );

  // Shape consumed by every AI mode — V1's aiAnalyticsData plus detected patterns.
  const aiAnalyticsData = useMemo(() => {
    const daily = analytics?.daily || {};
    const weekly = analytics?.weekly || {};
    const monthly = analytics?.monthly || {};
    return {
      detectedPatterns: patterns,
      summary: analytics?.summary || {},
      products: analytics?.products || {},
      inventory,
      daily,
      hourly: analytics?.hourly || {},
      weekly,
      monthly,
      statistics: analytics?.statistics || {},
      todayAnalytics: daily?.[currentKeys.today] || { orders: 0, revenue: 0, averageOrderValue: 0 },
      weekAnalytics: weekly?.[currentKeys.week] || { orders: 0, revenue: 0 },
      monthAnalytics: monthly?.[currentKeys.month] || { orders: 0, revenue: 0 },
    };
  }, [analytics, inventory, currentKeys]);

  const value = useMemo(() => ({
    branchId,
    analyticsResource, inventoryResource, logsResource, trashResource, exclusionsResource,
    analytics,
    analyticsLoaded: analytics !== null,
    inventory,
    inventoryLoaded,
    logs: logsWithExclusions,
    logsLoaded,
    deletedLogs: deletedLogsWithExclusions,
    currentKeys,
    aiAnalyticsData,
    hasOrders: Number(analytics?.summary?.totalOrders || 0) > 0,
  }), [analyticsResource, inventoryResource, logsResource, trashResource, exclusionsResource, branchId, analytics, inventory, inventoryLoaded, logsWithExclusions, logsLoaded, deletedLogsWithExclusions, currentKeys, aiAnalyticsData]);

  return <BranchDataContext.Provider value={value}>{children}</BranchDataContext.Provider>;
}

export function useBranchData() {
  const ctx = useContext(BranchDataContext);
  if (!ctx) throw new Error('useBranchData must be used within BranchDataProvider');
  return ctx;
}
