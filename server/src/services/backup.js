import fs from 'node:fs';
import path from 'node:path';
import { db, isPg } from '../db.js';
import { config } from '../config.js';
import { log, today } from '../lib/util.js';

/** Parents before children, so inserts satisfy foreign keys (and deletes run in reverse). Sessions are never backed up. */
export const TABLES = ['users', 'settings', 'materials', 'parties', 'vehicles', 'employees', 'sales', 'purchases', 'production', 'expenses',
  'payments', 'attendance', 'credit_notes', 'weighments', 'royalty_permits', 'diesel_logs', 'maintenance', 'payroll_adjustments', 'audit_logs'];
const APP = 'stone-crusher-manager';
/** Errors safe to show to the admin (our own validation); anything else is reported generically. */
const fail = message => Object.assign(new Error(message), { userFacing: true });

async function schemaVersion() {
  const row = await db('knex_migrations').orderBy('id', 'desc').first('name');
  return row?.name || 'none';
}

/** Full snapshot of business data as JSON (includes password hashes, so the file is as sensitive as the database). */
export async function createBackup() {
  const tables = {};
  for (const t of TABLES) tables[t] = await db(t).select('*').orderBy(t === 'settings' ? 'key' : 'id');
  return { app: APP, schema: await schemaVersion(), database: isPg ? 'postgresql' : 'sqlite', created_at: new Date().toISOString(), tables };
}

/** Replaces all business data with a backup made by the same app version. Everyone is signed out afterwards. */
export async function restoreBackup(data) {
  if (!data || data.app !== APP || typeof data.tables !== 'object') throw fail('This file is not a Stone Crusher Manager backup.');
  const current = await schemaVersion();
  if (data.schema !== current) throw fail(`This backup is from a different app version (${data.schema}). This server is on ${current}.`);
  for (const t of TABLES) {
    if (!Array.isArray(data.tables[t])) throw fail(`The backup is missing the "${t}" table.`);
  }
  if (!data.tables.users.some(u => u.role === 'admin' && (u.active === true || u.active === 1 || u.active === '1'))) {
    throw fail('The backup has no active admin account, so nobody could sign in after restoring.');
  }
  const counts = {};
  await db.transaction(async trx => {
    const columns = {};
    for (const t of TABLES) columns[t] = new Set(Object.keys(await trx(t).columnInfo()));
    await trx('sessions').del();
    for (const t of [...TABLES].reverse()) await trx(t).del();
    for (const t of TABLES) {
      const rows = data.tables[t].map(r => {
        if (!r || typeof r !== 'object' || Array.isArray(r)) throw fail(`A row in "${t}" is not valid.`);
        const bad = Object.keys(r).find(k => !columns[t].has(k));
        if (bad) throw fail(`Unknown column "${bad}" in "${t}".`);
        return r;
      });
      if (rows.length) await trx.batchInsert(t, rows, 200);
      counts[t] = rows.length;
      if (isPg && t !== 'settings') {
        await trx.raw(`select setval(pg_get_serial_sequence(?, 'id'), coalesce(max(id), 1), max(id) is not null) from ??`, [t, t]);
      }
    }
  });
  return counts;
}

/* ---------------- Daily backup files ---------------- */
const FILE_RE = /^backup-\d{4}-\d{2}-\d{2}\.json$/;
export const backupDir = () => config.backupDir;

export function listBackups() {
  if (!fs.existsSync(backupDir())) return [];
  return fs.readdirSync(backupDir()).filter(f => FILE_RE.test(f)).sort().reverse()
    .map(f => ({ name: f, size: fs.statSync(path.join(backupDir(), f)).size }));
}
export function backupPath(name) {
  if (!FILE_RE.test(name)) return null;
  const p = path.join(backupDir(), name);
  return fs.existsSync(p) ? p : null;
}

/** Writes today's backup once per day and keeps the newest `config.backupKeep` files. */
export async function dailyBackup() {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `backup-${today()}.json`;
  const file = path.join(backupDir(), name);
  if (fs.existsSync(file)) return null;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(await createBackup()), { mode: 0o600 });
  fs.renameSync(tmp, file);
  for (const old of listBackups().slice(config.backupKeep)) fs.rmSync(path.join(backupDir(), old.name), { force: true });
  log.info('daily backup written', { file: name });
  return name;
}
