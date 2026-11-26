'use client';
import { useEffect, useState } from 'react';
import { useParams } from '../router.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format.js';
import { useLookups } from '../context.jsx';

/** Printable weighment slip (A5-friendly), opened in its own tab. */
export default function WeighmentSlip() {
  const { id } = useParams();
  const { settings, ready } = useLookups();
  const [w, setW] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/weighments/${id}`).then(setW).catch(e => setError(e.message)); }, [id]);
  useEffect(() => { if (w) document.title = `Weighment slip ${w.slip_no}`; }, [w]);
  if (error) return <div className="center-screen">{error}</div>;
  if (!w || !ready) return <div className="center-screen">Loading…</div>;
  const empty = w.type === 'Empty';

  return (
    <>
      <div className="doc-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} /> Print / Save PDF</button>
      </div>
      <div className="doc slip">
        <div className="slip-head">
          {settings.logo && <img src={settings.logo} alt="" className="doc-logo" onError={e => { e.currentTarget.style.display = 'none'; }} />}
          <div>
            <h1>{settings.business_name}</h1>
            {settings.address && <div className="muted">{settings.address}</div>}
          </div>
        </div>
        <div className="slip-title">Weighment slip {w.type !== 'Loaded' && <span>· {w.type}</span>}</div>
        <table className="slip-meta"><tbody>
          <tr><td>Slip no.</td><td className="mono">{w.slip_no}</td><td>Date & time</td><td>{fmtDate(w.date)} {w.time || ''}</td></tr>
          <tr><td>Vehicle</td><td className="mono">{w.vehicle_no}</td><td>Driver</td><td>{w.driver || '—'}</td></tr>
          <tr><td>Customer</td><td>{w.party_name || '—'}</td><td>Material</td><td>{w.material_name || '—'}</td></tr>
        </tbody></table>
        <table className="slip-weights"><tbody>
          {!empty && <tr><td>Gross weight</td><td className="num">{fmtNum(w.gross_weight, 0)} kg</td></tr>}
          <tr><td>{empty ? 'Empty vehicle weight' : 'Tare weight'}</td><td className="num">{fmtNum(w.tare_weight, 0)} kg</td></tr>
          {!empty && <tr className="slip-net"><td>Net weight</td><td className="num">{fmtNum(w.net_weight, 0)} kg <small>({fmtNum(w.net_weight / 1000, 3)} t)</small></td></tr>}
          {w.amount != null && <tr><td>Rate / amount</td><td className="num">{fmtMoney(w.rate)} per {w.unit} · <b>{fmtMoney(w.amount)}</b></td></tr>}
        </tbody></table>
        {w.bill_no && <p className="muted">Billed on {w.bill_no}</p>}
        {w.notes && <p><b>Note:</b> {w.notes}</p>}
        <div className="sign"><span>Driver's signature</span><span>Weighbridge operator</span></div>
      </div>
    </>
  );
}
