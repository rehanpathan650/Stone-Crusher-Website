import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PageHeader, Field, Empty, NoAccess, Badge, Stat, StatGrid } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDate, fmtNum, monthStart, today } from '../lib/format.js';
import { quickRange, QUICK_RANGES } from '../lib/dates.js';
import { useAuth, useToast } from '../context.jsx';

const TONE = { Purchase: 'blue', Production: 'green', Return: 'green', 'Used in crushing': 'amber', Dispatch: 'gray' };

/** Every movement of one material in a period, with opening and running balance. */
export default function StockLedger() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!can('stock')) return;
    setD(null);
    api(`/stock/${id}/ledger`, { query: range }).then(setD).catch(e => toast(e.message, 'error'));
  }, [id, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('stock')) return <NoAccess />;
  const unit = d?.material.unit || '';

  return (
    <>
      <PageHeader title={d ? `${d.material.name} · stock movements` : 'Stock movements'} description="Every quantity in and out, with the running balance.">
        <Link className="btn" to="/stock"><Icon name="chevronLeft" size={16} /> All stock</Link>
        <button className="btn" onClick={() => window.print()}><Icon name="printer" size={16} /> Print</button>
      </PageHeader>
      {d && (
        <StatGrid>
          <Stat label="Opening" value={`${fmtNum(d.opening, 3)} ${unit}`} sub={range.from ? `On ${fmtDate(range.from)}` : 'From the start'} />
          <Stat label="In" value={`${fmtNum(d.totalIn, 3)} ${unit}`} tone="pos" sub="Purchased, produced, returned" />
          <Stat label="Out" value={`${fmtNum(d.totalOut, 3)} ${unit}`} tone="neg" sub="Dispatched or used in crushing" />
          <Stat label="Closing" value={`${fmtNum(d.closing, 3)} ${unit}`} tone={d.closing < 0 ? 'neg' : ''} />
        </StatGrid>
      )}
      <div className="card">
        <div className="toolbar no-print">
          <Field label="From"><input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></Field>
          <Field label="To"><input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></Field>
          <Field label="Period">
            <select value="" onChange={e => e.target.value && setRange(quickRange(e.target.value))}>
              <option value="">Choose…</option>
              {QUICK_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        {!d ? <div className="loading-bar" /> : !d.rows.length ? <Empty title="No movements in this period" icon="box" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>Date</th><th>Movement</th><th>Details</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <tr className="muted"><td>{range.from ? fmtDate(range.from) : '—'}</td><td>Opening balance</td><td /><td /><td /><td className="num">{fmtNum(d.opening, 3)}</td></tr>
                {d.rows.map((r, i) => (
                  <tr key={`${r.ref}-${i}`}>
                    <td>{fmtDate(r.date)}</td>
                    <td><Badge tone={TONE[r.type] || 'gray'}>{r.type}</Badge></td>
                    <td className="wrap">{r.desc}</td>
                    <td className="num pos">{r.in ? fmtNum(r.in, 3) : ''}</td>
                    <td className="num neg">{r.out ? fmtNum(r.out, 3) : ''}</td>
                    <td className={`num ${r.balance < 0 ? 'neg' : ''}`}><b>{fmtNum(r.balance, 3)}</b></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td /><td className="num">{fmtNum(d.totalIn, 3)}</td><td className="num">{fmtNum(d.totalOut, 3)}</td><td className="num">{fmtNum(d.closing, 3)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
