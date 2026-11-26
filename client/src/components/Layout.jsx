import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'framer-motion';
import Icon from './Icon.jsx';
import { useAuth, useLookups } from '../context.jsx';
import { initials } from '../lib/format.js';
import Notifications from './Notifications.jsx';
import CommandPalette from './CommandPalette.jsx';
import { THEMES, getTheme, setTheme } from '../lib/theme.js';
import { menuMotion, pageMotion, spring } from '../lib/motion.js';
import { watchTableCards } from '../lib/tableCards.js';

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', accountant: 'Accountant', operator: 'Operator' };

export const NAV = [
  { section: null, items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  { section: 'Operations', items: [
    { to: '/weighments', label: 'Weighbridge', icon: 'scale', perm: 'weighments' },
    { to: '/sales', label: 'Sales & Dispatch', icon: 'truck', perm: 'sales' },
    { to: '/credit_notes', label: 'Credit Notes', icon: 'undo', perm: 'credit_notes' },
    { to: '/purchases', label: 'Purchases', icon: 'inbox', perm: 'purchases' },
    { to: '/production', label: 'Production', icon: 'factory', perm: 'production' },
    { to: '/stock', label: 'Stock', icon: 'box', perm: 'stock' },
    { to: '/royalty_permits', label: 'Royalty & Permits', icon: 'shield2', perm: 'royalty_permits' },
  ] },
  { section: 'Machinery', items: [
    { to: '/vehicles', label: 'Vehicles & Machines', icon: 'car', perm: 'vehicles' },
    { to: '/diesel_logs', label: 'Diesel Log', icon: 'fuel', perm: 'diesel_logs' },
    { to: '/maintenance', label: 'Maintenance', icon: 'wrench', perm: 'maintenance' },
  ] },
  { section: 'Finance', items: [
    { to: '/expenses', label: 'Expenses', icon: 'wallet', perm: 'expenses' },
    { to: '/payments', label: 'Payments', icon: 'card', perm: 'payments' },
    { to: '/reports', label: 'Reports', icon: 'chart', perm: 'finance' },
  ] },
  { section: 'Records', items: [
    { to: '/parties', label: 'Customers & Suppliers', icon: 'users', perm: 'parties' },
    { to: '/materials', label: 'Materials & Rates', icon: 'layers', perm: 'materials' },
    { to: '/employees', label: 'Employees', icon: 'helmet', perm: 'employees' },
    { to: '/attendance', label: 'Attendance & Payroll', icon: 'calendar', perm: ['attendance', 'payroll'] },
  ] },
  { section: 'Administration', items: [
    { to: '/users', label: 'Users & Access', icon: 'shield', perm: 'users' },
    { to: '/audit', label: 'Audit Log', icon: 'log', perm: 'audit' },
    { to: '/backup', label: 'Backup & Restore', icon: 'database', perm: 'backup' },
    { to: '/settings', label: 'Business Settings', icon: 'settings', perm: ['settings', 'write'], action: 'write' },
  ] },
];

export function allowed(item, can) {
  if (!item.perm) return true;
  if (item.action) return can(item.perm[0], item.action);
  return Array.isArray(item.perm) ? item.perm.some(p => can(p)) : can(item.perm);
}

/** Closes a popover when clicking outside it or pressing Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, ref };
}

function ThemeSwitch() {
  const [t, setT] = useState(getTheme);
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {THEMES.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={t === k} className={t === k ? 'on' : ''} onClick={() => { setTheme(k); setT(k); }}>
          {t === k && <m.span layoutId="theme-pill" className="theme-pill" transition={spring} />}
          <Icon name={k === 'dark' ? 'moon' : k === 'light' ? 'sun' : 'monitor'} size={14} /> <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Phone-sized screens: the most used pages one tap away, plus a big "new dispatch" button. */
function BottomNav({ can }) {
  const navigate = useNavigate();
  const items = [
    { to: '/', label: 'Home', icon: 'dashboard' },
    { to: '/sales', label: 'Sales', icon: 'truck', perm: 'sales' },
    can('sales', 'write') ? { action: () => navigate('/sales?new=1'), label: 'Dispatch', icon: 'plus', primary: true } : null,
    { to: '/production', label: 'Production', icon: 'factory', perm: 'production' },
    { action: () => window.dispatchEvent(new Event('open-command-palette')), label: 'More', icon: 'grid' },
  ].filter(Boolean).filter(i => !i.perm || can(i.perm));
  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      {items.map(i => (i.to ? (
        <NavLink key={i.label} to={i.to} end={i.to === '/'}>
          {({ isActive }) => (
            <>
              {isActive && <m.span layoutId="bottom-pill" className="bottom-pill" transition={spring} />}
              <Icon name={i.icon} size={20} /><span>{i.label}</span>
            </>
          )}
        </NavLink>
      ) : (
        <m.button key={i.label} type="button" className={i.primary ? 'primary' : ''} onClick={i.action} whileTap={{ scale: 0.92 }} aria-label={i.label}>
          <Icon name={i.icon} size={i.primary ? 24 : 20} strokeWidth={i.primary ? 2.2 : 1.8} /><span>{i.label}</span>
        </m.button>
      )))}
    </nav>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar">{initials(user.name)}</span>
        <span className="user-meta"><b>{user.name}</b><span>{ROLE_LABELS[user.role]}</span></span>
        <Icon name="chevronDown" size={15} className="user-chevron" />
      </button>
      <AnimatePresence>
        {open && (
          <m.div className="menu" role="menu" {...menuMotion}>
            <div className="menu-profile">
              <span className="avatar lg">{initials(user.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="menu-name">{user.name}</div>
                <div className="menu-email">{user.email}</div>
              </div>
            </div>
            <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); navigate('/account'); }}>
              <Icon name="user" size={16} /> Account & security
            </button>
            <div className="menu-label">Appearance</div>
            <ThemeSwitch />
            <div className="menu-sep" />
            <button className="menu-item danger" role="menuitem" onClick={logout}><Icon name="logout" size={16} /> Sign out</button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Layout() {
  const { can } = useAuth();
  const { settings } = useLookups();
  const [open, setOpen] = useState(false);
  const [badLogo, setBadLogo] = useState('');
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  const logo = settings?.logo && settings.logo !== badLogo ? settings.logo : '';
  const mainRef = useRef(null);
  useEffect(() => (mainRef.current ? watchTableCards(mainRef.current) : undefined), []);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            {logo ? <img src={logo} alt="" onError={() => setBadLogo(logo)} /> : <Icon name="mountain" size={18} strokeWidth={2} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">{settings?.business_name || 'Stone Crusher'}</div>
            <div className="brand-sub">Business Manager</div>
          </div>
          <button className="icon-btn drawer-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <nav className="nav">
          {NAV.map((g, i) => {
            const items = g.items.filter(it => allowed(it, can));
            if (!items.length) return null;
            return (
              <div key={i} className="nav-group">
                {g.section && <div className="nav-section">{g.section}</div>}
                {items.map(it => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/'}>
                    {({ isActive }) => (
                      <>
                        {isActive && <m.span layoutId="nav-active" className="nav-active" transition={spring} />}
                        <Icon name={it.icon} size={17} /> <span>{it.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <button className="sidebar-search" onClick={() => window.dispatchEvent(new Event('open-command-palette'))}>
          <Icon name="command" size={14} /> Quick actions <kbd>Ctrl K</kbd>
        </button>
      </aside>
      <AnimatePresence>
        {open && <m.div className="scrim" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      <div className="main" ref={mainRef}>
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <button className="search-trigger" onClick={() => window.dispatchEvent(new Event('open-command-palette'))} aria-label="Search pages and actions (Ctrl+K)">
            <Icon name="search" size={16} /><span>Search or jump to…</span><kbd>Ctrl K</kbd>
          </button>
          <span className="spacer" />
          <Notifications />
          <UserMenu />
        </header>
        <m.main className="content" key={location.pathname} {...pageMotion}>
          <Outlet />
        </m.main>
      </div>
      <BottomNav can={can} />
      <CommandPalette />
    </div>
  );
}
