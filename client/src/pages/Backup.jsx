import { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { PageHeader, Empty, NoAccess, Field } from '../components/ui.jsx';
import { api, exportUrl } from '../lib/api.js';
import { useAuth, useToast } from '../context.jsx';

const kb = n => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Admin: download a backup, see daily automatic backups, restore from a file. */
export default function Backup() {
  const { can, refresh } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [unavailable, setUnavailable] = useState('');
  const [restore, setRestore] = useState(null); // { file, data }
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/admin/backups').then(d => { setRows(d.rows); setUnavailable(d.unavailable || ''); }).catch(e => toast(e.message, 'error')), [toast]);
  useEffect(() => { if (can('backup')) load(); }, [load, can]);
  if (!can('backup')) return <NoAccess />;

  const runNow = async () => {
    try {
      const d = await api('/admin/backups/run', { method: 'POST' });
      setRows(d.rows);
      toast(d.created ? 'Backup saved on the server' : "Today's backup already exists");
    } catch (e) { toast(e.message, 'error'); }
  };

  const pick = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 55 * 1024 * 1024) return toast('That file is too large to be a backup', 'error');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data?.app !== 'stone-crusher-manager') throw new Error();
        setRestore({ file, data });
        setConfirmText('');
      } catch {
        toast('This is not a Stone Crusher Manager backup file', 'error');
      }
    };
    reader.readAsText(file);
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      await api('/admin/restore', { method: 'POST', body: { confirm: confirmText, backup: restore.data } });
      toast('Data restored. Please sign in again.');
      setRestore(null);
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts = restore ? Object.entries(restore.data.tables || {}).filter(([, v]) => Array.isArray(v) && v.length) : [];

  return (
    <>
      <PageHeader title="Backup & restore" description="Keep a copy of your data somewhere safe, away from this computer.">
        <a className="btn btn-primary" href={exportUrl('/admin/backup')} download><Icon name="download" size={16} /> Download backup now</a>
      </PageHeader>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Automatic daily backups</h3><span className="spacer" />{!unavailable && <button className="btn btn-sm" onClick={runNow}>Run today's backup</button>}</div>
          {unavailable ? <Empty title="Not available on this hosting" icon="database">{unavailable}</Empty>
            : !rows ? <div className="loading-bar" /> : !rows.length ? <Empty title="No backups yet">The server writes one every day.</Empty> : (
            <div className="table-wrap">
              <table className="table-cards">
                <thead><tr><th>File</th><th className="num">Size</th><th className="actions" /></tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.name}><td className="mono">{r.name}</td><td className="num">{kb(r.size)}</td>
                    <td className="actions"><a className="icon-btn" href={exportUrl(`/admin/backups/${r.name}`)} download title="Download" aria-label={`Download ${r.name}`}><Icon name="download" size={16} /></a></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="pager">The newest 14 are kept on the server. Download one regularly and store it on another device or a pen drive.</div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Restore from a backup</h3></div>
          <div className="card-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Replaces <b>all</b> current data with the backup, including users and passwords. Everyone is signed out.
              Download a backup of the current data first.
            </p>
            <label className="btn">
              <Icon name="upload" size={16} /> Choose backup file…
              <input type="file" accept="application/json,.json" onChange={pick} hidden />
            </label>
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="card-body">
          <h3 className="section-title"><Icon name="alert" size={16} /> Keep backups private</h3>
          <p className="muted" style={{ margin: 0 }}>A backup contains all business data and the (encrypted) passwords of every user. Treat the file like the keys to the business.</p>
        </div>
      </div>

      {restore && (
        <Modal title="Restore this backup?" onClose={() => !busy && setRestore(null)}>
          <p style={{ marginTop: 0 }}>
            <b>{restore.file.name}</b>, made {new Date(restore.data.created_at).toLocaleString('en-IN')}.
          </p>
          <div className="restore-counts">{counts.map(([t, v]) => <span key={t}>{t.replace(/_/g, ' ')}: <b>{v.length}</b></span>)}</div>
          <div className="alert alert-error mt">Everything currently in the app will be replaced. This cannot be undone.</div>
          <Field label="Type RESTORE to confirm" htmlFor="confirm-restore">
            <input id="confirm-restore" value={confirmText} onChange={e => setConfirmText(e.target.value)} autoComplete="off" />
          </Field>
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn" onClick={() => setRestore(null)} disabled={busy}>Cancel</button>
            <button className="btn btn-danger" disabled={confirmText !== 'RESTORE' || busy} onClick={doRestore}>{busy ? 'Restoring…' : 'Replace all data'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
