import React, { Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { canAccessBranch, getUserBranch, isUserAdmin } from './config/authConfig';
import { BranchDataProvider } from './context/BranchDataContext';
import LoginPage from './pages/LoginPage';
import WorkspaceSetupPage from './pages/WorkspaceSetupPage';

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
  const { isAuthenticated, initialLoading, workspaceLoaded, workspace, user } = useAuth();
  const params = useParams();
  const branchId = params.branchId;

  if (initialLoading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/" replace />;

  const email = user?.email;
  if (isUserAdmin(email)) return children;
  if (!workspaceLoaded) return <FullScreenLoader />;
  if (adminOnly) return <Navigate to="/" replace />;

  if (!workspace?.onboardingComplete) return <Navigate to="/setup" replace />;

  const workspaceBranch = getUserBranch(workspace);
  if (branchId && !canAccessBranch(workspace, branchId)) {
    return <Navigate to={`/home/${workspaceBranch}`} replace />;
  }

  return children;
}

function SetupRoute() {
  const { isAuthenticated, initialLoading, workspaceLoaded, workspace, user } = useAuth();
  if (initialLoading || (isAuthenticated && !workspaceLoaded && !isUserAdmin(user?.email))) {
    return <FullScreenLoader />;
  }
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (isUserAdmin(user?.email)) return <Navigate to="/home-admin" replace />;
  if (workspace?.onboardingComplete) {
    return <Navigate to={`/home/${workspace.branchId}`} replace />;
  }
  return <WorkspaceSetupPage />;
}

/** Provides shared live branch data to every page below a /:branchId route. */
function BranchScope({ children }) {
  const { branchId } = useParams();
  return <BranchDataProvider branchId={branchId}>{children}</BranchDataProvider>;
}

function branchRoute(Page) {
  return (
    <ProtectedRoute>
      <BranchScope>
        <Page />
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
        <Route path="/analytics/:branchId" element={branchRoute(AnalyticsPage)} />
        <Route path="/inventory/:branchId" element={branchRoute(InventoryPage)} />
        <Route path="/orders/:branchId" element={branchRoute(OrdersPage)} />
        <Route path="/menu/:branchId" element={branchRoute(MenuPage)} />
        <Route path="/reports/:branchId" element={branchRoute(ReportsPage)} />
        <Route path="/analytics-history/:branchId" element={branchRoute(HistoryPage)} />
        <Route path="/kiosks/:branchId" element={<ProtectedRoute><BranchScope><React.Suspense fallback={<FullScreenLoader />}><KiosksPage /></React.Suspense></BranchScope></ProtectedRoute>} />
        <Route path="/team/:branchId" element={<ProtectedRoute><BranchScope><React.Suspense fallback={<FullScreenLoader />}><TeamPage /></React.Suspense></BranchScope></ProtectedRoute>} />
        <Route path="/subscription/:branchId" element={<ProtectedRoute><BranchScope><React.Suspense fallback={<FullScreenLoader />}><SubscriptionPage /></React.Suspense></BranchScope></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
