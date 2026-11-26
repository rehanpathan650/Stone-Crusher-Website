'use client';
import { useState } from 'react';
import { PageHeader, Field } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth, useConfirm, useToast } from '../context.jsx';

export default function Account() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = k => e => setV(x => ({ ...x, [k]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    if (v.newPassword !== v.confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      setV({ currentPassword: '', newPassword: '', confirm: '' });
      setErrors({});
      toast('Password changed. Other devices have been signed out.');
    } catch (err) {
      setErrors(err.fields || {});
      if (!err.fields || !Object.keys(err.fields).length) toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = async () => {
    if (!(await confirm({ title: 'Sign out other devices?', message: 'Every other browser signed in to your account will be signed out.', confirmLabel: 'Sign out others' }))) return;
    try {
      const r = await api('/auth/logout-others', { method: 'POST' });
      toast(`Signed out of ${r.ended} other session${r.ended === 1 ? '' : 's'}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <PageHeader title="Account & security" description={`${user.name} · ${user.email}`} />
      <div className="grid grid-2" style={{ maxWidth: 1000 }}>
        <div className="card">
          <div className="card-head"><h3>Change password</h3></div>
          <form className="card-body stack" onSubmit={submit}>
            <Field label="Current password" error={errors.currentPassword} htmlFor="cp"><input id="cp" type="password" value={v.currentPassword} onChange={set('currentPassword')} autoComplete="current-password" /></Field>
            <Field label="New password" error={errors.newPassword} hint="At least 10 characters with letters and numbers" htmlFor="np"><input id="np" type="password" value={v.newPassword} onChange={set('newPassword')} autoComplete="new-password" /></Field>
            <Field label="Confirm new password" error={errors.confirm} htmlFor="np2"><input id="np2" type="password" value={v.confirm} onChange={set('confirm')} autoComplete="new-password" /></Field>
            <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
          </form>
        </div>
        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card-head"><h3>Sessions</h3></div>
          <div className="card-body">
            <p className="muted" style={{ marginTop: 0 }}>If you signed in on a shared or lost device, sign out everywhere except here.</p>
            <button className="btn" onClick={signOutOthers}>Sign out other devices</button>
          </div>
        </div>
      </div>
    </>
  );
}
