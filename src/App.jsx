import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { canAccessBranch, getUserBranch, isUserAdmin } from './config/authConfig';
import { CAP } from './lib/permissions';
import { ROUTE_DECISION, protectedRouteDecision, setupRouteDecision } from './lib/routeAccess';
import { BranchDataProvider } from './context/BranchDataContext';
import LoginPage from './pages/LoginPage';
import WorkspaceSetupPage from './pages/WorkspaceSetupPage';
import AccessErrorScreen from './components/ui/AccessErrorScreen';

const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const AnalyticsPage = React.lazy(() => import('./pages/AnalyticsPage'));
const InventoryPage = React.lazy(() => import('./pages/InventoryPage'));
const OrdersPage = React.lazy(() => import('./pages/OrdersPage'));
const MenuPage = React.lazy(() => import('./pages/MenuPage'));
const ReportsPage = React.lazy(() => import('./pages/ReportsPage'));
const HistoryPage = React.lazy(() => import('./pages/HistoryPage'));
const AdminHomePage = React.lazy(() => import('./pages/AdminHomePage'));
const KiosksPage = React.lazy(() => import('./pages/KiosksPage'));
const SubscriptionPage = React.lazy(() => import('./pages/SubscriptionPage'));
const TeamPage = React.lazy(() => import('./pages/TeamPage'));

function FullScreenLoader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100dvh', background: 'var(--bg)' }}>
      <div className="spinner spinner--lg" aria-label="Loading" />
    </div>
  );
}

function ProtectedRoute({ children, adminOnly = false }) {
  const { isAuthenticated, initialLoading, workspaceLoaded, workspaceStatus, workspace, user } = useAuth();
  const params = useParams();
  const branchId = params.branchId;
  const isAdmin = isUserAdmin(user?.email);
  const homeBranchId = getUserBranch(workspace);

  // The ordering that decides this is in routeAccess.js, where a test can pin it
  // down. In particular: a read that failed must reach the retry screen rather
  // than the setup form, which writes a new company.
  const decision = protectedRouteDecision({
    initialLoading,
    isAuthenticated,
    isAdmin,
    workspaceLoaded,
    workspaceStatus,
    adminOnly,
    workspace,
    branchId,
    canAccessBranch,
  });

  if (decision === ROUTE_DECISION.LOADING) return <FullScreenLoader />;
  if (decision === ROUTE_DECISION.LOGIN) return <Navigate to="/" replace />;
  if (decision === ROUTE_DECISION.ACCESS_ERROR) return <AccessErrorScreen />;
  if (decision === ROUTE_DECISION.SETUP) return <Navigate to="/setup" replace />;
  if (decision === ROUTE_DECISION.REDIRECT_HOME) {
    return <Navigate to={`/home/${homeBranchId}`} replace />;
  }

  return children;
}

function SetupRoute() {
  const { isAuthenticated, initialLoading, workspaceLoaded, workspaceStatus, workspace, user } = useAuth();
  const isAdmin = isUserAdmin(user?.email);

  const decision = setupRouteDecision({
    initialLoading,
    isAuthenticated,
    isAdmin,
    workspaceLoaded,
    workspaceStatus,
    workspace,
  });

  if (decision === ROUTE_DECISION.LOADING) return <FullScreenLoader />;
  if (decision === ROUTE_DECISION.LOGIN) return <Navigate to="/" replace />;
  if (decision === ROUTE_DECISION.ADMIN_HOME) return <Navigate to="/home-admin" replace />;
  if (decision === ROUTE_DECISION.ACCESS_ERROR) return <AccessErrorScreen />;
  if (decision === ROUTE_DECISION.REDIRECT_HOME) {
    return <Navigate to={`/home/${workspace.branchId}`} replace />;
  }

  return <WorkspaceSetupPage />;
}

/** Provides shared live branch data to every page below a /:branchId route. */
function BranchScope({ children }) {
  const { branchId } = useParams();
  return <BranchDataProvider branchId={branchId}>{children}</BranchDataProvider>;
}

/**
 * Keeps a page behind the capability it actually needs.
 *
 * Hiding the nav entry was the only thing standing between a role and these
 * pages, and the entry is not the page: typing the URL rendered every control
 * anyway, each one failing on its own once pressed. One redirect is a better
 * answer than a screen of dead buttons.
 *
 * Waits for workspaceLoaded before judging. `role` is null until
 * loadAccessContext() resolves, and can() is fail-closed, so deciding earlier
 * would bounce a signed-in owner off their own pages on every refresh.
 */
function CapabilityRoute({ capability, children }) {
  const { can, workspaceLoaded } = useAuth();
  const { branchId } = useParams();

  if (!capability) return children;
  if (!workspaceLoaded) return <FullScreenLoader />;
  if (can(capability)) return children;
  // Dashboard carries no capability, so it is always a safe landing place.
  return <Navigate to={branchId ? `/home/${branchId}` : '/'} replace />;
}

function branchRoute(Page, capability) {
  return (
    <ProtectedRoute>
      <BranchScope>
        <CapabilityRoute capability={capability}>
          <Page />
        </CapabilityRoute>
      </BranchScope>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/home-admin" element={<ProtectedRoute adminOnly><AdminHomePage /></ProtectedRoute>} />
        <Route path="/home/:branchId" element={branchRoute(DashboardPage)} />
        <Route path="/analytics/:branchId" element={branchRoute(AnalyticsPage, CAP.VIEW_ANALYTICS)} />
        <Route path="/inventory/:branchId" element={branchRoute(InventoryPage)} />
        <Route path="/orders/:branchId" element={branchRoute(OrdersPage)} />
        <Route path="/menu/:branchId" element={branchRoute(MenuPage, CAP.MANAGE_MENU)} />
        <Route path="/reports/:branchId" element={branchRoute(ReportsPage, CAP.EXPORT_REPORTS)} />
        {/* Matches the nav entry: the ledger is where corrections happen, and the
            nav already withholds it from staff. Opening it read-only to staff is a
            product call, not a technical one — HistoryPage renders correctly either
            way, so only this capability and the nav entry change together. */}
        <Route path="/analytics-history/:branchId" element={branchRoute(HistoryPage, CAP.CORRECT_ANALYTICS)} />
        <Route path="/kiosks/:branchId" element={branchRoute(KiosksPage, CAP.MANAGE_KIOSKS)} />
        <Route path="/team/:branchId" element={branchRoute(TeamPage, CAP.MANAGE_STAFF)} />
        <Route path="/subscription/:branchId" element={branchRoute(SubscriptionPage, CAP.MANAGE_BILLING)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
