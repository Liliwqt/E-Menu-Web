import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Building2, ArrowRight, Sun, Moon, LogOut, ReceiptText, Banknote } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AUTH_CONFIG } from '../config/authConfig';
import { getAnalyticsSummary } from '../lib/analyticsApi';
import { formatCurrency, formatNumber } from '../lib/statisticsUtils';

/**
 * Admin overview — every branch at a glance.
 */
export default function AdminHomePage() {
  const navigate = useNavigate();
  const { user, nickname, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [summaries, setSummaries] = useState({});
  const [loaded, setLoaded] = useState(false);

  const branchIds = Object.keys(AUTH_CONFIG.branches);

  useEffect(() => {
    let cancelled = false;
    Promise.all(branchIds.map(async (id) => [id, await getAnalyticsSummary(id)]))
      .then((entries) => {
        if (!cancelled) {
          setSummaries(Object.fromEntries(entries));
          setLoaded(true);
        }
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = nickname || user?.email?.split('@')[0] || 'Admin';

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header className="shell__mobileHeader" style={{ display: 'flex', position: 'sticky' }}>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <div className="shell__brandMark" style={{ width: 36, height: 36 }}><Coffee size={18} /></div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>E-Menu Portal</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', fontWeight: 600 }}>Powered by Touch · Administrator console</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn btn--ghost btn--icon btn--sm" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => { logout(); navigate('/'); }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 980, margin: '0 auto', padding: 'var(--sp-7) var(--sp-5) var(--sp-9)' }}>
        <div className="rise" style={{ marginBottom: 'var(--sp-7)' }}>
          <h1 className="dash__greeting" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.1rem)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Welcome back, {displayName}
          </h1>
          <p style={{ color: 'var(--text-3)', marginTop: 6 }}>Choose a branch workspace to manage.</p>
        </div>

        <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {branchIds.map((id, i) => {
            const branch = AUTH_CONFIG.branches[id];
            const summary = summaries[id];
            return (
              <button
                key={id}
                className={`card card--hover card--pad rise-${i + 1}`}
                style={{ textAlign: 'left', cursor: 'pointer', display: 'grid', gap: 'var(--sp-4)' }}
                onClick={() => navigate(`/home/${id}`)}
              >
                <div className="flex-between">
                  <span className="kpi__icon" style={{ width: 42, height: 42, borderRadius: 12 }}><Building2 size={20} /></span>
                  <ArrowRight size={18} style={{ color: 'var(--text-3)' }} />
                </div>
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)' }}>{branch.name}</h2>
                  <p className="card-sub">{branch.emails?.join(', ') || branch.email}</p>
                </div>
                {loaded && summary ? (
                  <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                    <span className="pill pill--brand num" style={{ gap: 6 }}>
                      <Banknote size={12} /> {formatCurrency(summary.totalRevenue || 0)} lifetime
                    </span>
                    <span className="pill pill--neutral num" style={{ gap: 6 }}>
                      <ReceiptText size={12} /> {formatNumber(summary.totalOrders || 0)} orders
                    </span>
                  </div>
                ) : (
                  <div className="skeleton" style={{ height: 26, width: '70%' }} />
                )}
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
