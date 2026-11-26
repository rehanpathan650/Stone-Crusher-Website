import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { PageHeader, Field, Badge, Empty, NoAccess } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { useAuth, useToast } from '../context.jsx';

const ROLES = [
  ['admin', 'Admin', 'Everything, including users, settings and the audit log'],
  ['manager', 'Manager', 'All business data and reports; can delete records'],
  ['accountant', 'Accountant', 'Sales, purchases, expenses, payments, ledgers, reports'],
  ['operator', 'Operator', 'Dispatch (sales), production, attendance, stock'],
];
const roleLabel = r => ROLES.find(x => x[0] === r)?.[1] || r;

function UserForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user;
  const [v, setV] = useState(user ? { name: user.name, email: user.email, role: user.role, active: user.active } : { name: '', email: '', role: 'operator', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setV(x => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(isNew ? '/users' : `/users/${user.id}`, { method: isNew ? 'POST' : 'PUT', body: v });
      toast(isNew ? 'User created' : 'User updated');
      onSaved();
      onClose();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'New user' : 'Edit user'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-grid">
          <Field label="Name" required error={errors.name} htmlFor="u_name"><input id="u_name" value={v.name} onChange={set('name')} /></Field>
          <Field label="Email" required error={errors.email} htmlFor="u_email"><input id="u_email" type="email" value={v.email} onChange={set('email')} autoComplete="off" /></Field>
          <Field label="Role" required full error={errors.role} hint={ROLES.find(r => r[0] === v.role)?.[2]} htmlFor="u_role">
            <select id="u_role" value={v.role} onChange={set('role')}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          {isNew ? (
            <Field label="Temporary password" required full error={errors.password} hint="At least 10 characters with letters and numbers. Share it privately." htmlFor="u_pw">
              <input id="u_pw" type="password" value={v.password} onChange={set('password')} autoComplete="new-password" />
            </Field>
          ) : (
            <Field full error={errors.active}>
              <label className="check" style={{ paddingTop: 0 }}><input type="checkbox" checked={v.active} onChange={set('active')} /> Account active (can sign in)</label>
            </Field>
          )}
        </div>
        <div className="form-foot"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    try {
      await api(`/users/${user.id}/reset-password`, { method: 'POST', body: { password: pw } });
      toast(`Password reset for ${user.name}. They have been signed out everywhere.`);
      onClose();
    } catch (err) {
      setError(err.fields?.password || err.message);
    }
  };
  return (
    <Modal title={`Reset password — ${user.name}`} size="sm" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="New password" error={error} hint="At least 10 characters with letters and numbers" htmlFor="rp">
          <input id="rp" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" autoFocus />
        </Field>
        <div className="form-foot"><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Reset password</button></div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { can, user: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [reset, setReset] = useState(null);
  const load = useCallback(() => api('/users').then(d => setRows(d.rows)).catch(e => toast(e.message, 'error')), [toast]);
  useEffect(() => { if (can('users')) load(); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can('users')) return <NoAccess />;

  const unlock = async u => {
    try { await api(`/users/${u.id}/unlock`, { method: 'POST' }); toast('Account unlocked'); load(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Users & access" description="Who can sign in, and what each role is allowed to do.">
        <button className="btn btn-primary" onClick={() => setEdit({})}><Icon name="plus" size={16} /> New user</button>
      </PageHeader>
      <div className="card">
        {!rows ? <div className="loading-bar" /> : !rows.length ? <Empty /> : (
          <div className="table-wrap">
            <table className="table-cards">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="actions" /></tr></thead>
              <tbody>
                {rows.map(u => {
                  const locked = u.locked_until && u.locked_until > Date.now();
                  return (
                    <tr key={u.id}>
                      <td>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</td>
                      <td>{u.email}</td>
                      <td><Badge tone={u.role === 'admin' ? 'blue' : 'gray'}>{roleLabel(u.role)}</Badge></td>
                      <td>{!u.active ? <Badge>Deactivated</Badge> : locked ? <Badge tone="red">Locked</Badge>
                        : u.must_change_password ? <Badge tone="amber">Must set own password</Badge> : <Badge tone="green">Active</Badge>}</td>
                      <td className="muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : 'Never'}</td>
                      <td className="actions">
                        <span className="row-actions">
                          {locked && <button className="icon-btn" title="Unlock" aria-label="Unlock" onClick={() => unlock(u)}><Icon name="unlock" size={16} /></button>}
                          <button className="icon-btn" title="Reset password" aria-label="Reset password" onClick={() => setReset(u)}><Icon name="key" size={16} /></button>
                          <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEdit({ user: u })}><Icon name="edit" size={16} /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card mt">
        <div className="card-head"><h3>Roles</h3></div>
        <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
          {ROLES.map(([k, l, d]) => <div className="kv" key={k}><b style={{ fontWeight: 500 }}>{l}</b><span className="muted" style={{ textAlign: 'right' }}>{d}</span></div>)}
        </div>
      </div>
      {edit && <UserForm user={edit.user} onClose={() => setEdit(null)} onSaved={load} />}
      {reset && <ResetPassword user={reset} onClose={() => setReset(null)} />}
    </>
  );
}
