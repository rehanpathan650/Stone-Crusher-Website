import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SERVER_ROOT is set by the Next.js API route (bundled code no longer sits next to its files).
const root = process.env.SERVER_ROOT ? path.resolve(process.env.SERVER_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
function trustProxy(v) {
  if (v === undefined || v === '') return false;
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v; // e.g. "loopback" or a CIDR list
}

export const config = Object.freeze({
  env,
  isProd,
  root,
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  // PostgreSQL in production: postgres://user:pass@host:5432/db  (empty = local SQLite file)
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  // Only for databases with self-signed certificates; managed databases (Neon etc.) have valid certificates and are verified.
  databaseSslInsecure: bool(process.env.DATABASE_SSL_INSECURE, false),
  // Running as serverless functions (Vercel): no local files, no timers.
  serverless: Boolean(process.env.VERCEL),
  cronSecret: process.env.CRON_SECRET || '',
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  sqliteFile: path.resolve(root, process.env.SQLITE_FILE || 'data/app.db'),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  cookieSecure: bool(process.env.COOKIE_SECURE, isProd),
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 720),
  sessionMaxHours: Number(process.env.SESSION_MAX_HOURS || 168),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 5),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
  apiRateLimitPerMinute: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 600),
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT || 20), // sign-in attempts per IP per 15 minutes
  setupToken: process.env.SETUP_TOKEN || '',
  // Automatic daily backups (JSON). Keep this folder on a persistent volume and copy it off the server regularly.
  backupDir: path.resolve(root, process.env.BACKUP_DIR || 'data/backups'),
  backupKeep: Math.max(1, Number(process.env.BACKUP_KEEP || 14)),
  backupEnabled: bool(process.env.BACKUP_ENABLED, true),
});
