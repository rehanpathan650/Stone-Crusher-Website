'use client';
import { useEffect, useState } from 'react';
import { Stat, StatGrid, Badge } from './ui.jsx';
import { api } from '../lib/api.js';
import { fmtNum, fmtDate } from '../lib/format.js';

/** Royalty balance cards above the permit register. Reloads whenever the list changes. */
function RoyaltyHeader({ version }) {
  const [s, setS] = useState(null);
  useEffect(() => { api('/royalty/summary').then(setS).catch(() => setS(null)); }, [version]);
  if (!s) return null;
  return (
    <StatGrid>
      <Stat label="Tons covered by permits" value={fmtNum(s.permitted, 3)} />
      <Stat label="Dispatched with a pass" value={fmtNum(s.dispatched, 3)} />
      <Stat label="Balance" value={fmtNum(s.balance, 3)} tone={s.low ? 'neg' : 'pos'}
        sub={s.low ? `Low: alert set at ${fmtNum(s.alertAt)} tons` : `Alert below ${fmtNum(s.alertAt)} tons`} />
      <Stat label="Dispatches without pass (30 days)" value={fmtNum(s.missingPasses30d, 0)} tone={s.missingPasses30d ? 'neg' : ''}
        sub="Ton-based sales with no pass number" />
    </StatGrid>
  );
}

/** Fuel efficiency per machine for the last 90 days, abnormal consumption first. */
function DieselHeader({ version }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const d = new Date(); d.setDate(d.getDate() - 89);
    api('/diesel/efficiency', { query: { from: d.toISOString().slice(0, 10) } }).then(r => setRows(r.rows)).catch(() => setRows([]));
  }, [version]);
  if (!rows?.length) return null;
  return (
    <div className="card mb">
      <div className="card-head"><h3>Fuel efficiency · last 90 days</h3><span className="muted">Needs at least two meter readings per machine</span></div>
      <div className="table-wrap">
        <table className="table-cards">
          <thead><tr><th>Machine</th><th className="num">Fills</th><th className="num">Litres</th><th className="num">Distance / hours</th><th className="num">Average</th><th className="num">Latest</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.vehicle_id}>
                <td className="mono">{r.number}</td>
                <td className="num">{r.fills}</td>
                <td className="num">{fmtNum(r.litres)}</td>
                <td className="num">{r.distance ? `${fmtNum(r.distance, 1)} ${r.meter_type === 'hours' ? 'hr' : 'km'}` : '—'}</td>
                <td className="num">{r.efficiency != null ? `${fmtNum(r.efficiency)} ${r.efficiencyUnit}` : '—'}</td>
                <td className="num">{r.latest != null ? `${fmtNum(r.latest)} ${r.efficiencyUnit}` : '—'}</td>
                <td>{r.abnormal ? <Badge tone="red">High consumption</Badge> : r.efficiency != null ? <Badge tone="green">Normal</Badge> : <Badge>Not enough readings</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Machines with a service due within 7 days (or 50 km / hours), overdue first. */
function MaintenanceHeader({ version }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/maintenance/due').then(r => setRows(r.rows)).catch(() => setRows([])); }, [version]);
  if (!rows?.length) return null;
  return (
    <div className="card mb">
      <div className="card-head"><h3>Service due</h3></div>
      <div className="table-wrap">
        <table className="table-cards">
          <thead><tr><th>Machine</th><th>Last entry</th><th>Due date</th><th className="num">Due at</th><th className="num">Current reading</th><th>Status</th></tr></thead>
          <tbody>
            {[...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue)).map(r => (
              <tr key={r.vehicle_id}>
                <td className="mono">{r.number}</td>
                <td>{fmtDate(r.last_service)} · {r.kind}</td>
                <td>{r.next_due_date ? fmtDate(r.next_due_date) : '—'}</td>
                <td className="num">{r.next_due_meter != null ? fmtNum(r.next_due_meter, 1) : '—'}</td>
                <td className="num">{r.current_meter != null ? fmtNum(r.current_meter, 1) : '—'}</td>
                <td>{r.overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Due soon</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const PAGE_HEADERS = { royalty: RoyaltyHeader, diesel: DieselHeader, maintenance: MaintenanceHeader };
