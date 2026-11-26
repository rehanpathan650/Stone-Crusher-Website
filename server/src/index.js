/**
 * Standalone API server (no screens). Used by the test runner (npm test) and for running the API on its own.
 * The full app (screens + API) runs with Next.js: npm run dev / npm run build && npm start.
 */
import { config } from './config.js';
import { db, isPg } from './db.js';
import { createApp } from './app.js';
import { log } from './lib/util.js';
import { startServer } from './startup.js';

// Never crash silently: log, then exit so Docker's restart policy brings the app back in a clean state.
process.on('unhandledRejection', err => log.error('unhandled promise rejection', { err: err?.message, stack: err?.stack }));
process.on('uncaughtException', err => {
  log.error('uncaught exception, exiting', { err: err?.message, stack: err?.stack });
  process.exit(1);
});

async function main() {
  await startServer();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info('server started', { url: `http://${config.host}:${config.port}`, env: config.env, database: isPg ? 'postgresql' : 'sqlite' });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;

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
