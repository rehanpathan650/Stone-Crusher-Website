import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LazyMotion, MotionConfig, domMax } from 'framer-motion';
import { AuthProvider, ConfirmProvider, LookupsProvider, ToastProvider, useAuth } from './context.jsx';
import Layout from './components/Layout.jsx';
import DataPage from './components/DataPage.jsx';
import { Empty } from './components/ui.jsx';
import { Login, Setup, ChoosePassword } from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Stock from './pages/Stock.jsx';
const Ledger = lazy(() => import('./pages/Ledger.jsx'));
const Invoice = lazy(() => import('./pages/Invoice.jsx'));
const WageSlip = lazy(() => import('./pages/WageSlip.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Backup = lazy(() => import('./pages/Backup.jsx'));
const StockLedger = lazy(() => import('./pages/StockLedger.jsx'));
const WeighmentSlip = lazy(() => import('./pages/WeighmentSlip.jsx'));

const DATA_PAGES = ['sales', 'credit_notes', 'purchases', 'production', 'expenses', 'payments', 'parties', 'materials', 'vehicles', 'employees', 'royalty_permits', 'diesel_logs', 'maintenance', 'weighments'];

function Gate() {
  const auth = useAuth();
  if (auth.status === 'loading') return <div className="center-screen">Loading…</div>;
  if (auth.status === 'error') return <div className="center-screen">Cannot reach the server: {auth.error}</div>;
  if (auth.status === 'setup') return <Setup />;
  if (auth.status !== 'authed') return <Login />;
  if (auth.user.mustChangePassword) return <ChoosePassword />;
  return (
    <LookupsProvider>
      <Suspense fallback={<div className="center-screen"><div className="spinner" aria-label="Loading" /></div>}>
      <Routes>
        <Route path="/print/sale/:id" element={<Invoice kind="sale" />} />
        <Route path="/print/challan/:id" element={<Invoice kind="challan" />} />
        <Route path="/print/credit/:id" element={<Invoice kind="credit" />} />
        <Route path="/print/wageslip/:employeeId/:month" element={<WageSlip />} />
        <Route path="/print/weighment/:id" element={<WeighmentSlip />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          {DATA_PAGES.map(p => <Route key={p} path={p} element={<DataPage key={p} name={p} />} />)}
          <Route path="parties/:id" element={<Ledger />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/:id" element={<StockLedger />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="users" element={<Users />} />
          <Route path="audit" element={<Audit />} />
          <Route path="account" element={<Account />} />
          <Route path="backup" element={<Backup />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<div className="card"><Empty title="Page not found" /></div>} />
        </Route>
      </Routes>
      </Suspense>
    </LookupsProvider>
  );
}

export default function App() {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <Gate />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </MotionConfig>
    </LazyMotion>
  );
}
