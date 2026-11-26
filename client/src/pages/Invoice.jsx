import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { amountInWords, fmtDate, fmtMoney, fmtNum } from '../lib/format.js';
import { useLookups } from '../context.jsx';

const TITLES = { sale: 'Tax Invoice', challan: 'Delivery Challan', credit: 'Credit Note' };

/** Digits-only phone with India's country code, for wa.me links. */
const waPhone = phone => {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d.length >= 11 ? d : '';
};

function TaxRows({ doc }) {
  if (!(doc.gst_amount > 0)) return null;
  const half = fmtNum(doc.gst_pct / 2);
  return doc.tax_type === 'inter'
    ? <tr><td colSpan={5}>IGST @ {fmtNum(doc.gst_pct)}%</td><td className="num">{fmtMoney(doc.igst)}</td></tr>
    : (
      <>
        <tr><td colSpan={5}>CGST @ {half}%</td><td className="num">{fmtMoney(doc.cgst)}</td></tr>
        <tr><td colSpan={5}>SGST @ {half}%</td><td className="num">{fmtMoney(doc.sgst)}</td></tr>
      </>
    );
}

/**
 * Printable GST tax invoice, delivery challan (quantities only) or credit note, in its own tab.
 * "Save as PDF" uses the browser's print dialog, which gives a crisp A4 PDF with no extra software.
 */
export default function Invoice({ kind = 'sale' }) {
  const { id } = useParams();
  const { settings, materials, enums, ready } = useLookups();
  const [doc, setDoc] = useState(null);
  const [party, setParty] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(kind === 'credit' ? `/credit_notes/${id}` : `/sales/${id}`).then(async d => {
      setDoc(d);
      try { setParty(await api(`/parties/${d.party_id}`)); } catch { setParty({ name: d.party_name }); }
    }).catch(e => setError(e.message));
  }, [id, kind]);

  useEffect(() => {
    if (doc) document.title = `${TITLES[kind]} ${kind === 'credit' ? doc.note_no : doc.bill_no}`;
  }, [doc, kind]);

  if (error) return <div className="center-screen">{error}</div>;
  if (!doc || !party || !ready) return <div className="center-screen">Loading…</div>;

  const s = settings;
  const p = party;
  // Same rule as the server: the state in the customer's GSTIN wins over the state typed on the party.
  const partyState = (p.gstin && enums.stateCodes?.[p.gstin.slice(0, 2)]) || p.state || '';
  const number = kind === 'credit' ? doc.note_no : doc.bill_no;
  const hsn = materials.find(m => m.id === doc.material_id)?.hsn || '';
  const priced = kind !== 'challan';
  const taxed = doc.gst_amount > 0;
  const title = kind === 'sale' && !taxed ? 'Bill of Supply' : TITLES[kind];
  const due = kind === 'sale' ? doc.amount - doc.paid : 0;
  const shareText = kind === 'credit'
    ? `Credit note ${number} dated ${fmtDate(doc.date)} from ${s.business_name}: ${fmtMoney(doc.amount)} credited against bill ${doc.bill_no}.`
    : `${title} ${number} dated ${fmtDate(doc.date)} from ${s.business_name}: ${doc.material_name} ${fmtNum(doc.qty)} ${doc.unit}`
      + (priced ? `, amount ${fmtMoney(doc.amount)}${due > 0.005 ? `, balance due ${fmtMoney(due)}` : ''}.` : '.')
      + (doc.vehicle_no ? ` Vehicle ${doc.vehicle_no}.` : '');
  const wa = waPhone(p.phone);
  const bank = [s.bank_name && `Bank: ${s.bank_name}`, s.bank_account && `A/c: ${s.bank_account}`, s.bank_ifsc && `IFSC: ${s.bank_ifsc}`, s.bank_branch && `Branch: ${s.bank_branch}`].filter(Boolean);

  return (
    <>
      <div className="doc-toolbar">
        <a className="btn" href={`https://wa.me/${wa}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
          title={wa ? `Send to ${p.phone}` : 'Opens WhatsApp; choose the contact there'}>
          <Icon name="message" size={16} /> WhatsApp
        </a>
        <a className="btn" href={`mailto:${p.email || ''}?subject=${encodeURIComponent(`${title} ${number}`)}&body=${encodeURIComponent(shareText)}`}>
          <Icon name="mail" size={16} /> Email
        </a>
        <button className="btn btn-primary" onClick={() => window.print()} title="Choose “Save as PDF” as the printer to download a PDF">
          <Icon name="printer" size={16} /> Print / Save PDF
        </button>
      </div>
      <div className="doc">
        <div className="doc-head">
          <div className="doc-company">
            {s.logo && <img src={s.logo} alt="" className="doc-logo" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <div>
              <h1>{s.business_name}</h1>
              {s.address && <div>{s.address}{s.state ? `, ${s.state}` : ''}</div>}
              <div className="muted">{[s.phone && `Phone ${s.phone}`, s.email].filter(Boolean).join(' · ')}</div>
              {s.gstin && <div><b>GSTIN</b> {s.gstin}</div>}
            </div>
          </div>
          <div className="doc-title">
            <h2>{title}</h2>
            <table className="doc-meta"><tbody>
              <tr><td>No.</td><td className="mono">{number}</td></tr>
              <tr><td>Date</td><td>{fmtDate(doc.date)}</td></tr>
              {kind === 'credit' && <tr><td>Against bill</td><td className="mono">{doc.bill_no}</td></tr>}
              {doc.vehicle_no && <tr><td>Vehicle</td><td className="mono">{doc.vehicle_no}</td></tr>}
            </tbody></table>
          </div>
        </div>

        <div className="doc-parties">
          <div>
            <div className="doc-label">{kind === 'challan' ? 'Deliver to' : 'Billed to'}</div>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            {p.address && <div>{p.address}</div>}
            {p.phone && <div>Phone {p.phone}</div>}
            {p.gstin && <div><b>GSTIN</b> {p.gstin}</div>}
          </div>
          {priced && taxed && (
            <div style={{ textAlign: 'right' }}>
              <div className="doc-label">Place of supply</div>
              <div>{(doc.tax_type === 'inter' ? partyState : s.state || partyState) || '—'}</div>
              <div className="muted" style={{ fontSize: 12 }}>{doc.tax_type === 'inter' ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</div>
            </div>
          )}
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th><th>Description</th><th>HSN</th><th className="num">Quantity</th>
              {priced && <><th className="num">Rate</th><th className="num">Amount</th></>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td><td>{doc.material_name}</td><td className="mono">{hsn}</td>
              <td className="num">{fmtNum(doc.qty, 3)} {doc.unit}</td>
              {priced && <><td className="num">{fmtMoney(doc.rate)}</td><td className="num">{fmtMoney(doc.subtotal)}</td></>}
            </tr>
            {priced && (
              <>
                <tr><td colSpan={5}>Taxable value</td><td className="num">{fmtMoney(doc.subtotal)}</td></tr>
                <TaxRows doc={doc} />
                {doc.transport > 0 && <tr><td colSpan={5}>Transport / freight</td><td className="num">{fmtMoney(doc.transport)}</td></tr>}
                <tr className="doc-total"><td colSpan={5}>{kind === 'credit' ? 'Total credit' : 'Total'}</td><td className="num">{fmtMoney(doc.amount)}</td></tr>
                {kind === 'sale' && doc.paid > 0 && <tr><td colSpan={5}>Received ({doc.mode})</td><td className="num">{fmtMoney(doc.paid)}</td></tr>}
                {kind === 'sale' && <tr className="doc-total"><td colSpan={5}>Balance due</td><td className="num">{fmtMoney(due)}</td></tr>}
              </>
            )}
          </tbody>
        </table>

        {priced && <p className="doc-words"><b>Amount in words:</b> {amountInWords(doc.amount)}</p>}
        {kind === 'credit' && doc.reason && <p><b>Reason:</b> {doc.reason}</p>}
        {doc.notes && <p><b>Note:</b> {doc.notes}</p>}

        <div className="doc-foot">
          {kind === 'sale' && (bank.length > 0 || s.upi_id) && (
            <div>
              <div className="doc-label">Payment details</div>
              {bank.map(b => <div key={b}>{b}</div>)}
              {s.upi_id && <div>UPI: {s.upi_id}</div>}
            </div>
          )}
          {kind === 'sale' && s.invoice_terms && (
            <div>
              <div className="doc-label">Terms</div>
              <div className="doc-terms">{s.invoice_terms}</div>
            </div>
          )}
        </div>
        <div className="sign"><span>Receiver's signature</span><span>For {s.business_name}<br /><br />Authorised signatory</span></div>
      </div>
    </>
  );
}
