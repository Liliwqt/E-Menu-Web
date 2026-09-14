import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Monitor, RefreshCw, Power, AlertTriangle, Plus, X } from 'lucide-react';
import { ref, onValue, off, update, serverTimestamp } from 'firebase/database';
import { database, branchDataPath } from '../lib/firebase';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import { isSubscriptionActive, FEATURE, hasFeature } from '../lib/planFeatures';
import { deregisterKiosk, registerKiosk } from '../lib/workspaceApi';
import { CAP } from '../lib/permissions';
import '../styles/kiosks.css';

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const ms = Date.now() - Number(timestamp);
  if (ms < 0) return 'Just now';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function KiosksPage() {
  const { branchId } = useBranchData();
  const navigate = useNavigate();
  const { user, workspace, can } = useAuth();
  const subscriptionActive = isSubscriptionActive(workspace);
  // Two separate questions, both required: the plan has to include multi-kiosk,
  // and the role has to be allowed to manage devices. hasFeature() alone was
  // only ever the first one, so a staff account on a subscribed branch saw the
  // register, enable/disable and deregister controls.
  const canManage = can(CAP.MANAGE_KIOSKS) && hasFeature(workspace, FEATURE.MULTI_KIOSK);
  const [kiosks, setKiosks] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [kioskName, setKioskName] = useState('');
  const [kioskUid, setKioskUid] = useState('');

  useEffect(() => {
    if (!branchId) return undefined;
    const kiosksRef = ref(database, `${branchDataPath(branchId)}/kiosks`);
    const handler = (snapshot) => {
      setKiosks(snapshot.val() || {});
      setLoading(false);
    };
    onValue(kiosksRef, handler);
    return () => off(kiosksRef, 'value', handler);
  }, [branchId]);

  async function handleToggleActive(kioskUid, currentlyActive) {
    setError('');
    setWorkingUid(kioskUid);
    try {
      await update(ref(database, `${branchDataPath(branchId)}/kiosks/${kioskUid}`), {
        isActive: !currentlyActive,
        lastActiveAt: serverTimestamp(),
      });
      if (user?.uid) {
        await update(ref(database, `${workspace.companyId}/users/${user.uid}/kiosks/${kioskUid}`), {
          isActive: !currentlyActive,
          lastActiveAt: serverTimestamp(),
        });
      }
    } catch (err) {
      setError(err.message || 'Could not update kiosk status.');
    } finally {
      setWorkingUid(null);
    }
  }

  async function handleDeregister(kioskUid) {
    if (!window.confirm('Deregister this kiosk? It will need to be set up again before use.')) return;
    setError('');
    setWorkingUid(kioskUid);
    try {
      if (user?.uid) {
        await deregisterKiosk(user.uid, branchId, kioskUid);
      }
    } catch (err) {
      setError(err.message || 'Could not deregister kiosk.');
    } finally {
      setWorkingUid(null);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (!user?.uid) return;
    setError('');
    setWorkingUid(kioskUid);
    try {
      await registerKiosk(user.uid, branchId, kioskName, kioskUid.trim());
      setKioskName('');
      setKioskUid('');
      setShowRegister(false);
    } catch (err) {
      setError(err.message || 'Could not register kiosk.');
    } finally {
      setWorkingUid(null);
    }
  }

  const kioskList = Object.entries(kiosks).map(([uid, data]) => ({ uid, ...data }));
  const activeCount = kioskList.filter((k) => k.isActive).length;

  return (
    <div className="ks">
      <header className="ks__header">
        <button type="button" className="ks__back" onClick={() => navigate(`/home/${branchId}`)}>
          <ChevronLeft size={18} /> Back to dashboard
        </button>
        <div>
          <h1 className="ks__title">Kiosk devices</h1>
          <p className="ks__subtitle">
            Manage the Android tablets registered to this branch. Kiosks submit orders and decrement
            stock atomically; this view lets you monitor their status and revoke access.
          </p>
        </div>
      </header>

      {!subscriptionActive && (
        <div className="ks__notice" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Subscription required.</strong> Multi-kiosk management is part of the
            Subscription plan. You can see the devices already registered, but adding or
            re-registering kiosks requires an active subscription.
            <button
              type="button"
              className="ks__noticeLink"
              onClick={() => navigate(`/subscription/${branchId}`)}
            >
              View plans
            </button>
          </div>
        </div>
      )}

      <section className="ks__summary">
        <div className="ks__summaryCard">
          <span className="ks__summaryLabel">Total devices</span>
          <span className="ks__summaryValue">{kioskList.length}</span>
        </div>
        <div className="ks__summaryCard">
          <span className="ks__summaryLabel">Active now</span>
          <span className="ks__summaryValue">{activeCount}</span>
        </div>
        <div className="ks__summaryCard">
          <span className="ks__summaryLabel">Plan</span>
          <span className="ks__summaryValue">
            {subscriptionActive ? 'Subscription' : 'Free'}
          </span>
        </div>
      </section>

      {canManage && (
        <button type="button" className="ks__register" onClick={() => setShowRegister(true)}>
          <Plus size={16} /> Register kiosk
        </button>
      )}

      {error && <div className="ks__error" role="alert">{error}</div>}

      <section className="ks__list">
        {loading ? (
          <div className="ks__empty">Loading devices…</div>
        ) : kioskList.length === 0 ? (
          <div className="ks__empty">
            <Monitor size={28} />
            <h2>No kiosks registered yet</h2>
            <p>
              Open the E-Menu Android app on a tablet, sign in with the same Google account used
              here, and complete the setup flow. The device will appear here automatically.
            </p>
          </div>
        ) : (
          <ul className="ks__items">
            {kioskList.map((kiosk) => (
              <li key={kiosk.uid} className={`ks__item ${kiosk.isActive ? 'is-active' : 'is-inactive'}`}>
                <div className="ks__itemMain">
                  <div className="ks__itemIcon">
                    <Monitor size={22} />
                  </div>
                  <div>
                    <h3 className="ks__itemName">{kiosk.name || 'Unnamed kiosk'}</h3>
                    <p className="ks__itemMeta">
                      <span>UID: <code>{kiosk.uid}</code></span>
                      <span>·</span>
                      <span>Registered: {formatRelativeTime(kiosk.registeredAt)}</span>
                      <span>·</span>
                      <span>Last active: {formatRelativeTime(kiosk.lastActiveAt)}</span>
                    </p>
                  </div>
                </div>
                <div className="ks__itemActions">
                  <span className={`ks__statusBadge ${kiosk.isActive ? 'is-on' : 'is-off'}`}>
                    {kiosk.isActive ? 'Active' : 'Disabled'}
                  </span>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="ks__btn"
                        onClick={() => handleToggleActive(kiosk.uid, kiosk.isActive)}
                        disabled={workingUid === kiosk.uid}
                      >
                        {kiosk.isActive ? (
                          <><Power size={14} /> Disable</>
                        ) : (
                          <><RefreshCw size={14} /> Enable</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="ks__btn ks__btn--danger"
                        onClick={() => handleDeregister(kiosk.uid)}
                        disabled={workingUid === kiosk.uid}
                      >
                        Deregister
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showRegister && (
        <div className="ks__dialog" role="dialog" aria-modal="true" aria-labelledby="register-kiosk-title">
          <div className="ks__dialogCard">
            <button type="button" className="ks__dialogClose" onClick={() => setShowRegister(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h2 id="register-kiosk-title">Register Android kiosk</h2>
            <p>Enter the anonymous UID shown on the kiosk registration screen.</p>
            <form onSubmit={handleRegister}>
              <label>Kiosk name<input value={kioskName} onChange={(event) => setKioskName(event.target.value)} required maxLength={60} placeholder="Nivel Hills Kiosk 1" /></label>
              <label>Anonymous kiosk UID<input value={kioskUid} onChange={(event) => setKioskUid(event.target.value)} required maxLength={128} placeholder="Paste the UID from the tablet" /></label>
              <button type="submit" className="ks__btn ks__btn--primary" disabled={workingUid === kioskUid}>Register this kiosk</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
