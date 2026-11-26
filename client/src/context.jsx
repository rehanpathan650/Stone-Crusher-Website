import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setCsrf, setOnUnauthorized } from './lib/api.js';
import { setCurrency } from './lib/format.js';
import { AnimatePresence, m } from 'framer-motion';
import Modal from './components/Modal.jsx';
import Icon from './components/Icon.jsx';

/* ---------------- Auth ---------------- */
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading' });
  // Business name and logo for the sign-in screen (public, from /auth/status)
  const [brand, setBrand] = useState({ businessName: '', logo: '' });
  const loadStatus = useCallback(async () => {
    const s = await api('/auth/status').catch(() => ({ needsSetup: false }));
    setBrand({ businessName: s.businessName || '', logo: s.logo || '' });
    return s;
  }, []);

  const applyMe = me => {
    setCsrf(me.csrfToken);
    setState({ status: 'authed', user: me.user, permissions: me.permissions });
  };

  const refresh = useCallback(async () => {
    try {
      applyMe(await api('/auth/me'));
    } catch (e) {
      if (e.status === 401) {
        const s = await loadStatus();
        setState({ status: s.needsSetup ? 'setup' : 'anon' });
      } else {
        setState({ status: 'error', error: e.message });
      }
    }
  }, [loadStatus]);

  useEffect(() => {
    setOnUnauthorized(() => { setCsrf(null); setState({ status: 'anon', expired: true }); loadStatus(); });
    refresh();
    loadStatus(); // branding is also shown on the choose-password screen, while signed in
  }, [refresh, loadStatus]);

  const value = useMemo(() => ({
    ...state,
    brand,
    refresh,
    /** After choosing a new password the server returns the updated user (flag cleared). */
    changePassword: async (currentPassword, newPassword) => applyMe(await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } })),
    login: async (email, password) => applyMe(await api('/auth/login', { method: 'POST', body: { email, password } })),
    setup: async body => applyMe(await api('/auth/setup', { method: 'POST', body })),
    logout: async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      setCsrf(null);
      setState({ status: 'anon' });
      loadStatus();
    },
    can: (area, action = 'read') => Boolean(state.permissions?.[area]?.[action]),
  }), [state, brand, refresh, loadStatus]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

/* ---------------- Lookups (dropdown data + settings) ---------------- */
const LookupsCtx = createContext(null);
const EMPTY = { materials: [], parties: [], employees: [], vehicles: [], settings: {}, enums: { units: [], payModes: [], expenseCategories: [], shifts: [], vehicleKinds: [] } };

export function LookupsProvider({ children }) {
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try {
      const d = await api('/lookups');
      setCurrency(d.settings?.currency);
      setData(d);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const value = useMemo(() => ({ ...data, ready, reload }), [data, ready, reload]);
  return <LookupsCtx.Provider value={value}>{children}</LookupsCtx.Provider>;
}
export const useLookups = () => useContext(LookupsCtx);

/* ---------------- Toasts ---------------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const toast = useCallback((message, type = 'info') => {
    const k = ++id.current;
    setItems(xs => [...xs, { k, message, type }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.k !== k)), type === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map(t => (
            <m.div key={t.k} layout className={`toast ${t.type}`}
              initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}>
              <span className="toast-icon"><Icon name={t.type === 'error' ? 'alert' : 'check'} size={14} strokeWidth={2.4} /></span>
              <span>{t.message}</span>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- Confirm dialog ---------------- */
const ConfirmCtx = createContext(async () => false);
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const confirm = useCallback(opts => new Promise(resolve => setReq({ ...opts, resolve })), []);
  const close = v => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal title={req.title || 'Are you sure?'} size="sm" onClose={() => close(false)}>
          <p className="confirm-text">{req.message}</p>
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>
              {req.confirmLabel || 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
