import { useState } from 'react';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Shown when the account records could not be read.
 *
 * This exists so a failed read is never mistaken for a missing workspace. The
 * two look identical from the router's side — both leave `workspace` null — but
 * they call for opposite responses. A missing workspace is a new account and
 * belongs in onboarding; a failed read is a dropped connection and belongs
 * here, where the answer is to try again rather than to start filling in a
 * form that creates a company.
 */
export default function AccessErrorScreen() {
  const { reloadAccess, logout } = useAuth();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await reloadAccess();
    } finally {
      // reloadAccess() resolves even when the retry fails, so the spinner always
      // clears. On success this screen unmounts underneath it.
      setRetrying(false);
    }
  }

  return (
    <div
      style={{
        // `100%` of #root, not `100dvh` — viewport units are 0 in the Android WebView.
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
        color: 'var(--text-1)',
        fontFamily: 'var(--font-ui)',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <AlertTriangle size={32} style={{ color: 'var(--warning)', marginBottom: 12 }} />
        <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>Couldn&rsquo;t load your account</h1>
        <p style={{ color: 'var(--text-3)', marginBottom: 20 }}>
          Your details are still there — the request to fetch them didn&rsquo;t get through.
          Check your connection and try again.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={retry} disabled={retrying}>
            <RefreshCw size={15} /> {retrying ? 'Trying again…' : 'Try again'}
          </button>
          <button className="btn btn--ghost" onClick={logout} disabled={retrying}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
