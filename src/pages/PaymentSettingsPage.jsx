import { useEffect, useState } from 'react';
import { ChevronLeft, CircleCheck, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useBranchData } from '../context/BranchDataContext';
import { loadMerchantStatus, refundQrOrder, requestMerchantOnboarding } from '../lib/paymentApi';
import '../styles/subscription.css';

export default function PaymentSettingsPage() {
  const navigate = useNavigate();
  const { user, workspace } = useAuth();
  const { branchId } = useBranchData();
  const [status, setStatus] = useState(null);
  const [email, setEmail] = useState(user?.email || '');
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [refundOrderId, setRefundOrderId] = useState('');

  async function load() {
    setState('loading'); setMessage('');
    try {
      setStatus(await loadMerchantStatus(workspace.companyId, branchId));
      setState('ready');
    } catch (error) {
      setMessage(error.message); setState('error');
    }
  }
  useEffect(() => { load(); }, [workspace.companyId, branchId]);

  async function connect(event) {
    event.preventDefault(); setState('saving'); setMessage('');
    try {
      setStatus(await requestMerchantOnboarding({ companyId: workspace.companyId, branchId, email: email.trim() }));
      setMessage('Onboarding request recorded. Complete PayMongo verification before QR Ph can be enabled.');
      setState('ready');
    } catch (error) {
      setMessage(error.message); setState('error');
    }
  }

  async function refund(event) {
    event.preventDefault(); setState('saving'); setMessage('');
    try {
      const result = await refundQrOrder({ companyId: workspace.companyId, branchId, orderId: refundOrderId.trim() });
      setMessage(result.status === 'succeeded' ? 'Refund confirmed by PayMongo.' : 'Refund submitted to PayMongo and is pending.');
      setRefundOrderId(''); setState('ready');
    } catch (error) { setMessage(error.message); setState('error'); }
  }

  const ready = status?.available === true;
  return <div className="sub">
    <header className="sub__header">
      <button type="button" className="sub__back" onClick={() => navigate(`/home/${branchId}`)}>
        <ChevronLeft size={18} /> Back to dashboard
      </button>
      <div><h1 className="sub__title">Customer payments</h1>
        <p className="sub__subtitle">Connect this business to receive order-specific QR Ph payments directly.</p></div>
    </header>

    <div className={`sub__trial ${ready ? '' : 'is-ending'}`} role="status">
      <strong>{ready ? 'Verified QR Ph ready' : 'QR Ph remains disabled'}</strong>
      {' · '}{status?.message || (state === 'loading' ? 'Checking PayMongo connection…' : 'A verified linked merchant account is required.')}
    </div>

    <section className="sub__plan" style={{ maxWidth: 720 }}>
      <header><h2>PayMongo merchant account</h2>
        <p className="sub__subtitle">Status: <strong>{status?.status || state}</strong></p></header>
      <ul className="sub__planFeatures">
        <li><ShieldCheck size={16} /> Payments are priced and verified by the server.</li>
        <li><CircleCheck size={16} /> Each QR has an exact amount, one use, and a five-minute expiry.</li>
        <li><CircleCheck size={16} /> GCash and other QR Ph-compatible apps can scan it.</li>
      </ul>
      {!ready && <form onSubmit={connect} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label htmlFor="merchant-email">Business email</label>
        <input id="merchant-email" className="input" type="email" value={email}
          onChange={(event) => setEmail(event.target.value)} required disabled={state === 'saving'} />
        <button className="btn btn--primary" type="submit"
          disabled={!status?.linkedAccountsEnabled || state === 'saving'}>
          {state === 'saving' ? 'Starting…' : 'Connect PayMongo'}
        </button>
        {!status?.linkedAccountsEnabled && <p className="sub__subtitle">
          Self-service linking is locked until the platform rollout is enabled and this business has a verified linked PayMongo account.
          Pay at Counter remains available.
        </p>}
      </form>}
      {message && <p className="sub__subtitle" role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
      {state === 'error' && <button className="btn btn--secondary" type="button" onClick={load}>Retry</button>}
    </section>
    {ready && <section className="sub__plan" style={{ maxWidth: 720, marginTop: 20 }}>
      <header><h2>Refund a confirmed QR Ph order</h2></header>
      <form onSubmit={refund} style={{ display: 'grid', gap: 12 }}>
        <label htmlFor="refund-order-id">Order ID</label>
        <input id="refund-order-id" className="input" value={refundOrderId}
          onChange={(event) => setRefundOrderId(event.target.value)} required
          pattern="[0-9a-fA-F-]{36}" placeholder="Full order UUID" disabled={state === 'saving'} />
        <button className="btn btn--secondary" type="submit" disabled={state === 'saving'}>
          Submit full refund
        </button>
      </form>
      <p className="sub__subtitle">Only the owner can submit a full refund. Check the order in PayMongo before retrying an unclear result.</p>
    </section>}
    <p className="sub__subtitle">PayMongo processing fees are deducted by PayMongo from the merchant settlement. TouchOrders does not alter menu prices or claim that a payment succeeded before provider confirmation.</p>
  </div>;
}
