import { useCallback, useEffect, useState } from 'react';
import RecordForm from '../components/RecordForm.jsx';
import Icon from '../components/Icon.jsx';
import { PageHeader, Field, Empty, NoAccess, Tabs } from '../components/ui.jsx';
import { api, exportUrl } from '../lib/api.js';
import { fmtMoney, fmtNum, today } from '../lib/format.js';
import { useAuth, useToast } from '../context.jsx';

const STATUSES = [['P', 'Present'], ['H', 'Half day'], ['A', 'Absent']];

function Daily() {
  const { can } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const canWrite = can('attendance', 'write');

  useEffect(() => {
    setRows(null);
    setDirty(false);
    api('/attendance', { query: { date } }).then(d => setRows(d.rows)).catch(e => toast(e.message, 'error'));
  }, [date, toast]);

  const update = (id, patch) => { setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); setDirty(true); };
  const mark = (r, status) => update(r.id, { status: r.status === status ? null : status, ot_hours: status === 'A' ? 0 : r.ot_hours });
  const allPresent = () => { setRows(rs => rs.map(r => ({ ...r, status: r.status || 'P' }))); setDirty(true); };
  const save = async () => {
    setSaving(true);
    try {
      await api('/attendance', { method: 'PUT', body: { date, entries: rows.map(r => ({ employee_id: r.id, status: r.status || null, ot_hours: Number(r.ot_hours) || 0 })) } });
      setDirty(false);
      toast('Attendance saved');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const count = s => rows?.filter(r => r.status === s).length || 0;
  const ot = rows?.reduce((a, r) => a + (Number(r.ot_hours) || 0), 0) || 0;

  return (
    <>
      <div className="toolbar">
        <Field label="Date"><input type="date" value={date} max={today()} onChange={e => e.target.value && setDate(e.target.value)} /></Field>
        <span style={{ flex: 1 }} />
        {canWrite && rows?.length > 0 && <button className="btn" onClick={allPresent}>Mark rest present</button>}
        {canWrite && <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save attendance'}</button>}
      </div>
      {!rows ? <div className="loading-bar" /> : !rows.length ? <Empty title="No active employees">Add employees first.</Empty> : (
        <>
          <div className="table-wrap">
            <table className="table-cards att-cards">
              <thead><tr><th>Employee</th><th>Role</th><th>Attendance</th><th className="num">Overtime (hours)</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}</td><td data-label="Role" className="muted">{r.role}</td>
                    <td data-label="Attendance">
                      <div className="segmented" role="group" aria-label={`Attendance for ${r.name}`}>
                        {STATUSES.map(([s, label]) => (
                          <button key={s} type="button" title={label} aria-pressed={r.status === s} disabled={!canWrite}
                            className={r.status === s ? `on-${s}` : ''} onClick={() => mark(r, s)}>{s}</button>
                        ))}
                      </div>
                    </td>
                    <td data-label="Overtime (h)" className="num">
                      <input className="ot-input" type="number" min="0" max="16" step="0.5" inputMode="decimal" aria-label={`Overtime hours for ${r.name}`}
                        value={r.ot_hours || ''} placeholder="0" disabled={!canWrite || !r.status || r.status === 'A'}
                        onChange={e => update(r.id, { ot_hours: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">Present {count('P')} · Half day {count('H')} · Absent {count('A')} · Not marked {rows.length - count('P') - count('H') - count('A')} · Overtime {fmtNum(ot, 1)} h</div>
        </>
      )}
    </>
  );
}

function Payroll() {
  const { can } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const load = useCallback(() => api('/payroll', { query: { month } }).then(setData).catch(e => toast(e.message, 'error')), [month, toast]);
  useEffect(() => { setData(null); load(); }, [load]);
  const sum = k => data.rows.reduce((a, r) => a + r[k], 0);
  const canPay = can('expenses', 'write'), canAdjust = can('payroll_adjustments', 'write');

  return (
    <>
      <div className="toolbar">
        <Field label="Month"><input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></Field>
        <span className="spacer" />
        <a className="btn" href={exportUrl('/reports/payroll.xlsx', { month })} download><Icon name="download" size={16} /> Excel</a>
      </div>
      {!data ? <div className="loading-bar" /> : !data.rows.length ? <Empty title="No employees" /> : (
        <>
          <div className="table-wrap">
            <table className="table-cards pay-cards">
              <thead>
                <tr>
                  <th>Employee</th><th className="num">Paid days</th><th className="num">OT hrs</th><th className="num">Basic</th><th className="num">Overtime</th>
                  <th className="num">Bonus</th><th className="num">Deduction</th><th className="num">Brought fwd</th><th className="num">Paid</th><th className="num">Balance</th>
                  <th className="actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}<div className="muted" style={{ fontSize: 12 }}>{fmtMoney(r.wage)} / {r.wage_type === 'monthly' ? 'month' : 'day'}{r.role ? ` · ${r.role}` : ''}</div></td>
                    <td data-label="Paid days" className="num" title={`Present ${r.present}, half ${r.half}, absent ${r.absent}`}>{fmtNum(r.days, 1)}</td>
                    <td data-label="OT hrs" className="num">{r.ot_hours ? fmtNum(r.ot_hours, 1) : '—'}</td>
                    <td data-label="Basic" className="num">{fmtMoney(r.basic)}</td>
                    <td data-label="Overtime" className="num">{r.ot_pay ? fmtMoney(r.ot_pay) : '—'}</td>
                    <td data-label="Bonus" className="num">{r.bonus ? fmtMoney(r.bonus) : '—'}</td>
                    <td data-label="Deduction" className="num">{r.deduction ? `−${fmtMoney(r.deduction)}` : '—'}</td>
                    <td data-label="Brought fwd" className={`num ${r.brought_forward < 0 ? 'neg' : ''}`} title={r.brought_forward < 0 ? 'Advance not yet recovered' : 'Owed from earlier months'}>
                      {r.brought_forward ? fmtMoney(r.brought_forward) : '—'}
                    </td>
                    <td data-label="Paid" className="num">{fmtMoney(r.paid)}</td>
                    <td data-label="Balance" className={`num ${r.due > 0 ? 'neg' : r.due < 0 ? 'pos' : ''}`}><b>{fmtMoney(r.due)}</b>{r.due < -0.005 && <div className="muted" style={{ fontSize: 11 }}>advance</div>}</td>
                    <td className="actions">
                      <span className="row-actions">
                        {canPay && r.due > 0.005 && <button className="btn btn-sm" onClick={() => setForm({ name: 'expenses', preset: { category: 'Wages / Salary', employee_id: r.id, amount: r.due, description: `Salary ${month} — ${r.name}` } })}>Pay</button>}
                        {canPay && <button className="btn btn-sm btn-ghost" onClick={() => setForm({ name: 'expenses', preset: { category: 'Wages / Salary', employee_id: r.id, description: `Advance — ${r.name}` } })}>Advance</button>}
                        {canAdjust && <button className="icon-btn" title="Bonus or deduction" aria-label="Bonus or deduction" onClick={() => setForm({ name: 'payroll_adjustments', preset: { month, employee_id: r.id, kind: 'bonus' } })}><Icon name="plus" size={16} /></button>}
                        <button className="icon-btn" title="Wage slip" aria-label="Wage slip" onClick={() => window.open(`/print/wageslip/${r.id}/${month}`, '_blank', 'noopener')}><Icon name="printer" size={16} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td><td className="empty-cell" /><td data-label="OT hrs" className="num">{fmtNum(sum('ot_hours'), 1)}</td><td data-label="Basic" className="num">{fmtMoney(sum('basic'))}</td><td data-label="Overtime" className="num">{fmtMoney(sum('ot_pay'))}</td>
                  <td data-label="Bonus" className="num">{fmtMoney(sum('bonus'))}</td><td data-label="Deduction" className="num">{fmtMoney(sum('deduction'))}</td><td data-label="Brought fwd" className="num">{fmtMoney(sum('brought_forward'))}</td>
                  <td data-label="Paid" className="num">{fmtMoney(sum('paid'))}</td><td data-label="Balance" className="num">{fmtMoney(sum('due'))}</td><td className="empty-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="pager">
            Basic = daily wage × paid days, or monthly salary ÷ {data.daysInMonth} × paid days (half day = 0.5). Overtime uses each employee's rate, or wage ÷ 8 hours (monthly: ÷ 26 days ÷ 8).
            Payments and advances are “Wages / Salary” expenses; unrecovered advances carry forward.
          </div>
        </>
      )}
      {form && <RecordForm name={form.name} preset={form.preset} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}

export default function Attendance() {
  const { can } = useAuth();
  const canDaily = can('attendance'), canPay = can('payroll');
  const [tab, setTab] = useState(canDaily ? 'daily' : 'payroll');
  if (!canDaily && !canPay) return <NoAccess />;
  return (
    <>
      <PageHeader title="Attendance & Payroll" description="Mark daily attendance and overtime, and settle monthly wages." />
      <div className="card">
        <Tabs id="attendance" value={tab} onChange={setTab}
          tabs={[canDaily && ['daily', 'Daily attendance'], canPay && ['payroll', 'Monthly payroll']].filter(Boolean)} />
        {tab === 'daily' ? <Daily /> : <Payroll />}
      </div>
    </>
  );
}
