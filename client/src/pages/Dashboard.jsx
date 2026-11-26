import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import RecordForm from '../components/RecordForm.jsx';
import { PageHeader, Stat, StatGrid, Empty, Badge } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDate, fmtMoney, fmtNum, shortMoney } from '../lib/format.js';

/** "▲ 12% vs same days last month" */
const Trend = ({ v }) => (v == null ? null : (
  <span className={`trend ${v >= 0 ? 'up' : 'down'}`}>{v >= 0 ? '▲' : '▼'} {Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}% vs last month</span>
));
import { useAuth, useToast } from '../context.jsx';

function BarChart({ series }) {
  const W = 720, H = 240, padL = 44, padB = 22, top = 10;
  const max = Math.max(1, ...series.flatMap(d => [d.sales, d.costs]));
  const bw = (W - padL) / series.length;
  const y = v => H - padB - (v / max) * (H - padB - top);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Sales and costs, last 14 days">
      {[0, 0.5, 1].map(f => (
        <g key={f}>
          <line className="grid-line" x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} />
          <text x={padL - 6} y={y(max * f) + 3} textAnchor="end">{shortMoney(max * f)}</text>
        </g>
      ))}
      {series.map((d, i) => {
        const x = padL + i * bw;
        return (
          <g key={d.date}>
            <rect className="bar-a" x={x + bw * 0.16} y={y(d.sales)} width={bw * 0.32} height={H - padB - y(d.sales)} rx="2">
              <title>{`${fmtDate(d.date)} · Sales ${fmtMoney(d.sales)}`}</title>
            </rect>
            <rect className="bar-b" x={x + bw * 0.52} y={y(d.costs)} width={bw * 0.32} height={H - padB - y(d.costs)} rx="2">
              <title>{`${fmtDate(d.date)} · Costs ${fmtMoney(d.costs)}`}</title>
            </rect>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle">{d.date.slice(8)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const fin = can('finance');

  const load = () => api('/dashboard').then(setD).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxStock = d ? Math.max(1, ...d.stock.map(s => s.current)) : 1;
  const lowCount = d?.stock.filter(s => s.low).length || 0;

  return (
    <>
      <PageHeader title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`} description="Here is how the business is doing today.">
        {can('production', 'write') && <button className="btn" onClick={() => setForm('production')}><Icon name="plus" size={16} /> Production</button>}
        {can('expenses', 'write') && <button className="btn" onClick={() => setForm('expenses')}><Icon name="plus" size={16} /> Expense</button>}
        {can('sales', 'write') && <button className="btn btn-primary" onClick={() => setForm('sales')}><Icon name="plus" size={16} /> New sale</button>}
      </PageHeader>

      {!d ? (
        <div className="stats" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card stat"><div className="skeleton" style={{ width: '40%' }} /><div className="skeleton tall" /><div className="skeleton" style={{ width: '60%' }} /></div>)}</div>
      ) : (
        <>
          <StatGrid className="stats-3">
            <Stat label="Today's sales" value={fin ? fmtMoney(d.today.sales.amount) : d.today.sales.count} sub={`${d.today.sales.count} dispatches · ${fmtNum(d.today.sales.qty)} units`} />
            <Stat label="Today's production" value={fmtNum(d.today.productionQty)} sub={<>{fmtNum(d.month.productionQty)} this month <Trend v={d.trend?.production} /></>} />
            {d.weighbridge && can('weighments') && (
              <Stat label="Weighbridge today" value={`${d.weighbridge.today} slips`}
                sub={d.weighbridge.unbilled ? <Link to="/weighments">{d.weighbridge.unbilled} loaded slip{d.weighbridge.unbilled > 1 ? 's' : ''} not billed yet</Link> : 'All loaded slips are billed'} />
            )}
            {fin
              ? <Stat label="Sales this month" value={fmtMoney(d.month.sales.amount)} sub={<>{d.month.sales.count} dispatches <Trend v={d.trend?.salesAmount} /></>} />
              : <Stat label="Dispatched this month" value={fmtNum(d.month.sales.qty)} sub={<>{d.month.sales.count} dispatches <Trend v={d.trend?.salesQty} /></>} />}
            {fin && <Stat label="Costs this month" value={fmtMoney(d.month.expenses + d.month.purchases)} sub={`Expenses ${fmtMoney(d.month.expenses)} · Purchases ${fmtMoney(d.month.purchases)}`} />}
            {fin && <Stat label="Profit this month" value={fmtMoney(d.month.profit)} tone={d.month.profit >= 0 ? 'pos' : 'neg'} sub="Revenue excl. GST, minus costs" />}
            {fin && <Stat label="To receive" value={fmtMoney(d.receivable)} sub={`To pay suppliers ${fmtMoney(d.payable)}`} />}
          </StatGrid>

          <div className="grid grid-3-1">
            {fin ? (
              <div className="card">
                <div className="card-head"><h3>Last 14 days</h3></div>
                <div className="card-body">
                  <BarChart series={d.series} />
                  <div className="legend"><span><i className="a" />Sales</span><span><i className="b" />Expenses + purchases</span></div>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="card-head"><h3>Recent dispatches</h3></div>
                <RecentTable rows={d.recent} fin={false} />
              </div>
            )}
            <div className="card">
              <div className="card-head">
                <h3>Stock</h3>
                {lowCount > 0 && <Badge tone="red">{lowCount} low</Badge>}
                <span className="spacer" />
                <Link to="/stock" className="muted" style={{ fontSize: 13 }}>View all</Link>
              </div>
              <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {d.stock.map(s => (
                  <div className="stock-row" key={s.id}>
                    <span className="name">{s.name}</span>
                    <span className="num">{fmtNum(s.current)} <span className="muted">{s.unit}</span></span>
                    <div className={`meter ${s.low ? 'low' : ''}`}><span style={{ width: `${(Math.max(0, s.current) / maxStock) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {fin && (
            <div className="grid grid-3-1 mt">
              <div className="card">
                <div className="card-head"><h3>Recent dispatches</h3><span className="spacer" /><Link to="/sales" className="muted" style={{ fontSize: 13 }}>View all</Link></div>
                <RecentTable rows={d.recent} fin />
              </div>
              <div className="card">
                <div className="card-head"><h3>Highest outstanding</h3></div>
                {d.topDues.length ? (
                  <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                    {d.topDues.map(x => (
                      <div className="kv" key={x.id}><Link to={`/parties/${x.id}`}>{x.name}</Link><span className="num">{fmtMoney(x.balance)}</span></div>
                    ))}
                  </div>
                ) : <Empty title="Nothing outstanding" />}
              </div>
            </div>
          )}
        </>
      )}
      {form && <RecordForm name={form} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}

function RecentTable({ rows, fin }) {
  if (!rows.length) return <Empty title="No sales yet" />;
  return (
    <div className="table-wrap">
      <table className="table-cards">
        <thead><tr><th>Date</th><th>Customer</th><th>Material</th><th className="num">Quantity</th>{fin && <th className="num">Amount</th>}</tr></thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              <td>{fmtDate(s.date)}</td><td>{s.party_name}</td><td>{s.material_name}</td>
              <td className="num">{fmtNum(s.qty)} {s.unit}</td>{fin && <td className="num">{fmtMoney(s.amount)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
