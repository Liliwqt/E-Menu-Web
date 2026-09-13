import { useMemo, useState } from 'react';
import { History, Search, EyeOff, Eye, Info } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import { useBranchData } from '../context/BranchDataContext';
import { excludeOrderFromAnalytics, includeOrderInAnalytics } from '../lib/analyticsApi';
import { clearAnalysisCache } from '../lib/aiAnalystService';
import { formatCurrency } from '../lib/statisticsUtils';
import { getItems, orderTotal } from './OrdersPage';
import '../styles/orders.css';

const peso = (v) => formatCurrency(v);

const CORRECTION_REASONS = [
  'Duplicate order',
  'Wrong quantity',
  'Testing order',
  'Staff training order',
  'Incorrect transaction',
  'Manual analytics correction',
];

function ts(log) { return log.timestamp || log.createdAt || 0; }

/**
 * Order History — every recorded order (active + archived) with
 * include/exclude analytics corrections. Fully responsive: table on
 * desktop, cards on mobile (V1's mobile deletion bug class is gone).
 */
export default function HistoryPage() {
  const { branchId, logs, deletedLogs } = useBranchData();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reason, setReason] = useState(CORRECTION_REASONS[0]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  const allOrders = useMemo(() => ([
    ...logs.map((l) => ({ ...l, archiveStatus: 'Active' })),
    ...deletedLogs.map((l) => ({ ...l, archiveStatus: 'Archived' })),
  ].sort((a, b) => ts(b) - ts(a))), [logs, deletedLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
    return allOrders.filter((log) => {
      const t = ts(log);
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      if (!q) return true;
      return String(log.orderNum).toLowerCase().includes(q)
        || String(log.customerName || '').toLowerCase().includes(q)
        || getItems(log).some((it) => String(it.name || '').toLowerCase().includes(q));
    });
  }, [allOrders, search, dateFrom, dateTo]);

  const includedTotal = filtered.filter((l) => l.analyticsExcluded !== true).reduce((s, l) => s + orderTotal(l), 0);

  async function toggle(log) {
    setBusyId(log.orderNum);
    setMessage('');
    try {
      if (log.analyticsExcluded === true) {
        await includeOrderInAnalytics(branchId, log.orderNum);
        setMessage(`Order #${log.orderNum} restored to analytics. Totals rebuilt.`);
      } else {
        await excludeOrderFromAnalytics(branchId, log.orderNum, reason);
        setMessage(`Order #${log.orderNum} excluded (${reason}). Totals rebuilt.`);
      }
      clearAnalysisCache(branchId);
    } catch (e) {
      setMessage(`Correction failed: ${e.message || 'unknown error'}`);
    } finally {
      setBusyId('');
    }
  }

  return (
    <AppShell title="Order History">
      <section className="card card--pad rise" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="flex gap-2" style={{ alignItems: 'flex-start' }}>
          <Info size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 3 }} />
          <p className="card-sub" style={{ margin: 0 }}>
            The ledger is the audit trail behind your analytics. Excluding an order (duplicate, test, training)
            rebuilds every analytics total without deleting the record — you can restore it anytime.
          </p>
        </div>
      </section>

      <div className="ledger__filters rise-1">
        <div className="inv__search" style={{ minWidth: 220 }}>
          <span className="inv__searchIcon"><Search size={16} /></span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search orders…" aria-label="Search ledger" />
        </div>
        <div>
          <label className="field-label">From</label>
          <input type="date" className="input" style={{ width: 'auto' }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="field-label">To</label>
          <input type="date" className="input" style={{ width: 'auto' }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Exclusion reason</label>
          <select className="select" style={{ width: 'auto' }} value={reason} onChange={(e) => setReason(e.target.value)}>
            {CORRECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {message && (
        <div className="login__success rise" role="status" style={{ marginBottom: 'var(--sp-4)' }}>{message}</div>
      )}

      <div className="flex-between rise-2" style={{ marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="card-sub">{filtered.length} order{filtered.length === 1 ? '' : 's'} shown</span>
        <span className="pill pill--brand num">Counted revenue: {peso(includedTotal)}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <span className="empty__icon"><History size={24} /></span>
          <div className="empty__title">No orders in this view</div>
          <p>Adjust the search or date range.</p>
        </div>
      ) : (
        <div className="card table-wrap rise-3">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>When</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
                <th>Analytics</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log) => {
                const excluded = log.analyticsExcluded === true;
                return (
                  <tr key={`${log.archiveStatus}-${log.orderNum}`} className={excluded ? 'ledger__excluded' : ''}>
                    <td className="num" style={{ fontWeight: 700, color: 'var(--text-1)' }}>#{log.orderNum}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {ts(log) ? new Date(ts(log)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getItems(log).map((it) => `${it.quantity || 1}× ${it.name}`).join(', ') || '—'}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 650 }}>{peso(orderTotal(log))}</td>
                    <td>
                      <span className={`pill ${log.archiveStatus === 'Active' ? 'pill--success' : 'pill--neutral'}`}>{log.archiveStatus}</span>
                    </td>
                    <td>
                      {log.orderSource === 'android_kiosk' ? (
                        <span className="muted">Kiosk-managed</span>
                      ) : (
                        <button
                          className={`btn btn--sm ${excluded ? 'btn--secondary' : 'btn--ghost'}`}
                          onClick={() => toggle(log)}
                          disabled={busyId === log.orderNum}
                          title={excluded ? `Excluded: ${log.analyticsExcludedReason || 'manual correction'}` : 'Exclude from analytics'}
                        >
                          {busyId === log.orderNum ? (
                            <span className="spinner" style={{ width: 14, height: 14 }} />
                          ) : excluded ? (
                            <><Eye size={14} /> Restore</>
                          ) : (
                            <><EyeOff size={14} /> Exclude</>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
