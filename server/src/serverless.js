/**
 * Entry point for serverless hosting (Vercel). The same Express app as src/index.js, but:
 *  - no long-running timers: expired sessions are purged by a daily cron request instead (see /api/cron/daily);
 *  - database migrations run once per cold start, guarded by knex's migration lock;
 *  - no local files: daily backup files are disabled (use the database provider's backups and "Download backup now").
 */
process.env.TRUST_PROXY ??= '1'; // Vercel's edge is the one proxy in front of the function
process.env.DB_POOL_MAX ??= '3'; // each function instance keeps only a few connections

const { createApp } = await import('./app.js');
const { migrate } = await import('./db.js');
const { initSetupToken } = await import('./routes/auth.js');
const { log } = await import('./lib/util.js');

let ready = null;
function warmUp() {
  ready ??= (async () => {
    await migrate();
    await initSetupToken();
  })().catch(err => {
    ready = null; // let the next request try again
    log.error('startup failed', { err: err.message });
    throw err;
  });
  return ready;
}

const app = createApp();

export default async function handler(req, res) {
  try {
    await warmUp();
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'The server is starting up or cannot reach the database. Please try again shortly.', code: 'UNAVAILABLE' }));
  }
  return app(req, res);
}
