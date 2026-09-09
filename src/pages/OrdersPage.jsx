import { useMemo, useState } from 'react';
import { ReceiptText, Trash2, Search, RotateCcw, Clock3 } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import Modal from '../components/ui/Modal';
import { useBranchData } from '../context/BranchDataContext';
import { deleteLogToBin, clearDeletedLogs } from '../lib/menuApi';
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

function OrderDetail({ log, onClose, onDelete }) {
  const items = getItems(log);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Order #${log.orderNum}`}
      subtitle={formatWhen(log.timestamp || log.createdAt)}
      footer={
        <>
          {log.orderSource !== 'android_kiosk' && (
            <button className="btn btn--danger" onClick={() => { onDelete(log); onClose(); }}>
              <Trash2 size={15} /> Move to trash
            </button>
          )}
          <button className="btn btn--secondary" onClick={onClose}>Close</button>
        </>
      }
    >
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
  const { branchId, logs, logsLoaded, deletedLogs } = useBranchData();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => (
      String(log.orderNum).toLowerCase().includes(q)
      || String(log.customerName || '').toLowerCase().includes(q)
      || getItems(log).some((it) => String(it.name || '').toLowerCase().includes(q))
    ));
  }, [logs, search]);

  async function handleDelete(log) {
    if (log.orderSource === 'android_kiosk') return;

    try {
      const { orderNum, ...data } = log;
      await deleteLogToBin(branchId, orderNum, data);
    } catch (e) {
      console.error('Error moving order to trash:', e);
    }
  }

  async function handleClearTrash() {
    setClearing(true);
    try {
      await clearDeletedLogs(branchId);
    } finally {
      setClearing(false);
    }
  }

  return (
    <AppShell title="Orders">
      <div className="inv__toolbar rise">
        <div className="inv__search">
          <span className="inv__searchIcon"><Search size={16} /></span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, customer or item…" aria-label="Search orders" />
        </div>
        <button className="btn btn--secondary" onClick={() => setTrashOpen(true)}>
          <Trash2 size={15} /> Trash ({deletedLogs.length})
        </button>
      </div>

      {!logsLoaded ? (
        <div className="ord__grid">
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
              <button key={log.orderNum} className={`card card--hover ord-card rise-${Math.min(6, (idx % 6) + 1)}`} onClick={() => setSelected(log)}>
                <div className="ord-card__head">
                  <div style={{ minWidth: 0 }}>
                    {/* Customer name first — staff verify orders by name */}
                    <div className="ord-card__customer">{log.customerName || 'Walk-in'}</div>
                    <div className="ord-card__num">Order #{log.orderNum}</div>
                  </div>
                  <div className="ord-card__total num">{peso(orderTotal(log))}</div>
                </div>
                <div className="ord-card__items">
                  {items.slice(0, 3).map((it, i) => (
                    <div className="ord-card__item" key={i}>
                      <span><span className="num" style={{ fontWeight: 650 }}>{it.quantity || 1}×</span> {it.name}</span>
                    </div>
                  ))}
                  {items.length > 3 && <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>+{items.length - 3} more items</span>}
                </div>
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

      {selected && <OrderDetail log={selected} onClose={() => setSelected(null)} onDelete={handleDelete} />}

      <Modal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        title="Trash bin"
        subtitle={`${deletedLogs.length} deleted order${deletedLogs.length === 1 ? '' : 's'} — still counted in analytics unless excluded in the Order Ledger`}
        size="lg"
        footer={
          deletedLogs.length > 0 && (
            <button className="btn btn--danger" onClick={handleClearTrash} disabled={clearing}>
              {clearing ? 'Clearing…' : 'Empty trash permanently'}
            </button>
          )
        }
      >
        {deletedLogs.length === 0 ? (
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
    </AppShell>
  );
}
