'use client';
/**
 * Client-side shells shared by every route:
 *  - <Providers>: animation settings, toasts, confirm dialogs, auth state (wraps the whole app);
 *  - <AppShell>: decides what a visitor sees (setup, sign-in, choose-password, or the app with sidebar);
 *  - <PrintShell>: the same sign-in gate for printable documents, without the sidebar.
 * Every rule is still enforced by the API; these only choose which screen to show.
 */
import { useEffect } from 'react';
import { LazyMotion, MotionConfig, domMax } from 'framer-motion';
import { AuthProvider, ConfirmProvider, LookupsProvider, ToastProvider, useAuth } from './context.jsx';
import Layout from './components/Layout.jsx';
import { Login, Setup, ChoosePassword } from './screens/Login.jsx';
import { applyTheme, getTheme } from './lib/theme.js';

export function Providers({ children }) {
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => { if (getTheme() === 'system') applyTheme(); };
    mq?.addEventListener?.('change', onChange);
    // Installable on phones (Add to Home Screen). The worker caches nothing; see public/sw.js.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>{children}</AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </MotionConfig>
    </LazyMotion>
  );
}

const Centered = ({ children }) => <div className="center-screen">{children}</div>;

function Gate({ children }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <Centered><div className="spinner" aria-label="Loading" /></Centered>;
  if (auth.status === 'error') return <Centered>Cannot reach the server: {auth.error}</Centered>;
  if (auth.status === 'setup') return <Setup />;
  if (auth.status !== 'authed') return <Login />;
  if (auth.user.mustChangePassword) return <ChoosePassword />;
  return <LookupsProvider>{children}</LookupsProvider>;
}

export function AppShell({ children }) {
  return <Gate><Layout>{children}</Layout></Gate>;
}

export function PrintShell({ children }) {
  return <Gate>{children}</Gate>;
}
