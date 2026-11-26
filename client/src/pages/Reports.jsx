import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { PageHeader, Field, Empty, NoAccess, Badge, Stat, StatGrid, Tabs } from '../components/ui.jsx';
import { api, exportUrl } from '../lib/api.js';
import { fmtDate, fmtMoney, fmtNum, monthStart, today } from '../lib/format.js';
import { quickRange, QUICK_RANGES } from '../lib/dates.js';
import { useAuth, useLookups, useToast } from '../context.jsx';

const KV = ({ label, value, cls = '' }) => <div className={`kv ${cls}`}><span>{label}</span><span className="num">{value}</span></div>;

export { quickRange, QUICK_RANGES } from '../lib/dates.js';

const TABS = [['summary', 'Summary'], ['ageing', 'Outstanding'], ['cashbook', 'Cash & bank book'], ['gst', 'GST returns'], ['vehicles', 'Vehicle trips']];
const XlsxLink = ({ path, query }) => (
  <a className="btn" href={exportUrl(path, { ...query, format: 'xlsx' })} download><Icon name="download" size={16} /> Excel</a>
);
function useReport(path, query, enabled = true) {
  const toast = useToast();
  const [d, setD] = useState(null);
  const key = JSON.stringify(query);
  useEffect(() => {
    if (!enabled) return;
    setD(null);
    api(path, { query: JSON.parse(key) }).then(setD).catch(e => toast(e.message, 'error'));
  }, [path, key, enabled, toast]);
  return d;
}
const Loading = () => <div className="card"><div className="loading-bar" /><Empty title="Loading…" /></div>;

function Summary({ range }) {
  const d = useReport('/reports', range);
  if (!d) return <Loading />;
  const p = d.plant;
  return (
    <>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Profit & loss</h3><span className="spacer" /><XlsxLink path="/reports" query={range} /></div>
          <div className="card-body" style={{ paddingTop: 6 }}>
            <KV label="Sales (incl. GST & freight)" value={fmtMoney(d.pnl.gross)} />
            {d.pnl.returns > 0 && <KV label="Less credit notes / returns" value={fmtMoney(-d.pnl.returns)} />}
            <KV label="Less GST (net of credit notes)" value={fmtMoney(-d.pnl.gst)} />
            <KV label="Net revenue" value={fmtMoney(d.pnl.revenue)} cls="total" />
            <KV label="Purchases (excl. input GST)" value={fmtMoney(d.pnl.purchases)} />
            {d.pnl.expenses.map(e => <KV key={e.category} label={e.category} value={fmtMoney(e.amount)} cls="indent" />)}
            <KV label="Total expenses" value={fmtMoney(d.pnl.expenseTotal)} />
            <div className="kv total"><span>Net profit</span><span className={`num ${d.pnl.net >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(d.pnl.net)}</span></div>
          </div>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="card-head"><h3>Cash flow</h3></div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              <KV label="Money received" value={fmtMoney(d.cash.inflow)} />
              <KV label="Money paid out" value={fmtMoney(d.cash.outflow)} />
              <div className="kv total"><span>Net cash flow</span><span className={`num ${d.cash.inflow - d.cash.outflow >= 0 ? 'pos' : 'neg'}`}>{fmtMoney(d.cash.inflow - d.cash.outflow)}</span></div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Plant performance</h3></div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              <KV label="Total output" value={fmtNum(p.output)} />
              <KV label="Raw material used" value={fmtNum(p.raw)} />
              <KV label="Yield (output ÷ raw input)" value={p.yield != null ? `${fmtNum(p.yield, 1)}%` : '—'} />
              <KV label="Running hours" value={fmtNum(p.hours, 1)} />
              <KV label="Downtime hours" value={fmtNum(p.downtime, 1)} />
              <KV label="Availability (running ÷ running + down)" value={p.availability != null ? `${fmtNum(p.availability, 1)}%` : '—'} />
              <KV label="Output per running hour" value={p.hours ? fmtNum(p.output / p.hours) : '—'} />
              <KV label="Diesel cost per unit of output" value={p.output ? fmtMoney(p.diesel / p.output) : '—'} />
              {p.downtimeByReason.map(r => <KV key={r.reason} cls="indent" label={`Down: ${r.reason} (${r.count}×)`} value={`${fmtNum(r.hours, 1)} h`} />)}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h3>By material</h3></div>
          {!d.byMaterial.length ? <Empty title="No data" /> : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>Material</th><th className="num">Produced</th><th className="num">Sold</th><th className="num">Sales value</th><th className="num">Avg rate</th></tr></thead>
                <tbody>{d.byMaterial.map(m => (
                  <tr key={m.id}><td>{m.name}</td><td className="num">{fmtNum(m.produced)} {m.unit}</td><td className="num">{fmtNum(m.sold)} {m.unit}</td>
                    <td className="num">{fmtMoney(m.value)}</td><td className="num">{fmtMoney(m.avgRate)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>By customer</h3></div>
          {!d.byCustomer.length ? <Empty title="No data" /> : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>Customer</th><th className="num">Dispatches</th><th className="num">Sales</th><th className="num">Balance now</th></tr></thead>
                <tbody>{d.byCustomer.map(c => (
                  <tr key={c.id}><td><Link to={`/parties/${c.id}`}>{c.name}</Link></td><td className="num">{c.count}</td><td className="num">{fmtMoney(c.amount)}</td>
                    <td className={`num ${c.balance > 0 ? '' : 'muted'}`}>{fmtMoney(c.balance)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** WhatsApp link with a polite reminder; wa.me needs the country code. */
function reminderLink(r, business) {
  const digits = String(r.phone || '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  const text = `Dear ${r.name}, this is a reminder that ${fmtMoney(r.balance)} is outstanding with ${business}. Kindly arrange the payment at the earliest. Thank you.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function Ageing() {
  const { settings } = useLookups();
  const [asof, setAsof] = useState(today());
  const d = useReport('/reports/ageing', { asof });
  return (
    <div className="card">
      <div className="toolbar">
        <Field label="As on"><input type="date" value={asof} max={today()} onChange={e => e.target.value && setAsof(e.target.value)} /></Field>
        <span className="spacer" />
        <XlsxLink path="/reports/ageing" query={{ asof }} />
      </div>
      {!d ? <div className="loading-bar" /> : !d.rows.length ? <Empty title="Nothing outstanding">Every customer is settled.</Empty> : (
        <div className="table-wrap">
          <table className="table-cards">
            <thead><tr><th>Customer</th><th className="num">Outstanding</th>{d.buckets.map(b => <th key={b} className="num">{b} days</th>)}<th>Oldest unpaid</th><th className="actions" /></tr></thead>
            <tbody>
              {d.rows.map(r => (
                <tr key={r.id}>
                  <td><Link to={`/parties/${r.id}`}>{r.name}</Link>{r.phone && <div className="muted" style={{ fontSize: 12 }}>{r.phone}</div>}</td>
                  <td className="num"><b>{fmtMoney(r.balance)}</b></td>
                  {d.buckets.map((b, i) => <td key={b} className={`num ${r[b] > 0 && i >= 2 ? 'neg' : ''}`}>{r[b] ? fmtMoney(r[b]) : '—'}</td>)}
                  <td>{r.oldest_bill ? <>{fmtDate(r.oldest_bill)} <span className="muted">({r.oldest_days} d)</span></> : <Badge>Opening balance</Badge>}</td>
                  <td className="actions">
                    <a className="btn btn-sm" href={reminderLink(r, settings.business_name)} target="_blank" rel="noopener noreferrer" title={r.phone ? `Remind on WhatsApp: ${r.phone}` : 'Opens WhatsApp; add a phone number to the customer to pre-fill'}>
                      <Icon name="message" size={14} /> Remind
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{fmtMoney(d.totals.balance)}</td>{d.buckets.map(b => <td key={b} className="num">{fmtMoney(d.totals[b])}</td>)}<td /><td /></tr></tfoot>
          </table>
        </div>
      )}
      <div className="pager">Payments are matched to the oldest bills first, so what is outstanding is the newest bills. Days are counted from the bill date.</div>
    </div>
  );
}

function CashBook({ range }) {
  const [book, setBook] = useState('cash');
  const [view, setView] = useState('entries');
  const q = { book, from: range.from || monthStart(), to: range.to || today() };
  const d = useReport('/reports/cashbook', q);
  return (
    <div className="card">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Book">
          <button type="button" aria-pressed={book === 'cash'} className={book === 'cash' ? 'on-P' : ''} onClick={() => setBook('cash')}>Cash</button>
          <button type="button" aria-pressed={book === 'bank'} className={book === 'bank' ? 'on-P' : ''} onClick={() => setBook('bank')}>Bank / UPI</button>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'entries'} className={view === 'entries' ? 'on-P' : ''} onClick={() => setView('entries')}>Entries</button>
          <button type="button" aria-pressed={view === 'days'} className={view === 'days' ? 'on-P' : ''} onClick={() => setView('days')}>Daily closing</button>
        </div>
        <span className="spacer" />
        <XlsxLink path="/reports/cashbook" query={q} />
      </div>
      {!d ? <div className="loading-bar" /> : (
        <>
          <StatGrid className="stats-inset">
            <Stat label="Opening" value={fmtMoney(d.opening)} />
            <Stat label="Received" value={fmtMoney(d.totalIn)} tone="pos" />
            <Stat label="Paid out" value={fmtMoney(d.totalOut)} tone="neg" />
            <Stat label="Closing" value={fmtMoney(d.closing)} />
          </StatGrid>
          {!d.entries.length ? <Empty title="No entries in this period" /> : view === 'entries' ? (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th className="num">Receipt</th><th className="num">Payment</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  <tr className="muted"><td /><td>Opening balance</td><td /><td /><td /><td className="num">{fmtMoney(d.opening)}</td></tr>
                  {d.entries.map((e, i) => (
                    <tr key={`${e.ref}-${i}`}><td>{fmtDate(e.date)}</td><td className="wrap">{e.desc}</td><td>{e.mode}</td>
                      <td className="num">{e.in ? fmtMoney(e.in) : ''}</td><td className="num">{e.out ? fmtMoney(e.out) : ''}</td><td className="num">{fmtMoney(e.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>Date</th><th className="num">Receipts</th><th className="num">Payments</th><th className="num">Closing balance</th></tr></thead>
                <tbody>{d.days.map(x => <tr key={x.date}><td>{fmtDate(x.date)}</td><td className="num">{fmtMoney(x.in)}</td><td className="num">{fmtMoney(x.out)}</td><td className={`num ${x.closing < 0 ? 'neg' : ''}`}>{fmtMoney(x.closing)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="pager">Cash = payments in cash. Bank = UPI, bank transfer and cheque. Set opening balances in Business settings.</div>
    </div>
  );
}

function Gst({ range }) {
  const q = { from: range.from || monthStart(), to: range.to || today() };
  const d = useReport('/reports/gst', q);
  if (!d) return <Loading />;
  const s = d.summary;
  const T = ({ k }) => <>{fmtMoney(s.sales[k] || 0)}</>;
  return (
    <>
      <div className="card">
        <div className="card-head"><h3>GST summary · {fmtDate(d.from)} – {fmtDate(d.to)}</h3><span className="spacer" /><XlsxLink path="/reports/gst" query={q} /></div>
        <div className="table-wrap">
          <table className="table-cards">
            <thead><tr><th /><th className="num">Taxable value</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Total tax</th></tr></thead>
            <tbody>
              <tr><td>Sales ({s.invoices} invoices)</td><td className="num"><T k="subtotal" /></td><td className="num"><T k="cgst" /></td><td className="num"><T k="sgst" /></td><td className="num"><T k="igst" /></td><td className="num"><T k="gst_amount" /></td></tr>
              <tr><td>Less credit notes ({s.creditNotes})</td>{['subtotal', 'cgst', 'sgst', 'igst', 'gst_amount'].map(k => <td key={k} className="num">{fmtMoney(-(s.credits[k] || 0))}</td>)}</tr>
              <tr className="doc-total"><td><b>Net output tax</b></td>{['subtotal', 'cgst', 'sgst', 'igst', 'gst_amount'].map(k => <td key={k} className="num"><b>{fmtMoney(s.net[k])}</b></td>)}</tr>
              <tr><td>Less input tax on purchases ({s.purchases})</td>{['subtotal', 'cgst', 'sgst', 'igst', 'gst_amount'].map(k => <td key={k} className="num">{fmtMoney(-(s.input?.[k] || 0))}</td>)}</tr>
              <tr className="doc-total"><td><b>Net GST payable</b></td><td />{['cgst', 'sgst', 'igst', 'gst_amount'].map(k => <td key={k} className={`num ${s.payable[k] < 0 ? 'pos' : ''}`}><b>{fmtMoney(s.payable[k])}</b></td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="card mt">
        <div className="card-head"><h3>B2B · registered customers</h3><span className="muted">{d.b2b.length} invoices</span></div>
        {!d.b2b.length ? <Empty title="No invoices to customers with a GSTIN" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>GSTIN</th><th>Customer</th><th>Invoice</th><th>Date</th><th className="num">Rate</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Value</th></tr></thead>
              <tbody>{d.b2b.map(r => (
                <tr key={r.bill_no}><td className="mono">{r.gstin}</td><td>{r.party}</td><td className="mono">{r.bill_no}</td><td>{fmtDate(r.date)}</td><td className="num">{fmtNum(r.rate)}%</td>
                  <td className="num">{fmtMoney(r.taxable)}</td><td className="num">{fmtMoney(r.cgst)}</td><td className="num">{fmtMoney(r.sgst)}</td><td className="num">{fmtMoney(r.igst)}</td><td className="num">{fmtMoney(r.invoice_value)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card mt">
        <div className="card-head"><h3>Input tax · purchase bills with GST</h3><span className="muted">{d.inputBills.length} bills</span></div>
        {!d.inputBills.length ? <Empty title="No purchase bills with GST in this period" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>Date</th><th>Supplier bill</th><th>Supplier</th><th>GSTIN</th><th className="num">Rate</th><th className="num">Taxable</th><th className="num">CGST</th><th className="num">SGST</th><th className="num">IGST</th><th className="num">Value</th></tr></thead>
              <tbody>{d.inputBills.map((r, i) => (
                <tr key={`${r.bill_no}-${i}`}><td>{fmtDate(r.date)}</td><td className="mono">{r.bill_no}</td><td>{r.party}</td><td className="mono">{r.gstin}</td><td className="num">{fmtNum(r.rate)}%</td>
                  <td className="num">{fmtMoney(r.taxable)}</td><td className="num">{fmtMoney(r.cgst)}</td><td className="num">{fmtMoney(r.sgst)}</td><td className="num">{fmtMoney(r.igst)}</td><td className="num">{fmtMoney(r.value)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head"><h3>B2C · unregistered, by rate</h3></div>
          {!d.b2c.length ? <Empty title="None" /> : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>Supply</th><th className="num">Rate</th><th className="num">Bills</th><th className="num">Taxable</th><th className="num">Tax</th></tr></thead>
                <tbody>{d.b2c.map(r => <tr key={`${r.supply}${r.rate}`}><td>{r.supply}</td><td className="num">{fmtNum(r.rate)}%</td><td className="num">{r.count}</td><td className="num">{fmtMoney(r.subtotal)}</td><td className="num">{fmtMoney(r.gst_amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>HSN summary</h3></div>
          {!d.hsn.length ? <Empty title="None" /> : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>HSN</th><th className="num">Rate</th><th className="num">Quantity</th><th className="num">Taxable</th><th className="num">Tax</th></tr></thead>
                <tbody>{d.hsn.map(r => <tr key={`${r.hsn}${r.unit}${r.rate}`}><td className="mono">{r.hsn || '—'}</td><td className="num">{fmtNum(r.rate)}%</td><td className="num">{fmtNum(r.qty, 3)} {r.unit}</td><td className="num">{fmtMoney(r.subtotal)}</td><td className="num">{fmtMoney(r.gst_amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="muted mt" style={{ fontSize: 13 }}>A working summary for filing GSTR-1 and GSTR-3B. Check it with your accountant before filing; transport charges billed separately are not included in taxable value.</p>
    </>
  );
}

function Vehicles({ range }) {
  const d = useReport('/reports/vehicles', range);
  return (
    <div className="card">
      <div className="toolbar"><span className="spacer" /><XlsxLink path="/reports/vehicles" query={range} /></div>
      {!d ? <div className="loading-bar" /> : !d.rows.length ? <Empty title="No dispatches with a vehicle number" /> : (
        <div className="table-wrap">
          <table className="table-cards">
            <thead><tr><th>Vehicle</th><th>Ownership</th><th>Owner</th><th className="num">Trips</th><th className="num">Quantity</th><th className="num">Net weight</th><th className="num">Freight charged</th><th className="num">Freight payable</th></tr></thead>
            <tbody>{d.rows.map(r => (
              <tr key={r.vehicle_no}><td className="mono">{r.vehicle_no}</td>
                <td>{r.ownership === 'hired' ? <Badge>Hired</Badge> : r.ownership === 'own' ? <Badge tone="blue">Own</Badge> : <Badge tone="amber">Not registered</Badge>}</td>
                <td>{r.owner_name || '—'}</td><td className="num">{r.trips}</td><td className="num">{fmtNum(r.qty, 3)}</td>
                <td className="num">{r.net_kg ? `${fmtNum(r.net_kg / 1000, 3)} t` : '—'}</td><td className="num">{fmtMoney(r.charged)}</td><td className="num">{fmtMoney(r.cost)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'summary';
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  if (!can('finance')) return <NoAccess />;
  const ranged = tab !== 'ageing';

  return (
    <>
      <PageHeader title="Reports" description={ranged ? `${range.from ? fmtDate(range.from) : 'Beginning'} – ${range.to ? fmtDate(range.to) : 'today'}` : 'Money owed by customers, by age'}>
        <button className="btn" onClick={() => window.print()}><Icon name="printer" size={16} /> Print</button>
      </PageHeader>
      <div className="card no-print mb">
        <Tabs id="reports" tabs={TABS} value={tab} onChange={k => setParams({ tab: k }, { replace: true })} />
        {ranged && (
          <div className="toolbar" style={{ borderBottom: 0 }}>
            <Field label="From"><input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></Field>
            <Field label="To"><input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></Field>
            <Field label="Quick range">
              <select value="" onChange={e => e.target.value && setRange(quickRange(e.target.value))}>
                <option value="">Choose…</option>
                {QUICK_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
      {tab === 'summary' && <Summary range={range} />}
      {tab === 'ageing' && <Ageing />}
      {tab === 'cashbook' && <CashBook range={range} />}
      {tab === 'gst' && <Gst range={range} />}
      {tab === 'vehicles' && <Vehicles range={range} />}
    </>
  );
}
