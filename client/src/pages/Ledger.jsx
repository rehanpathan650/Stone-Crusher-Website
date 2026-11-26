import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import RecordForm from '../components/RecordForm.jsx';
import { PageHeader, Stat, Empty, NoAccess } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDate, fmtMoney } from '../lib/format.js';
import { useAuth, useLookups, useToast } from '../context.jsx';

export default function Ledger() {
  const { id } = useParams();
  const { can } = useAuth();
  const { settings } = useLookups();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [pay, setPay] = useState(false);

  const load = useCallback(() => api(`/parties/${id}/ledger`).then(setData).catch(e => toast(e.message, 'error')), [id, toast]);
  useEffect(() => { if (can('ledger')) load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('ledger')) return <NoAccess />;
  if (!data) return <div className="card"><div className="loading-bar" /><Empty title="Loading…" /></div>;

  const { party, rows, balance, opening } = data;
  return (
    <>
      <div className="muted no-print" style={{ marginBottom: 8 }}><Link to="/parties">← Customers & Suppliers</Link></div>
      <PageHeader title={party.name} description={[party.phone, party.address, party.gstin && `GSTIN ${party.gstin}`].filter(Boolean).join(' · ') || 'Party ledger'}>
        <button className="btn" onClick={() => window.print()}><Icon name="printer" size={16} /> Print</button>
        {can('payments', 'write') && <button className="btn btn-primary" onClick={() => setPay(true)}><Icon name="plus" size={16} /> Record payment</button>}
      </PageHeader>
      <div className="stats">
        <Stat label="Closing balance" value={fmtMoney(Math.abs(balance))} tone={balance > 0 ? '' : balance < 0 ? 'neg' : 'pos'}
          sub={balance > 0.009 ? 'They owe you' : balance < -0.009 ? 'You owe them' : 'Fully settled'} />
        <Stat label="Opening balance" value={fmtMoney(opening)} />
        <Stat label="Entries" value={rows.length} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Ledger · {settings.business_name}</h3><span className="spacer" /><span className="muted">As on {fmtDate(new Date())}</span></div>
        {rows.length === 0 ? <Empty title="No transactions yet" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>Date</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                <tr><td /><td className="muted">Opening balance</td><td /><td /><td className="num">{fmtMoney(opening)}</td></tr>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{fmtDate(r.date)}</td><td className="wrap">{r.desc}</td>
                    <td className="num">{r.debit ? fmtMoney(r.debit) : ''}</td><td className="num">{r.credit ? fmtMoney(r.credit) : ''}</td>
                    <td className={`num ${r.balance < 0 ? 'neg' : ''}`}>{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td /><td>Closing balance ({balance >= 0 ? 'receivable' : 'payable'})</td><td /><td /><td className="num">{fmtMoney(Math.abs(balance))}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
      {pay && (
        <RecordForm name="payments" preset={{ party_id: party.id, direction: balance >= 0 ? 'in' : 'out', amount: Math.abs(balance) || '' }}
          onClose={() => setPay(false)} onSaved={load} />
      )}
    </>
  );
}
