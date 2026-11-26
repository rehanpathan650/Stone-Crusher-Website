import { useEffect, useState } from 'react';
import { PageHeader, Field, NoAccess } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { useAuth, useLookups, useToast } from '../context.jsx';

const SECTIONS = [
  { title: 'Business', fields: [
    ['business_name', 'Business name', { full: true, required: true }],
    ['address', 'Address', { full: true }],
    ['state', 'State', { type: 'state', hint: 'Customers in another state are billed IGST' }],
    ['phone', 'Phone'],
    ['email', 'Email', { type: 'email' }],
    ['gstin', 'GSTIN'],
  ] },
  { title: 'Numbering', fields: [
    ['bill_prefix', 'Invoice prefix', { hint: 'Bills are numbered like INV/2026-27/0001' }],
    ['credit_prefix', 'Credit note prefix', { hint: 'Credit notes: CN/2026-27/0001' }],
    ['currency', 'Currency symbol'],
  ] },
  { title: 'Opening balances (cash & bank books)', fields: [
    ['opening_cash', 'Cash in hand when you started', { type: 'number' }],
    ['opening_bank', 'Bank balance when you started', { type: 'number' }],
  ] },
  { title: 'Alerts & defaults', fields: [
    ['diesel_rate', 'Default diesel rate per litre', { type: 'number', hint: 'Used until a fill with a rate is entered' }],
    ['royalty_alert_qty', 'Warn when royalty balance below (tons)', { type: 'number' }],
    ['large_expense', 'Alert on single expenses above', { type: 'number', hint: '0 turns this alert off' }],
  ] },
  { title: 'Bank details (printed on invoices)', fields: [
    ['bank_name', 'Bank name'],
    ['bank_account', 'Account number'],
    ['bank_ifsc', 'IFSC'],
    ['bank_branch', 'Branch'],
    ['upi_id', 'UPI ID'],
  ] },
  { title: 'Invoice terms', fields: [
    ['invoice_terms', 'Terms and conditions', { full: true, type: 'textarea' }],
  ] },
];

const MAX_LOGO = 300 * 1024;

export default function Settings() {
  const { can } = useAuth();
  const L = useLookups();
  const toast = useToast();
  const [v, setV] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/settings').then(setV).catch(e => toast(e.message, 'error')); }, [toast]);
  if (!can('settings', 'write')) return <NoAccess />;

  const set = (k, val) => { setV(x => ({ ...x, [k]: val })); setErrors(e => ({ ...e, [k]: undefined })); };

  const pickLogo = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Choose a PNG, JPEG or WebP image', 'error');
    if (file.size > MAX_LOGO) return toast('Logo must be 300 KB or smaller', 'error');
    const reader = new FileReader();
    reader.onload = () => set('logo', String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      setV(await api('/settings', { method: 'PUT', body: v }));
      setErrors({});
      L.reload();
      toast('Settings saved');
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const input = (k, opt = {}) => {
    if (opt.type === 'state') {
      return (
        <select id={k} value={v[k] ?? ''} onChange={e => set(k, e.target.value)}>
          <option value="">Select…</option>
          {L.enums.states?.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    if (opt.type === 'textarea') return <textarea id={k} rows={3} value={v[k] ?? ''} maxLength={1000} onChange={e => set(k, e.target.value)} />;
    return <input id={k} type={opt.type || 'text'} value={v[k] ?? ''} onChange={e => set(k, e.target.value)} />;
  };

  return (
    <>
      <PageHeader title="Business settings" description="Shown on invoices, challans, ledgers and reports." />
      <form onSubmit={submit} style={{ maxWidth: 760 }}>
        {!v ? <div className="card"><div className="loading-bar" /></div> : (
          <>
            <div className="card section-card">
              <h3 className="section-title">Logo</h3>
              <div className="logo-row">
                <div className="logo-preview">{v.logo ? <img src={v.logo} alt="Business logo" /> : <Icon name="mountain" size={28} />}</div>
                <div>
                  <label className="btn">
                    <Icon name="upload" size={16} /> {v.logo ? 'Change logo' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} hidden />
                  </label>
                  {v.logo && <button type="button" className="btn btn-ghost" onClick={() => set('logo', '')}>Remove</button>}
                  <div className="field-hint">PNG, JPEG or WebP, up to 300 KB. Printed on invoices.</div>
                  {errors.logo && <div className="field-error">{errors.logo}</div>}
                </div>
              </div>
            </div>
            {SECTIONS.map(sec => (
              <div key={sec.title} className="card section-card">
                <h3 className="section-title">{sec.title}</h3>
                <div className="form-grid">
                  {sec.fields.map(([k, label, opt = {}]) => (
                    <Field key={k} label={label} full={opt.full} required={opt.required} error={errors[k]} hint={opt.hint} htmlFor={k}>
                      {input(k, opt)}
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
        <div className="form-foot sticky-foot">
          <span className="spacer" />
          <button className="btn btn-primary" disabled={saving || !v}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>
    </>
  );
}
