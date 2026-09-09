import { useEffect, useMemo, useRef, useState } from 'react';
import {
  UtensilsCrossed, Plus, Pencil, Trash2, Star, ImagePlus, FolderPlus,
  ScrollText, EyeOff, Eye, ChevronDown, ChevronRight,
} from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import Modal from '../components/ui/Modal';
import { useBranchData } from '../context/BranchDataContext';
import {
  onCategoriesChange, addCategory, removeCategory, renameCategory,
  addItemToFirebase, updateItem, deleteItem, setBestSeller,
  compressImage, updateImageInFirebase, onMenuLogsChange,
} from '../lib/menuApi';
import { formatCurrency } from '../lib/statisticsUtils';
import '../styles/menu.css';

const peso = (v) => formatCurrency(v);

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `item_${Date.now()}`;
}

function ItemModal({ mode, branchId, category, itemKey, item, categories, onClose }) {
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [description, setDescription] = useState(item?.description || '');
  // Size variants — V1 schema: item.sizes = { [name]: { priceModifier } },
  // Medium (+₱0) always exists; final price = base price + priceModifier.
  const [extraSizes, setExtraSizes] = useState(() => (
    Object.entries(item?.sizes || {})
      .filter(([szName]) => szName !== 'Medium')
      .map(([szName, szData]) => ({ name: szName, priceModifier: String(szData?.priceModifier ?? 0) }))
  ));
  const [targetCategory, setTargetCategory] = useState(category || categories[0] || '');
  const [imagePreview, setImagePreview] = useState(item?.imageUrl || '');
  const [imageChanged, setImageChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  async function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(reader.result);
      setImagePreview(compressed);
      setImageChanged(true);
    };
    reader.readAsDataURL(file);
  }

  function buildSizesObject() {
    // Exactly like V1's AddItemForm: Medium is always present at +₱0.
    const sizesObj = { Medium: { priceModifier: 0 } };
    for (const s of extraSizes) {
      const szName = s.name.trim();
      if (!szName) continue;
      const mod = parseFloat(s.priceModifier);
      if (Number.isNaN(mod)) continue;
      sizesObj[szName] = { priceModifier: mod };
    }
    return sizesObj;
  }

  async function save() {
    setError('');
    if (!name.trim()) { setError('Item name is required.'); return; }
    if (price === '' || Number.isNaN(Number(price))) { setError('Enter a valid base price.'); return; }
    if (!targetCategory) { setError('Pick a category.'); return; }
    for (const s of extraSizes) {
      if (s.name.trim() && (Number.isNaN(parseFloat(s.priceModifier)) || parseFloat(s.priceModifier) < 0)) {
        setError(`Additional price for "${s.name.trim()}" must be 0 or more.`);
        return;
      }
    }
    setSaving(true);
    try {
      const sizesObj = buildSizesObject();
      if (mode === 'add') {
        const id = slugify(name);
        const payload = { name: name.trim(), price: Number(price), available: true, sizes: sizesObj };
        if (description.trim()) payload.description = description.trim();
        if (imagePreview && imageChanged) payload.imageUrl = imagePreview;
        await addItemToFirebase(branchId, targetCategory, id, payload);
      } else {
        // Preserve every existing field; only overwrite what was edited.
        const payload = { ...item, name: name.trim(), price: Number(price), sizes: sizesObj };
        if (description.trim()) payload.description = description.trim();
        else delete payload.description;
        await updateItem(branchId, category, itemKey, payload);
        if (imageChanged && imagePreview) {
          await updateImageInFirebase(branchId, category, itemKey, imagePreview);
        }
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save item.');
    } finally {
      setSaving(false);
    }
  }

  const basePrice = Number(price) || 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'add' ? 'Add menu item' : `Edit ${item?.name}`}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} /> : mode === 'add' ? 'Add item' : 'Save changes'}
          </button>
        </>
      }
    >
      {error && <div className="login__error" role="alert" style={{ marginBottom: 'var(--sp-4)' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <button
          type="button"
          className="menu-item__img"
          style={{ borderRadius: 'var(--r-md)', border: '1.5px dashed var(--border-strong)', cursor: 'pointer', overflow: 'hidden', width: '100%' }}
          onClick={() => fileRef.current?.click()}
          aria-label="Upload item photo"
        >
          {imagePreview ? (
            <img src={imagePreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ display: 'grid', placeItems: 'center', gap: 6, padding: 20 }}>
              <ImagePlus size={26} />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Add a photo</span>
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />

        <div>
          <label className="field-label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spanish Latte" />
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-3)', gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <label className="field-label">Base Price (₱) *</label>
            <input className="input num" type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Category *</label>
            <select className="select" value={targetCategory} onChange={(e) => setTargetCategory(e.target.value)} disabled={mode === 'edit'}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* ── Size variants: final price = base + additional ── */}
        <div className="menu-sizes">
          <div className="flex-between" style={{ marginBottom: 'var(--sp-2)' }}>
            <label className="field-label" style={{ margin: 0 }}>Available Sizes</label>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setExtraSizes((s) => [...s, { name: '', priceModifier: '' }])}
            >
              <Plus size={13} /> Add size
            </button>
          </div>

          <div className="menu-sizes__row menu-sizes__row--fixed">
            <span className="menu-sizes__name">Medium</span>
            <span className="menu-sizes__mod muted">+ ₱0.00 (base)</span>
            <span className="menu-sizes__final num">= {peso(basePrice)}</span>
          </div>

          {extraSizes.map((s, idx) => {
            const mod = parseFloat(s.priceModifier);
            const final = basePrice + (Number.isNaN(mod) ? 0 : mod);
            return (
              <div className="menu-sizes__row" key={idx}>
                <input
                  className="input"
                  style={{ minHeight: 38 }}
                  placeholder="Size name (e.g. Large)"
                  value={s.name}
                  onChange={(e) => setExtraSizes((all) => all.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))}
                />
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 'var(--text-sm)' }}>+₱</span>
                  <input
                    className="input num"
                    style={{ minHeight: 38, paddingLeft: 30 }}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Additional price for ${s.name || 'size'}`}
                    value={s.priceModifier}
                    onChange={(e) => setExtraSizes((all) => all.map((x, i) => (i === idx ? { ...x, priceModifier: e.target.value } : x)))}
                  />
                </div>
                <span className="menu-sizes__final num">= {peso(final)}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setExtraSizes((all) => all.filter((_, i) => i !== idx))}
                  aria-label={`Remove size ${s.name || idx + 1}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          <p className="card-sub" style={{ marginTop: 6 }}>
            Final selling price per size = base price + additional price. Medium is always available at the base price.
          </p>
        </div>

        <div>
          <label className="field-label">Description</label>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional short description" />
        </div>
      </div>
    </Modal>
  );
}

export default function MenuPage() {
  const { branchId } = useBranchData();
  const [categories, setCategories] = useState([]);
  const [itemsByCategory, setItemsByCategory] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [newCategory, setNewCategory] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { mode, category, itemKey, item }
  const [confirmDelete, setConfirmDelete] = useState(null); // { category, itemKey, item } | { category }
  const [logsOpen, setLogsOpen] = useState(false);
  const [menuLogs, setMenuLogs] = useState([]);

  useEffect(() => {
    if (!branchId) return undefined;
    return onCategoriesChange(branchId, (names, items) => {
      setCategories(names);
      setItemsByCategory(items);
      setLoaded(true);
    });
  }, [branchId]);

  useEffect(() => {
    if (!branchId || !logsOpen) return undefined;
    return onMenuLogsChange(branchId, setMenuLogs);
  }, [branchId, logsOpen]);

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message || 'Action failed.');
    } finally {
      setBusy('');
    }
  }

  const totalItems = useMemo(
    () => Object.values(itemsByCategory).reduce((s, items) => s + Object.keys(items).length, 0),
    [itemsByCategory]
  );

  return (
    <AppShell title="Menu">
      <div className="flex-between rise" style={{ marginBottom: 'var(--sp-5)', flexWrap: 'wrap' }}>
        <p className="card-sub" style={{ margin: 0 }}>
          {categories.length} categories · {totalItems} items. Availability syncs automatically with inventory stock.
        </p>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--secondary btn--sm" onClick={() => setLogsOpen(true)}>
            <ScrollText size={14} /> Change log
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setModal({ mode: 'add' })} disabled={categories.length === 0}>
            <Plus size={14} /> Add item
          </button>
        </div>
      </div>

      {error && <div className="login__error" role="alert" style={{ marginBottom: 'var(--sp-4)' }}>{error}</div>}

      {/* Add category */}
      <div className="menu__addCat card card--pad rise-1" style={{ marginBottom: 'var(--sp-6)', padding: 'var(--sp-4) var(--sp-5)' }}>
        <FolderPlus size={17} style={{ color: 'var(--primary)' }} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          placeholder="New category name (e.g. Iced Drinks)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newCategory.trim()) {
              run('addcat', async () => { await addCategory(branchId, newCategory); setNewCategory(''); });
            }
          }}
        />
        <button
          className="btn btn--secondary"
          disabled={!newCategory.trim() || busy === 'addcat'}
          onClick={() => run('addcat', async () => { await addCategory(branchId, newCategory); setNewCategory(''); })}
        >
          Add category
        </button>
      </div>

      {!loaded ? (
        <div className="menu__grid">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : categories.length === 0 ? (
        <div className="empty">
          <span className="empty__icon"><UtensilsCrossed size={24} /></span>
          <div className="empty__title">Your menu starts here</div>
          <p>Create a category above, then add your first item.</p>
        </div>
      ) : (
        categories.map((cat) => {
          const items = itemsByCategory[cat] || {};
          const isCollapsed = collapsed[cat];
          return (
            <section className="menu__cat rise-2" key={cat}>
              <div className="menu__catHead">
                <button
                  className="menu__catTitle btn btn--ghost"
                  style={{ padding: '6px 10px', minHeight: 0 }}
                  onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                  <h2 style={{ fontSize: 'var(--text-lg)' }}>{cat}</h2>
                  <span className="pill pill--neutral num">{Object.keys(items).length}</span>
                </button>
                <div className="flex gap-2">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      const next = prompt(`Rename category "${cat}" to:`, cat);
                      if (next && next !== cat) run('rencat', () => renameCategory(branchId, cat, next));
                    }}
                  >
                    <Pencil size={13} /> Rename
                  </button>
                  <button className="btn btn--ghost btn--sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDelete({ category: cat })}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                Object.keys(items).length === 0 ? (
                  <p className="card-sub" style={{ padding: '0 4px' }}>No items in this category yet.</p>
                ) : (
                  <div className="menu__grid">
                    {Object.entries(items).map(([key, item]) => {
                      const available = item.available !== false && item.available !== 'false';
                      return (
                        <div key={key} className={`card card--hover menu-item ${available ? '' : 'menu-item--unavailable'}`}>
                          {item.imageUrl ? (
                            <img className="menu-item__img" src={item.imageUrl} alt={item.name} loading="lazy" />
                          ) : (
                            <div className="menu-item__img"><UtensilsCrossed size={26} /></div>
                          )}
                          <div className="menu-item__body">
                            <div className="flex-between">
                              <span className="menu-item__name">
                                {item.isBestSeller && <Star size={14} fill="var(--accent)" style={{ color: 'var(--accent)' }} />}
                                {item.name}
                              </span>
                              <span className="menu-item__price">
                                {item.sizes && Object.keys(item.sizes).length > 1 ? `Base ${peso(item.price)}` : peso(item.price)}
                              </span>
                            </div>
                            {item.sizes && Object.keys(item.sizes).length > 1 && (
                              <div className="menu-item__sizes">
                                {Object.entries(item.sizes).map(([szName, szData]) => (
                                  <span className="pill pill--neutral num" key={szName} title={`${szName}: base ${peso(item.price)} + ${peso(szData?.priceModifier || 0)}`}>
                                    {szName} {peso(Number(item.price || 0) + Number(szData?.priceModifier || 0))}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="flex-between">
                              <span className={`pill ${available ? 'pill--success' : 'pill--danger'}`}>
                                {available ? 'Available' : 'Sold out'}
                              </span>
                            </div>
                            <div className="menu-item__actions">
                              <button className="btn btn--ghost btn--sm" onClick={() => setModal({ mode: 'edit', category: cat, itemKey: key, item })} aria-label={`Edit ${item.name}`}>
                                <Pencil size={13} />
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                title={available ? 'Mark sold out' : 'Mark available'}
                                onClick={() => run('avail', () => updateItem(branchId, cat, key, { ...item, available: !available }))}
                                aria-label={available ? `Mark ${item.name} sold out` : `Mark ${item.name} available`}
                              >
                                {available ? <EyeOff size={13} /> : <Eye size={13} />}
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                title={item.isBestSeller ? 'Remove best-seller badge' : 'Mark as best seller'}
                                onClick={() => run('star', () => setBestSeller(branchId, cat, key, !item.isBestSeller))}
                                aria-label={`Toggle best seller for ${item.name}`}
                              >
                                <Star size={13} fill={item.isBestSeller ? 'var(--accent)' : 'none'} style={item.isBestSeller ? { color: 'var(--accent)' } : undefined} />
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                style={{ color: 'var(--danger)', marginLeft: 'auto' }}
                                onClick={() => setConfirmDelete({ category: cat, itemKey: key, item })}
                                aria-label={`Delete ${item.name}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </section>
          );
        })
      )}

      {modal && (
        <ItemModal
          mode={modal.mode}
          branchId={branchId}
          category={modal.category}
          itemKey={modal.itemKey}
          item={modal.item}
          categories={categories}
          onClose={() => setModal(null)}
        />
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={confirmDelete?.itemKey ? `Delete ${confirmDelete.item?.name}?` : `Delete category "${confirmDelete?.category}"?`}
        subtitle={confirmDelete?.itemKey
          ? 'The item is removed from the menu. Past sales analytics are kept.'
          : 'All items inside this category will be removed from the menu.'}
        footer={
          <>
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button
              className="btn btn--danger"
              onClick={() => run('delete', async () => {
                if (confirmDelete.itemKey) await deleteItem(branchId, confirmDelete.category, confirmDelete.itemKey);
                else await removeCategory(branchId, confirmDelete.category);
                setConfirmDelete(null);
              })}
              disabled={busy === 'delete'}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      />

      <Modal open={logsOpen} onClose={() => setLogsOpen(false)} title="Menu change log" subtitle="Audit trail of every menu edit" size="lg">
        {menuLogs.length === 0 ? (
          <p className="card-sub">No menu changes recorded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: '55vh', overflowY: 'auto' }}>
            {menuLogs.slice(0, 100).map((log) => (
              <div className="alert-row" key={log.id}>
                <span style={{ flex: 1, color: 'var(--text-2)' }}>{log.action}</span>
                <span className="muted" style={{ fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                  {log.email?.split('@')[0]} · {log.timestamp ? new Date(log.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
