import '../../styles/workflows.css';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Boxes, ReceiptText, UtensilsCrossed,
  FileBarChart, History, Sun, Moon, LogOut, Sparkles, Settings2, Coffee, HelpCircle,
  Monitor, CreditCard, MoreHorizontal, Users, User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useBranchData } from '../../context/BranchDataContext';
import { useLiveAnalyst } from '../../context/LiveAnalystProvider';
import { branchLabel } from '../../lib/branchLabel';
import { useAiAccess } from '../../hooks/useAiAccess';
import { isEmbeddedInApp, enterMenuMode, getDeviceUid } from '../../lib/deviceBridge';
import { CAP, roleLabel } from '../../lib/permissions';
import SettingsModal from './SettingsModal';
import DeviceRegisterDialog from './DeviceRegisterDialog';
import AINotificationPanel from '../ai/AINotificationPanel';
import HelpCenter from '../help/HelpCenter';
import Modal from '../ui/Modal';
import BranchSwitcher from './BranchSwitcher';

const AIAnalystDrawer = lazy(() => import('../ai/AIAnalystDrawer'));

const NAV = [
  { key: 'home', label: 'Dashboard', icon: LayoutDashboard, path: (b) => `/home/${b}` },
  { key: 'orders', label: 'Orders', icon: ReceiptText, path: (b) => `/orders/${b}` },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, path: (b) => `/menu/${b}`, cap: CAP.TOGGLE_AVAILABILITY },
  { key: 'inventory', label: 'Inventory', icon: Boxes, path: (b) => `/inventory/${b}` },
];

const NAV_INSIGHTS = [
  { key: 'analytics', label: 'Analytics', icon: TrendingUp, path: (b) => `/analytics/${b}`, cap: CAP.VIEW_ANALYTICS },
  { key: 'reports', label: 'Reports', icon: FileBarChart, path: (b) => `/reports/${b}`, cap: CAP.EXPORT_REPORTS },
  { key: 'history', label: 'Order History', icon: History, path: (b) => `/analytics-history/${b}`, cap: CAP.CORRECT_ANALYTICS },
];

const NAV_SETTINGS = [
  { key: 'team', label: 'Team', icon: Users, path: (b) => `/team/${b}`, cap: CAP.MANAGE_STAFF },
  { key: 'devices', label: 'Devices', icon: Monitor, path: (b) => `/devices/${b}`, cap: CAP.MANAGE_DEVICES },
  { key: 'subscription', label: 'Subscription', icon: CreditCard, path: (b) => `/subscription/${b}` },
];

// Bottom bar shows the four daily tools plus a "More" entry that opens the rest.
const NAV_MOBILE = [
  ...NAV,
  { key: 'more', label: 'More', icon: MoreHorizontal, path: null },
];

function activeKeyFor(pathname) {
  if (pathname.includes('/analytics-history/')) return 'history';
  if (pathname.includes('/analytics/')) return 'analytics';
  if (pathname.includes('/inventory/')) return 'inventory';
  if (pathname.includes('/orders/')) return 'orders';
  if (pathname.includes('/menu/')) return 'menu';
  if (pathname.includes('/reports/')) return 'reports';
  if (pathname.includes('/devices/')) return 'devices';
  if (pathname.includes('/team/')) return 'team';
  if (pathname.includes('/subscription/')) return 'subscription';
  return 'home';
}

export default function AppShell({ children, title }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, nickname, workspace, logout, role, can } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { branchId, aiAnalyticsData, hasOrders } = useBranchData();
  const { setBranchData } = useLiveAnalyst();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAction, setAiAction] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceUid, setDeviceUid] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  // Role and plan together. isAiEnabled() alone is only the plan half.
  const aiEnabled = useAiAccess();

  // Feed branch data to the LiveAnalystProvider (which sits above the router)
  // so it can generate AI analyses with current branch analytics.
  useEffect(() => {
    setBranchData({ branchId, aiAnalyticsData, hasOrders });
  }, [branchId, aiAnalyticsData, hasOrders, setBranchData]);

  // Lets any page open the AI Analyst pre-loaded with a module action
  // (e.g. the dashboard's AI suite cards): dispatch 'emp:open-ai'.
  useEffect(() => {
    if (!aiEnabled) return undefined;
    const handler = (e) => {
      setAiAction(e.detail || null);
      setAiOpen(true);
    };
    window.addEventListener('emp:open-ai', handler);
    return () => window.removeEventListener('emp:open-ai', handler);
  }, [aiEnabled]);

  const activeKey = activeKeyFor(location.pathname);
  const branchName = branchLabel({ workspace, branchId });
  const displayName = nickname || user?.email?.split('@')[0] || 'Manager';
  const initials = displayName.slice(0, 2).toUpperCase();
  const embeddedInApp = isEmbeddedInApp();

  // Navigation is filtered by capability, so a staff account never sees a door
  // it cannot open. The rules enforce the same matrix server-side.
  const allowed = useCallback((item) => !item.cap || can(item.cap), [can]);
  const navPrimary = useMemo(() => NAV.filter(allowed), [allowed]);
  const navInsights = useMemo(() => NAV_INSIGHTS.filter(allowed), [allowed]);
  const navSettings = useMemo(() => NAV_SETTINGS.filter(allowed), [allowed]);
  const navMobile = useMemo(() => NAV_MOBILE.filter(allowed), [allowed]);

  const pageTitle = useMemo(() => {
    const all = [...NAV, ...NAV_INSIGHTS, ...NAV_SETTINGS];
    return title || all.find((n) => n.key === activeKey)?.label || 'Dashboard';
  }, [title, activeKey]);

  const go = (item) => navigate(item.path(branchId));

  /**
   * Device header toggle handler.
   * Reads the device's anonymous Firebase UID from the Android bridge. If present,
   * opens the registration dialog (asks only for a name, auto-registers the UID
   * under the signed-in account, then enters device mode). If the bridge does not
   * provide a UID (fallback), enters device mode directly with existing state.
   */
  function handleDeviceClick() {
    const uid = getDeviceUid();
    if (uid) {
      setDeviceUid(uid);
      setDeviceDialogOpen(true);
      return;
    }
    // Fallback: no UID available (older bridge) — go straight to device.
    enterMenuMode({ companyId: workspace?.companyId, branchId });
  }

  return (
    <div className="shell">
      {/* ── Desktop sidebar ── */}
      <aside className="shell__sidebar">
        <div className="shell__brand">
          <div className="shell__brandMark"><Coffee size={20} /></div>
          <div>
            <div className="shell__brandName">E-Menu Portal</div>
            <div className="shell__brandSub">Powered by Touch</div>
          </div>
        </div>
        <BranchSwitcher branchId={branchId} />

        <nav className="shell__nav" aria-label="Primary">
          <div className="shell__navLabel">Daily work</div>
          {navPrimary.map((item) => (
            <button
              key={item.key}
              className={`shell__navItem ${activeKey === item.key ? 'is-active' : ''}`}
              onClick={() => go(item)}
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <item.icon size={18} strokeWidth={activeKey === item.key ? 2.4 : 2} />
              {item.label}
            </button>
          ))}
          {navInsights.length > 0 && (
            <>
              <div className="shell__navLabel">Reports & insights</div>
              {navInsights.map((item) => (
                <button
                  key={item.key}
                  className={`shell__navItem ${activeKey === item.key ? 'is-active' : ''}`}
                  onClick={() => go(item)}
                  aria-current={activeKey === item.key ? 'page' : undefined}
                >
                  <item.icon size={18} strokeWidth={activeKey === item.key ? 2.4 : 2} />
                  {item.label}
                </button>
              ))}
            </>
          )}
          {navSettings.length > 0 && (
            <>
              <div className="shell__navLabel">Administration</div>
              {navSettings.map((item) => (
                <button
                  key={item.key}
                  className={`shell__navItem ${activeKey === item.key ? 'is-active' : ''}`}
                  onClick={() => go(item)}
                  aria-current={activeKey === item.key ? 'page' : undefined}
                >
                  <item.icon size={18} strokeWidth={activeKey === item.key ? 2.4 : 2} />
                  {item.label}
                </button>
              ))}
            </>
          )}
          {aiEnabled && (
            <button className="shell__navItem" onClick={() => setAiOpen(true)}>
              <Sparkles size={18} />
              AI Analyst
            </button>
          )}
        </nav>

        <div className="shell__footer">
          <button className="shell__navItem" onClick={toggleTheme}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <button className="shell__user" onClick={() => setSettingsOpen(true)} title="Account settings">
            <div className="shell__avatar">{initials}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="shell__userName">{displayName}</div>
              <div className="shell__userRole">{roleLabel(role)}</div>
            </div>
            <Settings2 size={16} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => { logout(); navigate('/'); }} style={{ justifyContent: 'flex-start', color: 'var(--text-3)' }}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="shell__main">
        <header className="shell__topbar">
          <div className="flex gap-3" style={{ alignItems: 'center' }}>
            <h1 className="shell__pageTitle">{pageTitle}</h1>
            <span className="pill pill--brand">{branchName}</span>
            <span className="pill pill--neutral" style={{ gap: 8 }}>
              <span className="live-dot" />
              Live
            </span>
          </div>
          <div className="shell__topActions">
            <button className="btn btn--ghost btn--icon" onClick={() => setHelpOpen(true)} aria-label="Help Center" title="Help Center">
              <HelpCircle size={18} />
            </button>
            {embeddedInApp && (
              <button
                className="btn btn--ghost btn--icon"
                onClick={handleDeviceClick}
                aria-label="Enter device mode"
                title="Register this device as a device and enter device mode"
              >
                <Monitor size={18} />
              </button>
            )}
            {aiEnabled && (
              <button className="shell__aiBtn" onClick={() => setAiOpen(true)}>
                <Sparkles size={15} />
                Ask AI Analyst
              </button>
            )}
          </div>
        </header>

        {/* Mobile header */}
        <header className="shell__mobileHeader">
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            <div className="shell__brandMark" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <Coffee size={16} />
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.1 }}>{pageTitle}</div>
              {/* Compact branch switcher: also available on mobile/portrait. */}
              <BranchSwitcher branchId={branchId} compact />
            </div>
          </div>
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setHelpOpen(true)} aria-label="Help">
              <HelpCircle size={17} />
            </button>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            {embeddedInApp && (
              <button
                className="btn btn--ghost btn--icon btn--sm"
                onClick={handleDeviceClick}
                aria-label="Enter device mode"
                title="Register this device as a device and enter device mode"
              >
                <Monitor size={17} />
              </button>
            )}
            {aiEnabled && (
              <button className="shell__aiBtn" style={{ minHeight: 34, padding: '0 12px' }} onClick={() => setAiOpen(true)}>
                <Sparkles size={14} />
                AI
              </button>
            )}
            <button
              className="shell__avatar"
              style={{ border: 'none', width: 32, height: 32 }}
              onClick={() => setSettingsOpen(true)}
              aria-label="Account settings"
              title="Account settings"
            >
              <User size={17} />
            </button>
          </div>
        </header>

        <main className="shell__content page-enter" key={location.pathname}>
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="shell__bottomNav" aria-label="Primary">
        {navMobile.map((item) => (
          <button
            key={item.key}
            className={`shell__bottomItem ${activeKey === item.key ? 'is-active' : ''}`}
            onClick={() => (item.path ? go(item) : setMoreOpen(true))}
            aria-current={activeKey === item.key ? 'page' : undefined}
          >
            <item.icon size={19} strokeWidth={activeKey === item.key ? 2.4 : 2} />
            {item.label}
          </button>
        ))}
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More navigation">
            {navInsights.length > 0 && (
              <>
                <div className="shell__navLabel">Reports & insights</div>
                {navInsights.map((item) => (
                  <button
                    key={item.key}
                    className={`shell__navItem ${activeKey === item.key ? 'is-active' : ''}`}
                    onClick={() => { go(item); setMoreOpen(false); }}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </button>
                ))}
              </>
            )}
            {navSettings.length > 0 && (
              <>
                <div className="shell__navLabel">Administration</div>
                {navSettings.map((item) => (
                  <button
                    key={item.key}
                    className={`shell__navItem ${activeKey === item.key ? 'is-active' : ''}`}
                    onClick={() => { go(item); setMoreOpen(false); }}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </button>
                ))}
              </>
            )}
            {aiEnabled && (
              <button className="shell__navItem" onClick={() => { setMoreOpen(false); setAiOpen(true); }}>
                <Sparkles size={18} />
                AI Analyst
              </button>
            )}
      </Modal>

      {aiEnabled && aiOpen && (
        <Suspense fallback={null}>
          <AIAnalystDrawer
            open={aiOpen}
            initialAction={aiAction}
            onClose={() => { setAiOpen(false); setAiAction(null); }}
          />
        </Suspense>
      )}

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <DeviceRegisterDialog
        open={deviceDialogOpen}
        onClose={() => setDeviceDialogOpen(false)}
        deviceUid={deviceUid}
        companyId={workspace?.companyId}
        branchId={branchId}
      />

      <HelpCenter open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Gated like every other AI surface. It is invisible without aiEnabled
          today, because every trigger in LiveAnalystProvider is gated, but that
          left one AI element mounted for users who cannot use it — and the only
          thing keeping it off the screen was an opacity rule driven by state that
          happened to stay closed. */}
      {aiEnabled && <AINotificationPanel />}
    </div>
  );
}
