import { config } from './config.js';
import { db, migrate, isPg } from './db.js';
import { createApp } from './app.js';
import { initSetupToken } from './routes/auth.js';
import { purgeExpiredSessions } from './auth/session.js';
import { log } from './lib/util.js';
import { dailyBackup } from './services/backup.js';

/** The database container may still be starting: retry for about a minute before giving up. */
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

// Never crash silently: log, then exit so Docker's restart policy brings the app back in a clean state.
process.on('unhandledRejection', err => log.error('unhandled promise rejection', { err: err?.message, stack: err?.stack }));
process.on('uncaughtException', err => {
  log.error('uncaught exception, exiting', { err: err?.message, stack: err?.stack });
  process.exit(1);
});

async function main() {
  await migrateWithRetry();
  await initSetupToken();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info('server started', { url: `http://${config.host}:${config.port}`, env: config.env, database: isPg ? 'postgresql' : 'sqlite' });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

  const purge = setInterval(() => purgeExpiredSessions().catch(e => log.error('session purge failed', { err: e.message })), 3600_000);
  purge.unref();

  if (config.backupEnabled) {
    const backup = () => dailyBackup().catch(e => log.error('daily backup failed', { err: e.message }));
    setTimeout(backup, 30_000).unref(); // shortly after start, then hourly check (writes at most one file per day)
    setInterval(backup, 3600_000).unref();
  }

  const shutdown = signal => {
    log.info('shutting down', { signal });
    server.close(async () => {
      await db.destroy();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  log.error('failed to start', { err: err.message, stack: err.stack });
  process.exit(1);
});
