import { useMemo, useState } from 'react';
import {
  Boxes, Search, AlertTriangle, PackageCheck, PackageOpen, Gauge,
  Minus, Plus, History, TimerReset, TrendingDown,
} from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import Modal from '../components/ui/Modal';
import ScoreRing from '../components/ui/ScoreRing';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import { adjustStock, updateInventoryItem, getInventoryHistory } from '../lib/inventoryApi';
import { getInventoryHealth, forecastStockShortages } from '../lib/executiveMetrics';
import '../styles/inventory.css';

function statusOf(item) {
  const stock = Number(item.stock ?? 0);
  const warn = Number(item.warningLevel ?? 10);
  const crit = Number(item.criticalLevel ?? 5);
  if (stock <= crit) return 'critical';
  if (stock <= warn) return 'warning';
  return 'healthy';
}

const STATUS_META = {
  critical: { label: 'Critical', pill: 'pill--danger', bar: 'var(--danger)' },
  warning: { label: 'Low', pill: 'pill--warning', bar: 'var(--warning)' },
  healthy: { label: 'Healthy', pill: 'pill--success', bar: 'var(--success)' },
};

function StockModal({ item, allSizes = [], branchId, onClose }) {
  const { user } = useAuth();
  const [value, setValue] = useState(Number(item.stock ?? 0));
  const [note, setNote] = useState('');
  // Per-size stock for every size of this menu item (labels come straight
  // from the menu-driven inventory feed — same relationships as V1).
  const siblings = allSizes.filter((s) => s.id !== item.id);
  const [siblingStocks, setSiblingStocks] = useState(() => (
    Object.fromEntries(siblings.map((s) => [s.id, Number(s.stock ?? 0)]))
  ));
  const [warnLevel, setWarnLevel] = useState(Number(item.warningLevel ?? 10));
  const [critLevel, setCritLevel] = useState(Number(item.criticalLevel ?? 5));
  const [unit, setUnit] = useState(item.unit || 'units');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const previous = Number(item.stock ?? 0);
  const delta = value - previous;

  async function loadHistory() {
    try {
      const data = await getInventoryHistory(branchId, item.id);
      const rows = Object.values(data || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 30);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (delta !== 0) {
        await adjustStock(branchId, item.id, delta, previous, value, user?.email || 'manager', note.trim());
      }
      // Persist any edited sibling sizes through the same V1 adjust path.
      for (const s of siblings) {
        const prev = Number(s.stock ?? 0);
        const next = Number(siblingStocks[s.id] ?? prev);
        if (next !== prev) {
          await adjustStock(branchId, s.id, next - prev, prev, next, user?.email || 'manager', note.trim());
        }
      }
      const thresholdChanged = warnLevel !== Number(item.warningLevel ?? 10)
        || critLevel !== Number(item.criticalLevel ?? 5)
        || unit !== (item.unit || 'units');
      if (thresholdChanged) {
        await updateInventoryItem(branchId, item.id, { warningLevel: warnLevel, criticalLevel: critLevel, unit });
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={item.productName}
      subtitle={`${item._category}${item._sizeName && item._sizeName !== 'Medium' ? ` · ${item._sizeName}` : ''}`}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> : 'Save changes'}
          </button>
        </>
      }
    >
      {error && <div className="login__error" role="alert" style={{ marginBottom: 'var(--sp-4)' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 'var(--sp-5)' }}>
        <div>
          <label className="field-label" style={{ textAlign: 'center', display: 'block' }}>Stock level</label>
          <div className="inv__stepper">
            <button className="inv__stepBtn" onClick={() => setValue((v) => Math.max(0, v - 1))} aria-label="Decrease stock"><Minus size={20} /></button>
            <input
              className="inv__stepValue num"
              type="number"
              min="0"
              value={value}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Stock quantity"
            />
            <button className="inv__stepBtn" onClick={() => setValue((v) => v + 1)} aria-label="Increase stock"><Plus size={20} /></button>
          </div>
          {delta !== 0 && (
            <p style={{ textAlign: 'center', marginTop: 8, fontSize: 'var(--text-sm)', fontWeight: 650, color: delta > 0 ? 'var(--success)' : 'var(--danger)' }} className="num">
              {delta > 0 ? '+' : ''}{delta} {unit} vs current
            </p>
          )}
        </div>

        {/* ── Per-size stock (labels come from the menu configuration) ── */}
        {allSizes.length > 1 && (
          <div className="inv__sizes">
            <div className="flex-between" style={{ marginBottom: 'var(--sp-2)' }}>
              <label className="field-label" style={{ margin: 0 }}>Sizes</label>
              <span className="pill pill--brand num">
                Total {value + siblings.reduce((sum, s) => sum + Number(siblingStocks[s.id] ?? 0), 0)} {unit}
              </span>
            </div>
            <div className="inv__sizeRow inv__sizeRow--current">
              <span className="inv__sizeName">{item._sizeName || 'Medium'}<span className="pill pill--neutral" style={{ marginLeft: 8 }}>editing above</span></span>
              <span className="num" style={{ fontWeight: 700 }}>{value}</span>
            </div>
            {siblings.map((s) => (
              <div className="inv__sizeRow" key={s.id}>
                <span className="inv__sizeName">{s._sizeName || 'Medium'}</span>
                <input
                  className="input num"
                  style={{ minHeight: 38, width: 110, textAlign: 'center' }}
                  type="number"
                  min="0"
                  value={siblingStocks[s.id] ?? 0}
                  onChange={(e) => setSiblingStocks((all) => ({ ...all, [s.id]: Math.max(0, Number(e.target.value) || 0) }))}
                  aria-label={`Stock for ${s._sizeName}`}
                />
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="stock-note">Note (optional)</label>
          <input id="stock-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weekly delivery, spoilage, recount…" />
        </div>

        <button className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }} onClick={() => setShowAdvanced((s) => !s)}>
          <Gauge size={14} /> {showAdvanced ? 'Hide thresholds' : 'Alert thresholds & unit'}
        </button>

        {showAdvanced && (
          <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: '1fr 1fr 1fr' }}>
            <div>
              <label className="field-label">Warn at</label>
              <input className="input num" type="number" min="0" value={warnLevel} onChange={(e) => setWarnLevel(Number(e.target.value) || 0)} />
            </div>
            <div>
              <label className="field-label">Critical at</label>
              <input className="input num" type="number" min="0" value={critLevel} onChange={(e) => setCritLevel(Number(e.target.value) || 0)} />
            </div>
            <div>
              <label className="field-label">Unit</label>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          {history === null ? (
            <button className="btn btn--secondary btn--sm" onClick={loadHistory}>
              <History size={14} /> View adjustment history
            </button>
          ) : history.length === 0 ? (
            <p className="card-sub">No history recorded for this item yet.</p>
          ) : (
            <div className="inv__hist">
              {history.map((h, i) => (
                <div className="inv__histRow" key={i}>
                  <span style={{ color: 'var(--text-2)' }}>
                    <strong style={{ textTransform: 'capitalize' }}>{h.type?.replace('-', ' ')}</strong>
                    {h.note ? ` — ${h.note}` : ''}
                  </span>
                  <span className="num" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
                    → {h.newStock} · {h.timestamp ? new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function InventoryPage() {
  const { branchId, inventory, inventoryLoaded, analytics } = useBranchData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');
  const [selected, setSelected] = useState(null);

  const items = useMemo(() => (
    Object.entries(inventory).map(([id, item]) => ({ id, ...item, status: statusOf(item) }))
  ), [inventory]);

  const categories = useMemo(() => (
    [...new Set(items.map((i) => i._category).filter(Boolean))].sort()
  ), [items]);

  const health = useMemo(() => getInventoryHealth(inventory), [inventory]);
  const shortage = useMemo(
    () => forecastStockShortages(inventory, analytics?.products || {}, analytics?.daily || {}),
    [inventory, analytics]
  );

  // Sales velocity per product name → days-of-stock prediction per item.
  const velocity = useMemo(() => {
    const days = Math.max(1, Object.keys(analytics?.daily || {}).length);
    const map = new Map();
    Object.values(analytics?.products || {}).forEach((p) => {
      const key = String(p.name || '').trim().toLowerCase();
      if (key) map.set(key, (p.quantitySold || 0) / days);
    });
    return map;
  }, [analytics]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const order = { critical: 0, warning: 1, healthy: 2 };
    return items
      .filter((i) => (
        (statusFilter === 'all' || i.status === statusFilter)
        && (categoryFilter === 'all' || i._category === categoryFilter)
        && (!q || i.productName?.toLowerCase().includes(q) || i._category?.toLowerCase().includes(q))
      ))
      .sort((a, b) => {
        if (sortBy === 'name') return (a.productName || '').localeCompare(b.productName || '');
        if (sortBy === 'stock') return Number(a.stock || 0) - Number(b.stock || 0);
        return order[a.status] - order[b.status] || Number(a.stock || 0) - Number(b.stock || 0);
      });
  }, [items, search, statusFilter, categoryFilter, sortBy]);

  if (!inventoryLoaded) {
    return (
      <AppShell title="Inventory">
        <div className="inv__summary">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 84, borderRadius: 'var(--r-lg)' }} />)}
        </div>
        <div className="inv__grid">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton" style={{ height: 170, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      </AppShell>
    );
  }

  const counts = {
    critical: items.filter((i) => i.status === 'critical').length,
    warning: items.filter((i) => i.status === 'warning').length,
    healthy: items.filter((i) => i.status === 'healthy').length,
  };

  return (
    <AppShell title="Inventory">
      {/* ── Health summary ── */}
      <div className="inv__summary">
        <div className="card inv__summaryCard rise-1">
          <ScoreRing score={health.tracked ? health.score : null} size={64} stroke={7} />
          <div>
            <div className="inv__summaryValue num">{health.tracked ? `${health.score}%` : '—'}</div>
            <div className="inv__summaryLabel">Inventory health</div>
          </div>
        </div>
        <div className="card inv__summaryCard rise-2">
          <span className="inv__summaryIcon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><AlertTriangle size={20} /></span>
          <div>
            <div className="inv__summaryValue num">{counts.critical}</div>
            <div className="inv__summaryLabel">Critical items</div>
          </div>
        </div>
        <div className="card inv__summaryCard rise-3">
          <span className="inv__summaryIcon" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}><PackageOpen size={20} /></span>
          <div>
            <div className="inv__summaryValue num">{counts.warning}</div>
            <div className="inv__summaryLabel">Low stock</div>
          </div>
        </div>
        <div className="card inv__summaryCard rise-4">
          <span className="inv__summaryIcon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><PackageCheck size={20} /></span>
          <div>
            <div className="inv__summaryValue num">{counts.healthy}</div>
            <div className="inv__summaryLabel">Healthy</div>
          </div>
        </div>
      </div>

      {/* ── Shortage forecast ── */}
      {shortage?.risks?.length > 0 && (
        <section className="card card--pad rise-2" style={{ marginBottom: 'var(--sp-4)', borderColor: 'var(--warning)' }}>
          <h2 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
            <TimerReset size={17} style={{ color: 'var(--warning)' }} />
            Predicted shortages
            <span className="pill pill--brand">AI forecast</span>
          </h2>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {shortage.risks.map((r) => (
              <div className="alert-row" key={r.label}>
                <TrendingDown size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text-2)' }}>{r.label}</span>
                <span className="pill pill--warning num">{r.window}</span>
              </div>
            ))}
          </div>
          <p className="card-sub" style={{ marginTop: 'var(--sp-3)' }}>Based on current stock vs. average daily sales velocity. Order ahead to stay covered.</p>
        </section>
      )}

      {/* ── Filters ── */}
      <div className="inv__toolbar rise-3">
        <div className="inv__search">
          <span className="inv__searchIcon"><Search size={16} /></span>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items or categories…" aria-label="Search inventory" />
        </div>
        <div className="seg">
          {['all', 'critical', 'warning', 'healthy'].map((s) => (
            <button key={s} className={`seg__btn ${statusFilter === s ? 'is-active' : ''}`} onClick={() => setStatusFilter(s)}>
              {s === 'all' ? `All (${items.length})` : `${STATUS_META[s].label} (${counts[s]})`}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 140 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort inventory">
          <option value="status">Sort: urgency</option>
          <option value="stock">Sort: stock (low first)</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      {/* ── Items ── */}
      {filtered.length === 0 ? (
        <div className="empty">
          <span className="empty__icon"><Boxes size={24} /></span>
          <div className="empty__title">No items match</div>
          <p>{items.length === 0 ? 'Inventory syncs automatically from your menu items.' : 'Try clearing the search or filters.'}</p>
        </div>
      ) : (
        <div className="inv__grid">
          {filtered.map((item, idx) => {
            const meta = STATUS_META[item.status];
            const warn = Number(item.warningLevel ?? 10);
            const capacity = Math.max(warn * 2, Number(item.stock || 0), 1);
            const pct = Math.min(100, (Number(item.stock || 0) / capacity) * 100);
            const vel = velocity.get(String(item.productName || '').trim().toLowerCase()) || 0;
            const daysLeft = vel > 0 ? Number(item.stock || 0) / vel : null;
            return (
              <button
                key={item.id}
                className={`card card--hover inv-item rise-${Math.min(6, (idx % 6) + 1)}`}
                style={{ textAlign: 'left', cursor: 'pointer', border: item.status === 'critical' ? '1px solid var(--danger)' : undefined }}
                onClick={() => setSelected(item)}
                aria-label={`Adjust stock for ${item.productName}`}
              >
                <div className="inv-item__head">
                  <div>
                    <div className="inv-item__name">{item.productName}</div>
                    <div className="inv-item__meta">
                      {item._category}{item._sizeName && item._sizeName !== 'Medium' ? ` · ${item._sizeName}` : ''}
                    </div>
                  </div>
                  <span className={`pill ${meta.pill}`}><span className="pill-dot" />{meta.label}</span>
                </div>
                <div className="inv-item__stockRow">
                  <span className="inv-item__stock num">{Number(item.stock || 0)}</span>
                  <span className="inv-item__unit">{item.unit || 'units'} in stock</span>
                </div>
                <div className="inv-item__bar">
                  <div className="inv-item__fill" style={{ width: `${pct}%`, background: meta.bar }} />
                </div>
                <div className="inv-item__foot">
                  <span className="inv-item__pred">
                    {daysLeft !== null ? (
                      <>
                        <TimerReset size={12} />
                        {daysLeft < 1 ? 'Runs out today at current pace' : `~${Math.ceil(daysLeft)} days left at current pace`}
                      </>
                    ) : (
                      <>Warn at {warn} · critical at {Number(item.criticalLevel ?? 5)}</>
                    )}
                  </span>
                  {item.lastUpdated && (
                    <span className="inv-item__pred">
                      Updated {new Date(item.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <StockModal
          item={selected}
          allSizes={items.filter((i) => i._itemId === selected._itemId && i._category === selected._category)}
          branchId={branchId}
          onClose={() => setSelected(null)}
        />
      )}
    </AppShell>
  );
}
