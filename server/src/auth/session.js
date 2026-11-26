import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';
import { unauthorized, forbidden, HttpError } from '../lib/errors.js';
import { can } from './permissions.js';

/*
 * Server-side sessions stored in the database (works across multiple app instances).
 * - Cookie holds a random 256-bit token; the DB stores only its SHA-256 hash.
 * - Cookie is HttpOnly, SameSite=Lax, Secure in production, and uses the __Host- prefix when Secure.
 * - Each session has its own CSRF token, required in the X-CSRF-Token header for every state-changing request.
 * - Idle timeout and absolute lifetime.
 */
export const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const cookieOpts = maxAge => ({ httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge });

export async function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const maxMs = config.sessionMaxHours * 3600_000;
  await db('sessions').insert({
    id: sha256(token),
    user_id: user.id,
    csrf_token: csrf,
    ip: (req.ip || '').slice(0, 64),
    user_agent: String(req.get('user-agent') || '').slice(0, 255),
    created_at: now,
    last_seen_at: now,
    expires_at: now + maxMs,
  });
  res.cookie(COOKIE, token, cookieOpts(maxMs));
  return csrf;
}

export async function destroySession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await db('sessions').where({ id: sha256(token) }).del();
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
}

/** Attach req.user / req.session when a valid session cookie is present. */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== 'string' || token.length > 100) return next();
  const id = sha256(token);
  const row = await db('sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.id', id)
    .first('s.id', 's.csrf_token', 's.last_seen_at', 's.expires_at', 'u.id as user_id', 'u.name', 'u.email', 'u.role', 'u.active', 'u.must_change_password');
  const now = Date.now();
  const idleMs = config.sessionIdleMinutes * 60_000;
  const active = row && (row.active === true || row.active === 1 || row.active === 't');
  if (!row || !active || Number(row.expires_at) < now || Number(row.last_seen_at) + idleMs < now) {
    if (row) await db('sessions').where({ id }).del();
    res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
    return next();
  }
  const mustChange = row.must_change_password === true || row.must_change_password === 1 || row.must_change_password === 't';
  req.user = { id: row.user_id, name: row.name, email: row.email, role: row.role, mustChangePassword: mustChange };
  req.session = { id, csrf: row.csrf_token };
  if (now - Number(row.last_seen_at) > 60_000) {
    await db('sessions').where({ id }).update({ last_seen_at: now });
  }
  next();
}

/** Reject state-changing requests that do not carry the session's CSRF token. */
export function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.session) return next();
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const expected = Buffer.from(req.session.csrf);
  if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected)) {
    return next(new HttpError(403, 'Security token missing or expired. Please reload the page.', 'CSRF'));
  }
  next();
}

/** Until a person replaces an admin-set password, only the /auth endpoints (me, change-password, logout) work. */
export function requirePasswordChanged(req, res, next) {
  if (req.user?.mustChangePassword && !req.path.startsWith('/auth/')) {
    return next(new HttpError(403, 'Please choose a new password first.', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** requirePerm('sales', 'write') */
export const requirePerm = (area, action = 'read') => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!can(req.user.role, area, action)) return next(forbidden());
  next();
};

export async function purgeExpiredSessions() {
  const idleCutoff = Date.now() - config.sessionIdleMinutes * 60_000;
  return db('sessions').where('expires_at', '<', Date.now()).orWhere('last_seen_at', '<', idleCutoff).del();
}
