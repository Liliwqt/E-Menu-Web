import { useState } from 'react';
import { Monitor, X } from 'lucide-react';
import { enterMenuMode } from '../../lib/deviceBridge';
import { useAuth } from '../../context/AuthContext';

/**
 * Modal shown when the operator taps the device toggle in the AppShell header.
 *
 * It asks ONLY for a device identity name. On confirm it:
 *  1. Registers the device's anonymous Firebase UID under the signed-in account
 *     at the CURRENT page's branch (branchId prop), so a device registered while
 *     viewing branch 2 enrolls to branch 2 — not the account's default branch.
 *  2. Hands the workspace company/branch IDs to the Android shell, which
 *     provisions the native menu and enters locked device mode.
 */
export default function DeviceRegisterDialog({
  open,
  onClose,
  deviceUid,
  companyId,
  branchId,
}) {
  const { registerDeviceForCurrentUser } = useAuth();
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function confirm(e) {
    e.preventDefault();
    setError('');
    const deviceName = name.trim();
    if (!deviceName) {
      setError('Enter a name for this device.');
      return;
    }
    if (!deviceUid) {
      setError('This device does not report a Firebase identity yet. Try again in a moment.');
      return;
    }
    setWorking(true);
    try {
      // Register to the branch the operator is currently viewing (branchId),
      // not the workspace's default branch.
      await registerDeviceForCurrentUser(deviceName, deviceUid, branchId);
      onClose();
      // Now enter the native locked device menu.
      enterMenuMode({ companyId, branchId });
    } catch (err) {
      setError(err.message || 'Unable to register this device.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="kr__overlay" onClick={onClose} role="presentation">
      <div
        className="kr__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kr-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kr__head">
          <div className="kr__icon"><Monitor size={18} /></div>
          <div className="kr__headText">
            <h2 id="kr-title">Register this device as a device</h2>
            <p>Name this device so you can identify it in the Devices page.</p>
          </div>
          <button type="button" className="kr__close" onClick={onClose} aria-label="Close" disabled={working}>
            <X size={16} />
          </button>
        </header>

        <form onSubmit={confirm}>
          <label className="kr__field">
            <span>Device identity name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Counter Tablet"
              maxLength={60}
              disabled={working}
            />
          </label>

          {deviceUid ? (
            <p className="kr__uid">Device UID: <code>{deviceUid}</code></p>
          ) : (
            <p className="kr__error">This device has no Firebase identity yet.</p>
          )}

          {error && <p className="kr__error" role="alert">{error}</p>}

          <div className="kr__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={working}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={working || !name.trim()}>
              {working ? 'Registering…' : 'Register & enter device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}