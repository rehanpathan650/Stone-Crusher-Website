import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal.jsx';
import Combobox from './Combobox.jsx';
import { Field } from './ui.jsx';
import { api } from '../lib/api.js';
import { useAuth, useConfirm, useLookups, useToast } from '../context.jsx';
import { RESOURCES } from '../resources.jsx';

function Input({ f, value, onChange, L, values, onEnterNext }) {
  const id = `f_${f.key}`;
  if (f.type === 'readonly') return <div id={id} className="readonly-value mono">{f.display ? f.display(values) : value}</div>;
  if (f.type === 'select') {
    const options = typeof f.options === 'function' ? f.options(L, values) : f.options;
    if (options.length > 7) {
      return <Combobox id={id} value={value} options={options} placeholder={f.placeholder || 'Type to search…'} onChange={v => onChange(f.key, v)} onEnterNext={onEnterNext} />;
    }
    return (
      <select id={id} value={value ?? ''} onChange={e => onChange(f.key, e.target.value)}>
        <option value="">{f.placeholder || 'Select…'}</option>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    );
  }
  if (f.type === 'checkbox') {
    return (
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => onChange(f.key, e.target.checked)} /> {f.checkLabel || f.label}
      </label>
    );
  }
  if (f.type === 'textarea') {
    return <textarea id={id} value={value ?? ''} maxLength={f.max || 500} onChange={e => onChange(f.key, e.target.value)} />;
  }
  return (
    <>
      <input
        id={id}
        type={f.type || 'text'}
        value={value ?? ''}
        step={f.type === 'number' ? 'any' : undefined}
        inputMode={f.type === 'number' ? 'decimal' : undefined}
        maxLength={f.max}
        list={f.list ? `${id}_list` : undefined}
        autoComplete="off"
        onChange={e => onChange(f.key, e.target.value)}
      />
      {f.list && (
        <datalist id={`${id}_list`}>
          {f.list(L).map(v => <option key={v} value={v} />)}
        </datalist>
      )}
    </>
  );
}

/**
 * Create / edit a record of any resource defined in resources.jsx.
 * The server validates and recomputes everything; this form only previews totals.
 */
const DRAFT = name => `scm.draft.${name}`;
const readDraft = name => { try { return JSON.parse(localStorage.getItem(DRAFT(name)) || 'null'); } catch { return null; } };
const writeDraft = (name, v) => { try { v ? localStorage.setItem(DRAFT(name), JSON.stringify(v)) : localStorage.removeItem(DRAFT(name)); } catch { /* private mode */ } };

export default function RecordForm({ name, record, preset, onClose, onSaved }) {
  const cfg = RESOURCES[name];
  const L = useLookups();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !record?.id;
  // A new entry without a preset picks up an unsaved draft of the same kind (e.g. after an accidental close).
  const useDrafts = isNew && !preset;
  const [draft] = useState(() => (useDrafts ? readDraft(name) : null));
  const [values, setValues] = useState(() => ({ ...(cfg.defaults?.(L) || {}), ...(record || {}), ...(preset || {}), ...(draft?.values || {}) }));
  const [touched, setTouched] = useState(false);
  const formRef = useRef(null);
  useEffect(() => {
    if (!useDrafts || !touched) return undefined;
    const t = setTimeout(() => writeDraft(name, { values, at: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [values, touched, useDrafts, name]);
  const discardDraft = () => { writeDraft(name, null); setValues({ ...(cfg.defaults?.(L) || {}) }); setTouched(false); };
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => cfg.fields(L, values, can), [cfg, L, values, can]);

  const set = (key, v) => {
    setTouched(true);
    setValues(prev => {
      const next = { ...prev, [key]: v };
      return cfg.onChange ? { ...next, ...cfg.onChange(key, next, L) } : next;
    });
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const confirmed = useRef({}); // overrides already agreed to in this save (low stock, credit limit)
  const submit = async (e, extra = {}) => {
    Object.assign(confirmed.current, extra);
    extra = confirmed.current;
    e?.preventDefault();
    setSaving(true);
    setFormError('');
    const body = {};
    for (const f of fields) body[f.key] = values[f.key] === undefined ? (f.type === 'checkbox' ? false : '') : values[f.key];
    Object.assign(body, extra);
    try {
      const saved = await api(isNew ? `/${cfg.endpoint || name}` : `/${cfg.endpoint || name}/${record.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(`${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} ${isNew ? 'saved' : 'updated'}`);
      if (useDrafts) writeDraft(name, null);
      if (cfg.refreshLookups) L.reload();
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err.code === 'LOW_STOCK') {
        setSaving(false);
        const ok = await confirm({ title: 'Not enough stock', message: `${err.message} Save this sale anyway? Stock will show as negative until production or purchases are recorded.`, confirmLabel: 'Save anyway' });
        if (ok) return submit(null, { allow_negative_stock: true });
        return;
      }
      if (err.code === 'CREDIT_LIMIT' && err.details?.canOverride) {
        setSaving(false);
        const ok = await confirm({ title: 'Over credit limit', message: `${err.message} Save this bill anyway?`, confirmLabel: 'Save anyway' });
        if (ok) return submit(null, { allow_over_credit: true });
        return;
      }
      setErrors(err.fields || {});
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const summary = cfg.summary?.(values, L, can);

  /** Fast keyboard entry: Enter moves to the next field (saves on the last one); Ctrl+Enter saves from anywhere. */
  const focusNext = from => {
    const els = [...formRef.current.querySelectorAll('.form-grid input:not([disabled]):not([type=hidden]), .form-grid select:not([disabled]), .form-grid textarea')];
    const i = els.indexOf(from);
    if (i >= 0 && i < els.length - 1) els[i + 1].focus();
    else formRef.current.requestSubmit();
  };
  const onKeyDown = e => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); formRef.current.requestSubmit(); return; }
    const t = e.target;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.type === 'checkbox') return;
    e.preventDefault();
    focusNext(t);
  };

  return (
    <Modal title={`${isNew ? 'New' : 'Edit'} ${cfg.singular}`} onClose={onClose}>
      <form ref={formRef} onSubmit={submit} onKeyDown={onKeyDown} noValidate>
        {draft && !touched && (
          <div className="alert alert-info">
            Restored an unsaved entry from {new Date(draft.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.
            <button type="button" className="btn btn-ghost btn-sm" onClick={discardDraft}>Start fresh</button>
          </div>
        )}
        {formError && <div className="alert alert-error">{formError}</div>}
        <div className="form-grid">
          {fields.map(f => [
            f.section && <div key={`s-${f.section}`} className="form-section">{f.section}</div>,
            <Field key={f.key} label={f.type === 'checkbox' ? null : f.label} required={f.required} full={f.full} error={errors[f.key]} hint={f.hint} htmlFor={`f_${f.key}`}>
              <Input f={f} value={values[f.key]} onChange={set} L={L} values={values}
                onEnterNext={() => { const el = formRef.current?.querySelector(`#f_${f.key}`); if (el) focusNext(el); }} />
            </Field>,
          ])}
        </div>
        <div className="form-foot">
          {summary && <div className="form-summary">{summary}</div>}
          <span className="spacer" />
          <span className="kbd-hint">Enter: next field · Ctrl+Enter: save</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Save' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  );
}
