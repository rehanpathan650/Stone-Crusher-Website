/**
 * Every /api/* request is handled by the existing Express API (server/src/app.js): the same routes,
 * validation, permissions and business rules covered by server/test. Next.js only hosts it.
 *
 * On the first request in each server process (or serverless instance):
 *  - database migrations run (guarded by knex's migration lock, so parallel instances are safe);
 *  - the first-run setup code is prepared;
 *  - on a normal server (Docker, `next start`): hourly session purge + daily backup timers.
 *    On Vercel these are replaced by the daily cron request (/api/cron/daily).
 */
import path from 'node:path';

process.env.SERVER_ROOT ??= path.join(process.cwd(), 'server'); // where migrations and data live
// Next.js always passes the visitor's address in X-Forwarded-For (as do Caddy and Vercel in front of it):
// trust that one hop so rate limits see real visitor addresses.
process.env.TRUST_PROXY ??= '1';
if (process.env.VERCEL) process.env.DB_POOL_MAX ??= '3'; // keep few connections per serverless instance

const { createApp } = await import('../../../server/src/app.js');
const { startServer } = await import('../../../server/src/startup.js');
const { log } = await import('../../../server/src/lib/util.js');

export const config = { api: { bodyParser: false, externalResolver: true, responseLimit: false } };

const app = createApp();
let ready = null;
const warmUp = () => {
  ready ??= startServer().catch(err => {
    ready = null; // try again on the next request
    log.error('startup failed', { err: err.message });
    throw err;
  });
  return ready;
};

export default async function handler(req, res) {
  try {
    await warmUp();
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'The server is starting up or cannot reach the database. Please try again shortly.', code: 'UNAVAILABLE' }));
  }
  return app(req, res);
}
