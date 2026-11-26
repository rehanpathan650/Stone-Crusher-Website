'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Searchable select for long lists (customers, materials, vehicles). Type to filter, arrows + Enter to pick.
 * Behaves like a <select>: value is the option's value, onChange receives the new value.
 */
export default function Combobox({ id, value, options, onChange, placeholder = 'Select…', onEnterNext }) {
  const listId = useId();
  const selected = options.find(([v]) => String(v) === String(value ?? ''));
  const [text, setText] = useState(selected?.[1] || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef(null);

  useEffect(() => { if (!open) setText(selected?.[1] || ''); }, [selected, open]);
  useEffect(() => {
    const close = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const filtered = useMemo(() => {
    const words = (open && text !== (selected?.[1] || '') ? text : '').toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? options.filter(([, l]) => words.every(w => String(l).toLowerCase().includes(w))) : options;
  }, [options, text, open, selected]);

  const pick = opt => {
    onChange(opt ? opt[0] : '');
    setText(opt ? opt[1] : '');
    setOpen(false);
  };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') {
      if (open && filtered[active]) { e.preventDefault(); e.stopPropagation(); pick(filtered[active]); onEnterNext?.(); }
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setText(selected?.[1] || ''); }
  };

  return (
    <div className="combo" ref={wrap}>
      <input id={id} value={text} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        onFocus={e => { e.target.select(); setOpen(true); setActive(Math.max(0, filtered.findIndex(([v]) => String(v) === String(value)))); }}
        onChange={e => { setText(e.target.value); setOpen(true); setActive(0); if (!e.target.value) onChange(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey} />
      {open && (
        <div className="combo-list" id={listId} role="listbox">
          {!filtered.length ? <div className="combo-empty">No matches</div> : filtered.slice(0, 200).map(([v, l], i) => (
            <div key={v} role="option" aria-selected={String(v) === String(value)} className={`${i === active ? 'active' : ''} ${String(v) === String(value) ? 'selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick([v, l]); }} onMouseEnter={() => setActive(i)}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
