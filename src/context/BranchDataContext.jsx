import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAnalyticsProcessor } from '../hooks/useAnalyticsProcessor';
import { useInventoryProcessor } from '../hooks/useInventoryProcessor';
import { formatDateKey, formatWeekKey, formatMonthKey, onAnalyticsChange } from '../lib/analyticsApi';
import { onMenuAndInventoryChange } from '../lib/inventoryApi';
import { onLogsChange, onDeletedLogsChange } from '../lib/menuApi';
import { detectPatterns } from '../lib/patternInsights';
import { setBranchContext } from '../lib/firebase';
import { useAuth } from './AuthContext';

const BranchDataContext = createContext(null);

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
  const [analytics, setAnalytics] = useState(null);
  const [inventory, setInventory] = useState({});
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [deletedLogs, setDeletedLogs] = useState([]);

  // Business-logic processors (identical to V1)
  useAnalyticsProcessor(branchId, true);
  useInventoryProcessor(branchId, true);

  useEffect(() => {
    if (!branchId) return undefined;
    setAnalytics(null);
    return onAnalyticsChange(branchId, setAnalytics);
  }, [branchId, workspace?.companyId]);

  useEffect(() => {
    if (!branchId) return undefined;
    setInventoryLoaded(false);
    return onMenuAndInventoryChange(branchId, (data) => {
      setInventory(data);
      setInventoryLoaded(true);
    });
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return undefined;
    setLogsLoaded(false);
    return onLogsChange(branchId, (data) => {
      setLogs(data);
      setLogsLoaded(true);
    });
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return undefined;
    return onDeletedLogsChange(branchId, setDeletedLogs);
  }, [branchId]);

  const currentKeys = useMemo(() => {
    const now = new Date();
    return { today: formatDateKey(now), week: formatWeekKey(now), month: formatMonthKey(now) };
  }, [branchId]);

  // Deterministic operational patterns (operating hours, peak windows,
  // weekday effects, pairings, cadence, anomalies) — shown on the dashboard
  // and injected into every AI prompt so insights are grounded in evidence.
  const patterns = useMemo(
    () => detectPatterns({ analytics: analytics || {}, logs, inventory }),
    [analytics, logs, inventory]
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
    analytics,
    analyticsLoaded: analytics !== null,
    inventory,
    inventoryLoaded,
    logs,
    logsLoaded,
    deletedLogs,
    currentKeys,
    aiAnalyticsData,
    hasOrders: Number(analytics?.summary?.totalOrders || 0) > 0,
  }), [branchId, analytics, inventory, inventoryLoaded, logs, logsLoaded, deletedLogs, currentKeys, aiAnalyticsData]);

  return <BranchDataContext.Provider value={value}>{children}</BranchDataContext.Provider>;
}

export function useBranchData() {
  const ctx = useContext(BranchDataContext);
  if (!ctx) throw new Error('useBranchData must be used within BranchDataProvider');
  return ctx;
}
