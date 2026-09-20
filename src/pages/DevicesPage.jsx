import { useSubscription } from '../context/SubscriptionContext';
import SubscriptionStatus from '../components/ui/SubscriptionStatus';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Monitor, RefreshCw, Power, AlertTriangle, Plus, X } from 'lucide-react';
import { ref, onValue, off } from 'firebase/database';
import { database, branchDataPath } from '../lib/firebase';
import { useBranchData } from '../context/BranchDataContext';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { isSubscriptionActive, FEATURE, hasFeature } from '../lib/planFeatures';
import { deregisterDevice, registerDevice, setDeviceActive } from '../lib/workspaceApi';
import { CAP } from '../lib/permissions';
import '../styles/devices.css';

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

export default function DevicesPage() {
  const { branchId } = useBranchData();
  const navigate = useNavigate();
  const { user, workspace, can } = useAuth();
  const { billing, status } = useSubscription();
  const subscriptionActive = isSubscriptionActive(billing);
  // Two separate questions, both required: the plan has to include multi-device,
  // and the role has to be allowed to manage devices. hasFeature() alone was
  // only ever the first one, so a staff account on a subscribed branch saw the
  // register, enable/disable and deregister controls.
  const canManage = can(CAP.MANAGE_DEVICES) && hasFeature(billing, FEATURE.MULTI_DEVICES);
  const [devices, setDevices] = useState({});
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState(null);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [deviceUid, setDeviceUid] = useState('');

  useEffect(() => {
    if (!branchId) return undefined;
    // NOTE: `/kiosks` is a persisted database path; it is not renamed.
    const devicesRef = ref(database, `${branchDataPath(branchId)}/kiosks`);
    const handler = (snapshot) => {
      setDevices(snapshot.val() || {});
      setLoading(false);
    };
    onValue(devicesRef, handler);
    return () => off(devicesRef, 'value', handler);
  }, [branchId]);

  async function handleToggleActive(deviceUid, currentlyActive) {
    if (!user?.uid) return;
    setError('');
    setWorkingUid(deviceUid);
    try {
      // Enable used to write only the branch and member records, leaving the root
      // pointer the tablet reads switched off — so the row said Active while the
      // device could never enrol itself again. One helper turns all four records
      // the same way, in both directions.
      await setDeviceActive(user.uid, branchId, deviceUid, !currentlyActive);
    } catch (err) {
      setError(err.message || 'Could not update device status.');
    } finally {
      setWorkingUid(null);
    }
  }

  // Which device is awaiting confirmation. It is asked in the page, because the
  // browser dialog this used to call is refused in a sandboxed frame and returns
  // false in the Android WebView, where the device admin screen actually runs.
  const [confirmDeregister, setConfirmDeregister] = useState(null);

  async function handleDeregister(deviceUid) {
    setError('');
    setWorkingUid(deviceUid);
    try {
      if (user?.uid) {
        await deregisterDevice(user.uid, branchId, deviceUid);
      }
      setConfirmDeregister(null);
    } catch (err) {
      setError(err.message || 'Could not deregister device.');
    } finally {
      setWorkingUid(null);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    if (!user?.uid) return;
    setError('');
    setWorkingUid(deviceUid);
    try {
      await registerDevice(user.uid, branchId, deviceName, deviceUid.trim());
      setDeviceName('');
      setDeviceUid('');
      setShowRegister(false);
    } catch (err) {
      setError(err.message || 'Could not register device.');
    } finally {
      setWorkingUid(null);
    }
  }

  const deviceList = Object.entries(devices).map(([uid, data]) => ({ uid, ...data }));
  const activeCount = deviceList.filter((k) => k.isActive).length;

  if (status !== 'ready') return <div className="ks"><h1>Devices</h1><SubscriptionStatus /></div>;

  return (
    <div className="ks">
      <header className="ks__header">
        <button type="button" className="ks__back" onClick={() => navigate(`/home/${branchId}`)}>
          <ChevronLeft size={18} /> Back to dashboard
        </button>
        <div>
          <h1 className="ks__title">Devices</h1>
          <p className="ks__subtitle">
            Manage the Android tablets registered to this branch. Devices submit orders and decrement
            stock atomically; this view lets you monitor their status and revoke access.
          </p>
        </div>
      </header>

      {!subscriptionActive && (
        <div className="ks__notice" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Subscription required.</strong> Multi-device management is part of the
            Subscription plan. You can see the devices already registered, but adding or
            re-registering devices requires an active subscription.
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
          <span className="ks__summaryValue">{deviceList.length}</span>
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
          <Plus size={16} /> Register device
        </button>
      )}

      {error && <div className="ks__error" role="alert">{error}</div>}

      <section className="ks__list">
        {loading ? (
          <div className="ks__empty">Loading devices…</div>
        ) : deviceList.length === 0 ? (
          <div className="ks__empty">
            <Monitor size={28} />
            <h2>No devices registered yet</h2>
            <p>
              Open the E-Menu Android app on a tablet, sign in with the same Google account used
              here, and complete the setup flow. The device will appear here automatically.
            </p>
          </div>
        ) : (
          <ul className="ks__items">
            {deviceList.map((device) => (
              <li key={device.uid} className={`ks__item ${device.isActive ? 'is-active' : 'is-inactive'}`}>
                <div className="ks__itemMain">
                  <div className="ks__itemIcon">
                    <Monitor size={22} />
                  </div>
                  <div>
                    <h3 className="ks__itemName">{device.name || 'Unnamed device'}</h3>
                    <p className="ks__itemMeta">
                      <span>UID: <code>{device.uid}</code></span>
                      <span>·</span>
                      <span>Registered: {formatRelativeTime(device.registeredAt)}</span>
                      <span>·</span>
                      <span>Last active: {formatRelativeTime(device.lastActiveAt)}</span>
                    </p>
                  </div>
                </div>
                <div className="ks__itemActions">
                  <span className={`ks__statusBadge ${device.isActive ? 'is-on' : 'is-off'}`}>
                    {device.isActive ? 'Active' : 'Disabled'}
                  </span>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="ks__btn"
                        onClick={() => handleToggleActive(device.uid, device.isActive)}
                        disabled={workingUid === device.uid}
                      >
                        {device.isActive ? (
                          <><Power size={14} /> Disable</>
                        ) : (
                          <><RefreshCw size={14} /> Enable</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="ks__btn ks__btn--danger"
                        onClick={() => setConfirmDeregister(device)}
                        disabled={workingUid === device.uid}
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
        <div className="ks__dialog" role="dialog" aria-modal="true" aria-labelledby="register-device-title">
          <div className="ks__dialogCard">
            <button type="button" className="ks__dialogClose" onClick={() => setShowRegister(false)} aria-label="Close">
              <X size={18} />
            </button>
            <h2 id="register-device-title">Register Android device</h2>
            <p>Enter the anonymous UID shown on the device registration screen.</p>
            <form onSubmit={handleRegister}>
              <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required maxLength={60} placeholder="Nivel Hills Device 1" /></label>
              <label>Anonymous device UID<input value={deviceUid} onChange={(event) => setDeviceUid(event.target.value)} required maxLength={128} placeholder="Paste the UID from the tablet" /></label>
              <button type="submit" className="ks__btn ks__btn--primary" disabled={workingUid === deviceUid}>Register this device</button>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeregister)}
        tone="danger"
        title="Deregister this device?"
        message={
          'The tablet stops taking orders immediately and will not enrol itself again until this device is enabled. '
          + `${confirmDeregister?.name ? `"${confirmDeregister.name}" ` : 'This device '}`
          + 'stays in this list as Disabled, and Enable lets it back in.'
        }
        confirmLabel="Deregister"
        workingLabel="Deregistering…"
        working={Boolean(confirmDeregister) && workingUid === confirmDeregister.uid}
        onConfirm={() => handleDeregister(confirmDeregister.uid)}
        onClose={() => setConfirmDeregister(null)}
      />
    </div>
  );
}
