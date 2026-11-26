'use client';
import { useEffect, useState } from 'react';
import { Link } from '../router.jsx';
import { PageHeader, Badge, Empty, NoAccess } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum } from '../lib/format.js';
import { useAuth, useToast } from '../context.jsx';

export default function Stock() {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const fin = can('finance');
  useEffect(() => { if (can('stock')) api('/stock').then(d => setRows(d.rows)).catch(e => toast(e.message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('stock')) return <NoAccess />;

  return (
    <>
      <PageHeader title="Stock" description="Opening + purchased + produced + returned − raw material used − sold. Click a material to see every movement.">
        {can('materials', 'write') && <Link className="btn" to="/materials">Edit opening stock</Link>}
      </PageHeader>
      <div className="card">
        {!rows ? <div className="loading-bar" /> : !rows.length ? <Empty title="No materials" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Material</th><th className="num">Opening</th><th className="num">Purchased</th><th className="num">Produced</th>
                  <th className="num">Used</th><th className="num">Sold</th><th className="num">In stock</th>{fin && <th className="num">Value</th>}<th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td><Link to={`/stock/${r.id}`} title="See every movement">{r.name}</Link> <span className="muted">· {r.unit}</span></td>
                    <td className="num">{fmtNum(r.opening)}</td><td className="num">{fmtNum(r.purchased)}</td><td className="num">{fmtNum(r.produced)}</td>
                    <td className="num">{fmtNum(r.consumed)}</td><td className="num">{fmtNum(r.sold)}</td>
                    <td className="num"><b style={{ fontWeight: 600 }}>{fmtNum(r.current)}</b></td>
                    {fin && <td className="num">{fmtMoney(r.value)}</td>}
                    <td>{r.current < 0 ? <Badge tone="red">Negative</Badge> : r.low ? <Badge tone="amber">Low</Badge> : <Badge tone="green">OK</Badge>}</td>
                  </tr>
                ))}
              </tbody>
              {fin && (
                <tfoot>
                  <tr><td colSpan={7}>Total stock value at default rates</td><td className="num">{fmtMoney(rows.reduce((a, r) => a + r.value, 0))}</td><td /></tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </>
  );
}
