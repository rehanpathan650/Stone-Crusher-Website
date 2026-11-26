import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'framer-motion';
import Icon from './Icon.jsx';
import { usePopover } from './Layout.jsx';
import { api } from '../lib/api.js';
import { menuMotion } from '../lib/motion.js';

const KEY = 'scm.dismissed';
const readDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const saveDismissed = s => { try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-300))); } catch { /* private mode */ } };
const ICON = { stock: 'box', service: 'wrench', diesel: 'fuel', royalty: 'shield2', overdue: 'wallet', expense: 'receipt' };
const GROUPS = [['high', 'Needs attention'], ['medium', 'Coming up'], ['low', 'For your information']];

/** Bell with live alerts (low stock, service due, overdue payments…). Dismissed alerts are remembered in this browser. */
export default function Notifications() {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(() => api('/notifications').then(d => setItems(d.items)).catch(() => {}), []);
  useEffect(() => { const t = setInterval(load, 5 * 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { load(); }, [location.pathname, load]);

  const visible = items.filter(i => !dismissed.has(i.id));
  const urgent = visible.some(i => i.severity === 'high');
  const dismiss = ids => { const s = new Set(dismissed); ids.forEach(id => s.add(id)); setDismissed(s); saveDismissed(s); };

  return (
    <div className="popover-anchor" ref={ref}>
      <button className={`icon-btn bell ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-label={`Alerts (${visible.length})`} aria-haspopup="dialog" aria-expanded={open}>
        <Icon name="bell" />
        <AnimatePresence>
          {visible.length > 0 && (
            <m.span key="count" className={`bell-count ${urgent ? 'urgent' : ''}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              {visible.length > 9 ? '9+' : visible.length}
            </m.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <m.div className="menu notif-panel" role="dialog" aria-label="Alerts" {...menuMotion}>
            <div className="notif-head">
              <div>
                <div className="notif-title">Alerts</div>
                <div className="notif-sub">{visible.length ? `${visible.length} open` : 'Nothing needs you right now'}</div>
              </div>
              {visible.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => dismiss(visible.map(i => i.id))}>Clear all</button>}
            </div>
            <div className="notif-scroll">
              {!visible.length ? (
                <div className="notif-empty">
                  <span className="notif-empty-icon"><Icon name="check" size={20} /></span>
                  <b>All clear</b>
                  <span>Low stock, service due and overdue payments will show up here.</span>
                </div>
              ) : GROUPS.map(([sev, label]) => {
                const group = visible.filter(i => i.severity === sev);
                if (!group.length) return null;
                return (
                  <section key={sev} className="notif-group">
                    <div className="notif-group-label">{label}</div>
                    <AnimatePresence initial={false}>
                      {group.map(i => (
                        <m.div key={i.id} layout className={`notif-item sev-${i.severity}`}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}>
                          <button className="notif-main" onClick={() => { setOpen(false); navigate(i.link); }}>
                            <span className="notif-icon"><Icon name={ICON[i.kind] || 'alert'} size={16} /></span>
                            <span className="notif-text">
                              <span className="notif-item-title">{i.title}</span>
                              <span className="notif-item-body">{i.body}</span>
                            </span>
                          </button>
                          <button className="icon-btn notif-dismiss" title="Dismiss" aria-label={`Dismiss: ${i.title}`} onClick={() => dismiss([i.id])}><Icon name="x" size={14} /></button>
                        </m.div>
                      ))}
                    </AnimatePresence>
                  </section>
                );
              })}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
