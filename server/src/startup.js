import { config } from './config.js';
import { migrate } from './db.js';
import { initSetupToken } from './routes/auth.js';
import { purgeExpiredSessions } from './auth/session.js';
import { log } from './lib/util.js';
import { dailyBackup } from './services/backup.js';

/** The database may still be starting (Docker): retry for about a minute before giving up. */
async function migrateWithRetry(tries = 20) {
  for (let i = 1; ; i++) {
    try {
      return await migrate();
    } catch (e) {
      const transient = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|starting up|terminating|timeout/i.test(String(e?.message) + String(e?.code));
      if (!transient || i >= tries) throw e;
      log.warn('database not ready, retrying', { attempt: i, err: e.message });
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

let timersStarted = false;

/**
 * Everything the API needs before serving: migrations, the first-run setup code, and (on a normal,
 * long-running server) background timers. Serverless hosting runs maintenance through a cron request instead.
 */
export async function startServer() {
  await migrateWithRetry();
  await initSetupToken();
  if (config.serverless || timersStarted) return;
  timersStarted = true;
  const purge = setInterval(() => purgeExpiredSessions().catch(e => log.error('session purge failed', { err: e.message })), 3600_000);
  purge.unref?.();
  if (config.backupEnabled) {
    const backup = () => dailyBackup().catch(e => log.error('daily backup failed', { err: e.message }));
    setTimeout(backup, 30_000).unref?.(); // shortly after start, then an hourly check (at most one file per day)
    setInterval(backup, 3600_000).unref?.();
  }
}
