import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { canAccessBranch, getUserBranch } from './config/authConfig';
import { CAP } from './lib/permissions';
import { ROUTE_DECISION, protectedRouteDecision, setupRouteDecision } from './lib/routeAccess';
import { CHUNK_FAILURE_ACTION, buildRecoveryUrl, chunkFailureAction } from './lib/chunkRecovery';
import { branchRefFor, resolveBranchRef, withBranchRef } from './lib/branchRef';
import { BranchDataProvider, useBranchData } from './context/BranchDataContext';
import LoginPage from './pages/LoginPage';
import WorkspaceSetupPage from './pages/WorkspaceSetupPage';
import AccessErrorScreen from './components/ui/AccessErrorScreen';

/**
 * A page that recovers when its chunk belongs to a previous deploy.
 *
 * Deploying replaces the hashed chunk files and deletes the old ones, so a tab
 * still holding the previous index.html asks for a file that is gone the first
 * time it opens a page it has not loaded yet.
 *
 * The retry navigates to a URL carrying a marker, because reloading the same URL
 * can be answered from the browser's cache — with the stale index.html that
 * caused the failure. A marked URL has never been fetched, so it has to go to the
 * network, and the path is untouched, so the same page is routed to. The marker
 * is removed in main.jsx once the app is running.
 */
function lazyPage(load) {
  return React.lazy(() => load().then(
    (module) => module,
    (error) => {
      const action = chunkFailureAction({ href: window.location.href });
      if (action === CHUNK_FAILURE_ACTION.SURFACE) throw error;

      window.location.replace(buildRecoveryUrl(window.location.href));
      // Never settles on purpose: the page is navigating away, and resolving with
      // nothing would let React render a module that does not exist. Rejecting
      // would surface the error we are in the middle of recovering from.
      return new Promise(() => {});
    }
  ));
}

const DashboardPage = lazyPage(() => import('./pages/DashboardPage'));
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'));
const InventoryPage = lazyPage(() => import('./pages/InventoryPage'));
const OrdersPage = lazyPage(() => import('./pages/OrdersPage'));
const MenuPage = lazyPage(() => import('./pages/MenuPage'));
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'));
const HistoryPage = lazyPage(() => import('./pages/HistoryPage'));
const DevicesPage = lazyPage(() => import('./pages/DevicesPage'));
const SubscriptionPage = lazyPage(() => import('./pages/SubscriptionPage'));
const TeamPage = lazyPage(() => import('./pages/TeamPage'));

function FullScreenLoader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100dvh', background: 'var(--bg)' }}>
      <div className="spinner spinner--lg" aria-label="Loading" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, initialLoading, workspaceLoaded, workspaceStatus, workspace } = useAuth();
  const params = useParams();
  const location = useLocation();
  const branchRef = params.branchId;
  const homeBranchId = getUserBranch(workspace);

  // The URL may name the branch (`/home/branch1`) or use its id. Everything below
  // reads data with the id, so the segment is resolved before any decision is
  // taken. The device bridge is handed this resolved value too, and it validates
  // the id shape, so passing the nicer form through would break provisioning.
  const resolvedBranchId = resolveBranchRef(workspace, branchRef);

  // Resolution can legitimately fail — a branch since renamed, or a link to one
  // this account cannot see. Passing the raw segment on is deliberate:
  // canAccessBranch is guaranteed to reject anything that did not resolve, which
  // lands on the home redirect instead of rendering a branch with no data.
  const accessBranchId = resolvedBranchId || branchRef;

  // The ordering that decides this is in routeAccess.js, where a test can pin it
  // down. In particular: a read that failed must reach the retry screen rather
  // than the setup form, which writes a new company.
  const decision = protectedRouteDecision({
    initialLoading,
    isAuthenticated,
    workspaceLoaded,
    workspaceStatus,
    workspace,
    branchId: accessBranchId,
    canAccessBranch,
  });

  if (decision === ROUTE_DECISION.LOADING) return <FullScreenLoader />;
  if (decision === ROUTE_DECISION.LOGIN) return <Navigate to="/" replace />;
  if (decision === ROUTE_DECISION.ACCESS_ERROR) return <AccessErrorScreen />;
  if (decision === ROUTE_DECISION.SETUP) return <Navigate to="/setup" replace />;
  if (decision === ROUTE_DECISION.REDIRECT_HOME) {
    return <Navigate to={`/home/${branchRefFor(workspace, homeBranchId)}`} replace />;
  }

  // Settle the address before rendering: a link may arrive with either form, and
  // the bar should not disagree with the page about which branch is open. This
  // runs on navigation as well, because in-app links are built from the id, which
  // is always valid and never ambiguous.
  const canonicalRef = branchRefFor(workspace, resolvedBranchId);
  if (canonicalRef && canonicalRef !== branchRef) {
    // Query and hash are carried across; only the branch segment is rewritten.
    const target = withBranchRef(location.pathname, canonicalRef);
    return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
  }

  return children;
}

function SetupRoute() {
  const { isAuthenticated, initialLoading, workspaceLoaded, workspaceStatus, workspace } = useAuth();

  const decision = setupRouteDecision({
    initialLoading,
    isAuthenticated,
    workspaceLoaded,
    workspaceStatus,
    workspace,
  });

  if (decision === ROUTE_DECISION.LOADING) return <FullScreenLoader />;
  if (decision === ROUTE_DECISION.LOGIN) return <Navigate to="/" replace />;
  if (decision === ROUTE_DECISION.ACCESS_ERROR) return <AccessErrorScreen />;
  if (decision === ROUTE_DECISION.REDIRECT_HOME) {
    return <Navigate to={`/home/${branchRefFor(workspace, workspace.branchId)}`} replace />;
  }

  return <WorkspaceSetupPage />;
}

/** Provides shared live branch data to every page below a /:branchId route. */
function BranchScope({ children }) {
  const { workspace, user } = useAuth();
  const { branchId: branchRef } = useParams();
  // Every consumer of this provider — the shell, its nav paths, the device bridge,
  // the processors and the pages — needs the real id, not the readable form.
  const branchId = resolveBranchRef(workspace, branchRef);
  return <BranchDataProvider key={`${user?.uid}:${workspace?.companyId}:${branchId}`} branchId={branchId}>{children}</BranchDataProvider>;
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
  const { branchId } = useBranchData();

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
        <Route path="/home/:branchId" element={branchRoute(DashboardPage)} />
        <Route path="/analytics/:branchId" element={branchRoute(AnalyticsPage, CAP.VIEW_ANALYTICS)} />
        <Route path="/inventory/:branchId" element={branchRoute(InventoryPage)} />
        <Route path="/orders/:branchId" element={branchRoute(OrdersPage)} />
        <Route path="/menu/:branchId" element={branchRoute(MenuPage, CAP.TOGGLE_AVAILABILITY)} />
        <Route path="/reports/:branchId" element={branchRoute(ReportsPage, CAP.EXPORT_REPORTS)} />
        {/* Matches the nav entry: the ledger is where corrections happen, and the
            nav already withholds it from staff. Opening it read-only to staff is a
            product call, not a technical one — HistoryPage renders correctly either
            way, so only this capability and the nav entry change together. */}
        <Route path="/analytics-history/:branchId" element={branchRoute(HistoryPage, CAP.CORRECT_ANALYTICS)} />
        <Route path="/devices/:branchId" element={branchRoute(DevicesPage, CAP.MANAGE_DEVICES)} />
        <Route path="/team/:branchId" element={branchRoute(TeamPage, CAP.MANAGE_STAFF)} />
        {/* Members can read the branch plan; SubscriptionPage gates changes to the owner. */}
        <Route path="/subscription/:branchId" element={branchRoute(SubscriptionPage)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
