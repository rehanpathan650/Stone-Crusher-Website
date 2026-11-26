import express from 'express';
import { requireAuth, requirePerm, COOKIE } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { today, log } from '../lib/util.js';
import { createBackup, restoreBackup, listBackups, backupPath, dailyBackup } from '../services/backup.js';
import { config } from '../config.js';

const NO_FILES = 'Automatic backup files are not available on this hosting (it has no permanent disk). Use "Download backup now" and your database provider\'s backups.';

const router = express.Router();
router.use(requireAuth, requirePerm('backup'));

/** Download a fresh backup now. */
router.get('/backup', async (req, res) => {
  const data = await createBackup();
  await audit(req, 'backup', 'system', null, { rows: Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length])) });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="stone-crusher-backup-${today()}.json"`);
  res.send(JSON.stringify(data));
});

/** Daily automatic backups kept on the server. */
router.get('/backups', (req, res) => res.json(config.serverless ? { rows: [], unavailable: NO_FILES } : { rows: listBackups() }));
router.post('/backups/run', async (req, res) => {
  if (config.serverless) throw badRequest(NO_FILES);
  const name = await dailyBackup();
  res.json({ created: name, rows: listBackups() });
});
router.get('/backups/:name', async (req, res) => {
  const file = backupPath(req.params.name);
  if (!file) throw notFound('Backup not found');
  await audit(req, 'backup_download', 'system', req.params.name);
  res.download(file, req.params.name);
});

/** Replace all data with an uploaded backup. Everyone (including you) is signed out afterwards. */
router.post('/restore', async (req, res) => {
  if (req.body?.confirm !== 'RESTORE') throw badRequest('Type RESTORE to confirm', { confirm: 'Type RESTORE to confirm' });
  let counts;
  try {
    counts = await restoreBackup(req.body.backup);
  } catch (e) {
    log.warn('restore rejected', { err: e.message });
    throw badRequest(e.userFacing ? e.message : 'The backup could not be restored. Nothing was changed.');
  }
  await audit(null, 'restore', 'system', null, { by: req.user.email, rows: counts });
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true, rows: counts });
});

export default router;
