import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { amountInWords, fmtDate, fmtMoney, fmtNum } from '../lib/format.js';
import { useLookups } from '../context.jsx';

const monthName = m => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const STATUS = { P: 'Present', H: 'Half day', A: 'Absent' };

/** Printable monthly wage slip for one employee. */
export default function WageSlip() {
  const { employeeId, month } = useParams();
  const { settings, ready } = useLookups();
  const [slip, setSlip] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/payroll/slip', { query: { employee_id: employeeId, month } }).then(setSlip).catch(e => setError(e.message));
  }, [employeeId, month]);
  useEffect(() => { if (slip) document.title = `Wage slip ${slip.employee.name} ${month}`; }, [slip, month]);

  if (error) return <div className="center-screen">{error}</div>;
  if (!slip || !ready) return <div className="center-screen">Loading…</div>;
  const e = slip.employee;
  const lines = [
    [`Basic (${fmtNum(e.days, 1)} paid days)`, e.basic],
    e.ot_pay ? [`Overtime (${fmtNum(e.ot_hours, 1)} h × ${fmtMoney(e.ot_rate_effective)})`, e.ot_pay] : null,
    ...slip.adjustments.filter(a => a.kind === 'bonus').map(a => [`Bonus${a.note ? ` — ${a.note}` : ''}`, a.amount]),
  ].filter(Boolean);
  const deductions = slip.adjustments.filter(a => a.kind === 'deduction');

  return (
    <>
      <div className="doc-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} /> Print / Save PDF</button>
      </div>
      <div className="doc">
        <div className="doc-head">
          <div className="doc-company">
            {settings.logo && <img src={settings.logo} alt="" className="doc-logo" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <div>
              <h1>{settings.business_name}</h1>
              {settings.address && <div className="muted">{settings.address}</div>}
            </div>
          </div>
          <div className="doc-title">
            <h2>Wage slip</h2>
            <div>{monthName(month)}</div>
          </div>
        </div>
        <div className="doc-parties">
          <div>
            <div className="doc-label">Employee</div>
            <div style={{ fontWeight: 600 }}>{e.name}</div>
            {e.role && <div>{e.role}</div>}
            {e.phone && <div>Phone {e.phone}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="doc-label">Wage</div>
            <div>{fmtMoney(e.wage)} per {e.wage_type === 'monthly' ? 'month' : 'day'}</div>
            <div className="muted">Present {e.present} · Half {e.half} · Absent {e.absent}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Earnings</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {lines.map(([l, v]) => <tr key={l}><td>{l}</td><td className="num">{fmtMoney(v)}</td></tr>)}
            {deductions.map(d => <tr key={d.id}><td>Deduction{d.note ? ` — ${d.note}` : ''}</td><td className="num">−{fmtMoney(d.amount)}</td></tr>)}
            <tr className="doc-total"><td>Net for the month</td><td className="num">{fmtMoney(e.net)}</td></tr>
            {Math.abs(e.brought_forward) > 0.005 && (
              <tr><td>{e.brought_forward < 0 ? 'Advance outstanding from earlier months' : 'Balance from earlier months'}</td><td className="num">{fmtMoney(e.brought_forward)}</td></tr>
            )}
            {slip.payments.map(p => <tr key={p.id}><td>Paid {fmtDate(p.date)} ({p.mode}){p.description ? ` — ${p.description}` : ''}</td><td className="num">−{fmtMoney(p.amount)}</td></tr>)}
            <tr className="doc-total"><td>{e.due < 0 ? 'Advance carried forward' : 'Balance payable'}</td><td className="num">{fmtMoney(Math.abs(e.due))}</td></tr>
          </tbody>
        </table>
        {e.due > 0 && <p className="doc-words"><b>In words:</b> {amountInWords(e.due)}</p>}
        {slip.days.length > 0 && (
          <details className="no-print-details" open>
            <summary className="doc-label" style={{ marginTop: 16 }}>Attendance</summary>
            <div className="att-grid">
              {slip.days.map(d => (
                <span key={d.date} className={`att-day att-${d.status}`} title={`${fmtDate(d.date)}: ${STATUS[d.status]}${d.ot_hours ? `, ${d.ot_hours} h OT` : ''}`}>
                  {Number(d.date.slice(8))}<small>{d.status}{d.ot_hours ? `+${d.ot_hours}` : ''}</small>
                </span>
              ))}
            </div>
          </details>
        )}
        <div className="sign"><span>Employee's signature</span><span>For {settings.business_name}</span></div>
      </div>
    </>
  );
}
