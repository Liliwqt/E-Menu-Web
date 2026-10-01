import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { CAP } from '../../lib/permissions';
import { cancelSubscription, closeBusiness, recoverBusiness, downloadBusinessExport, reauthenticateLifecycle } from '../../lib/lifecycleApi';
import Modal from './Modal';

export default function LifecycleControls() {
  const { user, workspace, can } = useAuth();
  const { branchId, lifecycle } = useSubscription();
  const companyId = workspace?.companyId;
  const scope = `${user?.uid}/${companyId}/${branchId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const [action, setAction] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setAction(null); setPassword(''); setMessage(''); setBusy(false); pending.current = false; }, [scope]);
  if (!can(CAP.MANAGE_BILLING)) return null;
  async function run(kind) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    const startedScope = scope;
    try {
      if (!kind.startsWith('export')) await reauthenticateLifecycle(password);
      if (currentScope.current !== startedScope) return;
      if (kind === 'cancel') await cancelSubscription(companyId, branchId);
      else if (kind === 'close') await closeBusiness(companyId);
      else if (kind === 'recover') await recoverBusiness(companyId, lifecycle?.closureScope === 'business' ? null : branchId);
      else {
        const result = await downloadBusinessExport(companyId, kind === 'export-branch' ? branchId : null, () => currentScope.current === startedScope);
        if (result?.requiresBrowserSignIn) { setMessage('Sign in to the portal in your browser to securely download your records.'); setAction(null); return; }
      }
      if (currentScope.current !== startedScope) return;
      setMessage(kind.startsWith('export') ? 'Download ready.' : kind === 'cancel' ? 'Subscription cancelled. No refund was issued.' : kind === 'close' ? 'Business closure scheduled. You have 30 days to export or recover.' : 'Recovery confirmed. Subscription expiry is unchanged.');
      setAction(null); setPassword('');
    } catch (error) { if (currentScope.current === startedScope) setMessage(error.message); }
    finally { if (currentScope.current === startedScope) { pending.current = false; setBusy(false); } }
  }
  return <section className="sub__cancellation" aria-label="Business records and access">
    <h2>Records and access</h2>
    <p>Download your records before closing. Closure stops new writes immediately and allows 30 days for recovery. Deleted records may remain in inaccessible backups for up to 30 days.</p>
    <button type="button" className="btn" disabled={busy} onClick={() => run('export-branch')}>Download this branch</button>{' '}
    <button type="button" className="btn" disabled={busy} onClick={() => run('export-business')}>Download whole business</button>{' '}
    <button type="button" className="btn" disabled={busy} onClick={() => setAction('cancel')}>Cancel branch subscription</button>{' '}
    <button type="button" className="btn" disabled={busy} onClick={() => setAction('close')}>Close business</button>{' '}
    {['closing', 'inactivity_grace'].includes(lifecycle?.status) && <button type="button" className="btn" disabled={busy} onClick={() => setAction('recover')}>Recover access</button>}
    <p role="status" aria-live="polite">{busy ? 'Working…' : message}</p>
    {action && <Modal open title={action === 'cancel' ? 'Cancel subscription' : action === 'close' ? 'Close business' : 'Recover access'} onClose={() => { if (!busy) setAction(null); }}>
      <p>{action === 'cancel' ? 'Subscription access and new writes stop immediately. Your records remain. Cancellation does not issue a refund.' : action === 'close' ? 'All branches stop accepting new writes. Export or recover within 30 days; otherwise deletion follows.' : 'Recover this closure without extending or renewing a subscription.'}</p>
      <label htmlFor="lifecycle-password">Confirm your password</label>
      <input id="lifecycle-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      <button type="button" className="btn" disabled={busy || !password} onClick={() => run(action)}>{busy ? 'Saving…' : 'Confirm'}</button>
      <button type="button" className="btn" disabled={busy} onClick={() => setAction(null)}>Keep current access</button>
    </Modal>}
  </section>;
}
