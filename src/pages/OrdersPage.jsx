import { useMemo, useRef, useState } from 'react';
import { ReceiptText, Trash2, Search, RotateCcw, Clock3 } from 'lucide-react';
import ReadState from '../components/ui/ReadState';
import { orderInDateRange } from '../lib/orderFilters';
import Modal from '../components/ui/Modal';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import { deleteLogToBin, clearDeletedLogs } from '../lib/menuApi';
import { CAP } from '../lib/permissions';
import { formatCurrency } from '../lib/statisticsUtils';
import '../styles/orders.css';

const peso = (v) => formatCurrency(v);

export function getItems(log) {
  if (!log?.items) return [];
  return Array.isArray(log.items) ? log.items : Object.values(log.items);
}

export function orderTotal(log) {
  if (log.total !== undefined && log.total !== null) return Number(log.total) || 0;
  return getItems(log).reduce((s, it) => s + Number(it.subtotal || (Number(it.price || 0) * Number(it.quantity || 1)) || 0), 0);
}

function formatWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function orderStatus(log) {
  return String(log.status || log.paymentStatus || log.paymentMethod || 'Completed');
}

function statusPillClass(status) {
  const s = status.toLowerCase();
  if (['cancelled', 'canceled', 'void', 'voided', 'refunded', 'deleted'].some((k) => s.includes(k))) return 'pill--danger';
  if (['pending', 'preparing', 'processing', 'unpaid', 'queue'].some((k) => s.includes(k))) return 'pill--warning';
  return 'pill--success';
}

function OrderDetail({ log, onClose, onDelete, canTrash, working, error }) {
  const items = getItems(log);
  return (
    <Modal
      open
      onClose={() => { if (!working) onClose(); }}
      title={`Order #${log.orderNum}`}
      subtitle={formatWhen(log.timestamp || log.createdAt)}
      footer={
        <>
          {canTrash && log.orderSource !== 'android_kiosk' && (
            <button className="btn btn--danger" disabled={working} onClick={() => onDelete(log)}>
              <Trash2 size={15} /> {working ? 'Moving…' : 'Move to trash'}
            </button>
          )}
          <button className="btn btn--secondary" onClick={onClose} disabled={working}>Close</button>
        </>
      }
    >
      {error && <p role="alert" className="workflow-error">{error}</p>}
      {canTrash && <p className="card-sub">Moving an order to trash does not exclude it from analytics. Use Order History for analytics corrections.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {log.customerName && (
          <div className="flex-between" style={{ fontSize: 'var(--text-sm)' }}>
            <span className="muted">Customer</span>
            <span style={{ fontWeight: 650 }}>{log.customerName}</span>
          </div>
        )}
        {(log.paymentMethod || log.paymentStatus || log.status) && (
          <div className="flex-between" style={{ fontSize: 'var(--text-sm)' }}>
            <span className="muted">Status</span>
            <span className="pill pill--neutral">{log.paymentStatus || log.paymentMethod || log.status}</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)', display: 'grid', gap: 8 }}>
          {items.map((it, i) => (
            <div className="flex-between" key={i} style={{ fontSize: 'var(--text-base)' }}>
              <span style={{ color: 'var(--text-2)' }}>
                <span className="num" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{it.quantity || 1}×</span>{' '}
                {it.name}{it.size && it.size !== 'Medium' ? ` (${it.size})` : ''}
              </span>
              <span className="num" style={{ fontWeight: 650 }}>{peso(it.subtotal || (Number(it.price || 0) * Number(it.quantity || 1)))}</span>
            </div>
          ))}
        </div>
        <div className="flex-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
          <span style={{ fontWeight: 700 }}>Total</span>
          <span className="num" style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>{peso(orderTotal(log))}</span>
        </div>
      </div>
    </Modal>
  );
}

export default function OrdersPage() {
  const { branchId, logs, logsLoaded, deletedLogs, logsResource, trashResource } = useBranchData();
  const { can } = useAuth();
  // Trashing is reversible (the order moves to the bin), so managers may do it.
  // Emptying the bin destroys the records outright, which stays with the owner.
  const canTrash = can(CAP.TRASH_ORDER);
  const canEmptyTrash = can(CAP.EMPTY_TRASH);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState(false);
  const writeLock = useRef(false);
  const clearFilters = () => { setSearch(''); setFrom(''); setTo(''); };
  const [selected, setSelected] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return logs.filter((log) => orderInDateRange(log, from, to) && (!q || (
      String(log.orderNum).toLowerCase().includes(q)
      || String(log.customerName || '').toLowerCase().includes(q)
      || getItems(log).some((it) => String(it.name || '').toLowerCase().includes(q))
    )));
  }, [logs, search, from, to]);

  async function handleDelete(log) {
    if (!canTrash || writeLock.current || log.orderSource === 'android_kiosk') return;
    writeLock.current = true;
    setMoving(true);
    setError('');
    setNotice('');

    try {
      const { orderNum, ...data } = log;
      await deleteLogToBin(branchId, orderNum, data);
      setSelected(null);
      setNotice('Order copied to trash. It remains in the sales ledger and analytics.');
    } catch (e) {
      setError(e.message || 'Could not move order to trash. Try again.');
    } finally { writeLock.current = false; setMoving(false); }
  }

  async function handleClearTrash() {
    if (!canEmptyTrash || writeLock.current) return;
    writeLock.current = true;
    setError('');
    setClearing(true);
    try {
      await clearDeletedLogs(branchId);
      setNotice('Trash cleared. Sales records and analytics are unchanged.');
    } catch (e) {
      setError(e.message || 'Could not clear trash. Try again.');
    } finally {
      writeLock.current = false;
      setClearing(false);
    }
  }

  return (
    <>
      {notice && <p role="status" className="notice">{notice}</p>}
      <div className="inv__toolbar rise">
        <div className="inv__search">
          <span className="inv__searchIcon"><Search size={16} /></span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, customer or item…" aria-label="Search orders" />
        </div>
        <button className="btn btn--secondary" onClick={() => { setError(''); setTrashOpen(true); }}>
          <Trash2 size={15} /> Trash ({deletedLogs.length})
        </button>
      </div>

      <div className="workflow-toolbar">
        <label>From<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Through<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(search || from || to) && <button className="btn btn--secondary" onClick={clearFilters}>Clear filters</button>}
      </div>
      <p className="workflow-count" role="status">Date range: {!from && !to ? 'All dates' : `${from || 'Beginning'} through ${to || 'Latest'}`} · {filtered.length} orders</p>
      {from && to && from > to && <p role="alert">The end date must be on or after the start date.</p>}
      {logsResource?.status === 'error' ? <ReadState resource={logsResource} label="orders" /> : !logsLoaded ? (
        <div className="ord__grid" role="status" aria-label="Loading orders">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 170, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty rise-2">
          <span className="empty__icon"><ReceiptText size={24} /></span>
          <div className="empty__title">{logs.length === 0 ? 'No orders yet' : 'No orders match'}</div>
          <p>{logs.length === 0 ? 'Completed orders from your tablet appear here in real time.' : 'Try a different search.'}</p>
        </div>
      ) : (
        <div className="ord__grid">
          {filtered.map((log, idx) => {
            const items = getItems(log);
            return (
              <button key={log.orderNum} className={`card card--hover ord-card rise-${Math.min(6, (idx % 6) + 1)}`} onClick={() => { setError(''); setSelected(log); }}>
                <div className="ord-card__head">
                  <div style={{ minWidth: 0 }}>
                    {/* Customer name first — staff verify orders by name */}
                    <div className="ord-card__customer">{log.customerName || 'Walk-in'}</div>
                    <div className="ord-card__num">Order #{log.orderNum}</div>
                  </div>
                  <div className="ord-card__total num">{peso(orderTotal(log))}</div>
                </div>
                <span className="card-sub">{items.length} line items · View details</span>
                <div className="ord-card__foot">
                  <span className={`pill ${statusPillClass(orderStatus(log))}`}>
                    <span className="pill-dot" />
                    {orderStatus(log)}
                  </span>
                  <span className="pill pill--neutral" style={{ gap: 5 }}>
                    <Clock3 size={11} />
                    {formatWhen(log.timestamp || log.createdAt)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && <OrderDetail log={selected} onClose={() => setSelected(null)} onDelete={handleDelete} canTrash={canTrash} working={moving} error={error} />}

      <Modal
        open={trashOpen}
        onClose={() => { if (!clearing) setTrashOpen(false); }}
        title="Trash bin"
        subtitle={`${deletedLogs.length} deleted order${deletedLogs.length === 1 ? '' : 's'} — still counted in analytics unless excluded in Order History`}
        size="lg"
        footer={
          deletedLogs.length > 0 && canEmptyTrash && (
            <button className="btn btn--danger" onClick={handleClearTrash} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Empty trash permanently'}
            </button>
          )
        }
      >
        {error && <p role="alert" className="workflow-error">{error}</p>}
        {trashResource?.status !== 'ready' ? <ReadState resource={trashResource} label="trash" /> : deletedLogs.length === 0 ? (
          <div className="empty" style={{ padding: 'var(--sp-6)' }}>
            <RotateCcw size={22} style={{ color: 'var(--text-3)' }} />
            <p>Trash is empty.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {deletedLogs.map((log) => (
              <div className="alert-row" key={log.orderNum}>
                <span className="num" style={{ fontWeight: 700, flexShrink: 0 }}>#{log.orderNum}</span>
                <span style={{ flex: 1, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {getItems(log).map((it) => `${it.quantity || 1}× ${it.name}`).join(', ')}
                </span>
                <span className="num" style={{ fontWeight: 650, flexShrink: 0 }}>{peso(orderTotal(log))}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
