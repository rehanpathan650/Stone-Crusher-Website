import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { NAV, allowed } from './Layout.jsx';
import { useAuth } from '../context.jsx';
import { dialogMotion, overlayMotion } from '../lib/motion.js';

/** "New …" shortcuts open the list page with its create form (deep link ?new=1). */
const ACTIONS = [
  { label: 'New sale / dispatch', to: '/sales?new=1', icon: 'truck', perm: ['sales', 'write'], keywords: 'bill invoice challan dispatch' },
  { label: 'New weighment (weighbridge)', to: '/weighments?new=1', icon: 'scale', perm: ['weighments', 'write'], keywords: 'weigh slip gross tare kanta' },
  { label: 'New production entry', to: '/production?new=1', icon: 'factory', perm: ['production', 'write'] },
  { label: 'New expense', to: '/expenses?new=1', icon: 'wallet', perm: ['expenses', 'write'] },
  { label: 'New payment', to: '/payments?new=1', icon: 'card', perm: ['payments', 'write'], keywords: 'receipt received' },
  { label: 'New purchase', to: '/purchases?new=1', icon: 'inbox', perm: ['purchases', 'write'] },
  { label: 'New diesel entry', to: '/diesel_logs?new=1', icon: 'fuel', perm: ['diesel_logs', 'write'], keywords: 'fuel fill' },
  { label: 'Report a breakdown / service', to: '/maintenance?new=1', icon: 'wrench', perm: ['maintenance', 'write'], keywords: 'repair' },
  { label: 'New customer or supplier', to: '/parties?new=1', icon: 'users', perm: ['parties', 'write'] },
  { label: 'Outstanding / ageing report', to: '/reports?tab=ageing', icon: 'chart', perm: ['finance'], keywords: 'due overdue receivable' },
  { label: 'GST returns', to: '/reports?tab=gst', icon: 'chart', perm: ['finance'], keywords: 'gstr tax' },
  { label: 'Cash & bank book', to: '/reports?tab=cashbook', icon: 'chart', perm: ['finance'], keywords: 'cashbook daily closing' },
];

/** Ctrl+K / ⌘K: jump to any page or start a new entry by typing. */
export default function CommandPalette() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onOpen);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('open-command-palette', onOpen); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const items = useMemo(() => {
    const pages = NAV.flatMap(g => g.items.filter(it => allowed(it, can)).map(it => ({ label: it.label, to: it.to, icon: it.icon, group: g.section || 'Go to' })));
    const acts = ACTIONS.filter(a => can(...a.perm)).map(a => ({ ...a, group: 'Actions' }));
    const all = [...acts, ...pages];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? all.filter(i => words.every(w => `${i.label} ${i.keywords || ''} ${i.group}`.toLowerCase().includes(w))) : all;
  }, [q, can]);

  if (!open) return null;
  const go = i => { setOpen(false); navigate(i.to); };
  const onKey = e => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && items[active]) go(items[active]);
  };

  return createPortal(
    <m.div className="overlay palette-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }} {...overlayMotion}>
      <m.div className="palette" role="dialog" aria-modal="true" aria-label="Search pages and actions" {...dialogMotion}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
            placeholder="Type a page or action… e.g. “new sale”, “gst”" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox">
          {!items.length && <div className="palette-empty">No matches</div>}
          {items.map((i, idx) => (
            <button key={i.to + i.label} role="option" aria-selected={idx === active} className={idx === active ? 'active' : ''}
              onMouseEnter={() => setActive(idx)} onClick={() => go(i)}>
              <Icon name={i.icon} size={16} /> <span>{i.label}</span> <small>{i.group}</small>
            </button>
          ))}
        </div>
      </m.div>
    </m.div>,
    document.body
  );
}
