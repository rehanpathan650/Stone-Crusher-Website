import { useEffect, useState } from 'react';
import { PageHeader, Field, Pager, Empty, NoAccess, Badge } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { useAuth, useToast } from '../context.jsx';

const ENTITIES = ['sales', 'purchases', 'production', 'expenses', 'payments', 'parties', 'materials', 'vehicles', 'employees', 'attendance', 'users', 'settings'];
const ACTIONS = ['create', 'update', 'delete', 'export', 'login', 'login_failed', 'account_locked', 'logout', 'password_change', 'password_reset', 'setup'];
const tone = a => (a === 'delete' || a === 'login_failed' || a === 'account_locked' ? 'red' : a === 'create' ? 'green' : a === 'update' ? 'blue' : 'gray');

export default function Audit() {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ entity: '', action: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!can('audit')) return;
    api('/audit', { query: { ...f, page, pageSize } }).then(setData).catch(e => toast(e.message, 'error'));
  }, [f, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('audit')) return <NoAccess />;

  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in and every change to business records, with who did it and when." />
      <div className="card">
        <div className="toolbar">
          <Field label="Record type">
            <select value={f.entity} onChange={e => { setF(x => ({ ...x, entity: e.target.value })); setPage(1); }}>
              <option value="">All</option>{ENTITIES.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Action">
            <select value={f.action} onChange={e => { setF(x => ({ ...x, action: e.target.value })); setPage(1); }}>
              <option value="">All</option>{ACTIONS.map(x => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        {!data ? <div className="loading-bar" /> : !data.rows.length ? <Empty title="No activity" /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}>
                    <td className="muted">{fmtDateTime(r.created_at)}</td>
                    <td>{r.user_name || <span className="muted">—</span>}</td>
                    <td><Badge tone={tone(r.action)}>{r.action.replace('_', ' ')}</Badge></td>
                    <td>{r.entity}{r.entity_id ? <span className="muted"> #{r.entity_id}</span> : ''}</td>
                    <td className="wrap">
                      {r.details && (
                        <details>
                          <summary className="muted" style={{ cursor: 'pointer' }}>View</summary>
                          <pre className="mono" style={{ whiteSpace: 'pre-wrap', maxWidth: 520, margin: '6px 0 0', fontSize: 12 }}>{(() => { try { return JSON.stringify(JSON.parse(r.details), null, 2); } catch { return r.details; } })()}</pre>
                        </details>
                      )}
                    </td>
                    <td className="mono muted">{r.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />}
      </div>
    </>
  );
}
