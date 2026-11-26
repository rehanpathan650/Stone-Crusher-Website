import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, DUMMY_HASH, passwordProblem } from '../lib/password.js';
import { createSession, destroySession, requireAuth } from '../auth/session.js';
import { permissionsFor } from '../auth/permissions.js';
import { audit } from '../lib/audit.js';
import { HttpError, badRequest, forbidden } from '../lib/errors.js';
import { insertedId, log } from '../lib/util.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.loginRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Try again in 15 minutes.', code: 'RATE_LIMIT' },
});

const email = z.string({ error: 'Enter your email' }).trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email');
const strongPassword = z.string({ error: 'Enter a password' }).max(200);
/** Runs the password policy with the person's own name/email, reporting on the given field. */
function checkPassword(pw, who, field = 'password') {
  const p = passwordProblem(pw, who);
  if (p) throw badRequest(p, { [field]: p });
}

const isTrue = v => v === true || v === 1 || v === '1' || v === 't';
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, mustChangePassword: isTrue(u.must_change_password ?? u.mustChangePassword) });
const mePayload = (user, csrfToken) => ({ user: publicUser(user), csrfToken, permissions: permissionsFor(user.role) });

/* ---------- First-run setup (creates the first admin; requires the one-time token printed in the server log) ---------- */
let setupToken = null;
export async function initSetupToken() {
  const [{ count }] = await db('users').count({ count: 'id' });
  if (Number(count) > 0) return;
  if (config.serverless && !config.setupToken) {
    // Each serverless instance would invent a different random code, so a fixed one must be configured.
    log.warn('No users exist yet. Set SETUP_TOKEN in the hosting environment to create the first admin.');
    return;
  }
  setupToken = config.setupToken || crypto.randomBytes(9).toString('base64url');
  log.info('No users exist yet. Open the app and create the admin account with this setup code.', { setupCode: setupToken });
  console.log(`\n  >>> First-run setup code: ${setupToken}\n`);
}

/** Public: whether first-run setup is needed, plus the business name and logo for the sign-in screen (both are printed on every invoice anyway). */
router.get('/status', async (req, res) => {
  const [[{ count }], rows] = await Promise.all([
    db('users').count({ count: 'id' }),
    db('settings').whereIn('key', ['business_name', 'logo']).select('key', 'value'),
  ]);
  const s = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ needsSetup: Number(count) === 0, businessName: s.business_name || '', logo: s.logo || '' });
});

router.post('/setup', loginLimiter, async (req, res) => {
  const body = z.object({ setupCode: z.string().max(200), name: z.string().trim().min(1, 'Enter your name').max(100), email, password: strongPassword }).parse(req.body ?? {});
  const [{ count }] = await db('users').count({ count: 'id' });
  if (Number(count) > 0) throw forbidden('Setup has already been completed.');
  if (!setupToken) throw new HttpError(503, 'Setup is not configured. Set SETUP_TOKEN in the server environment, then redeploy.', 'SETUP_NOT_CONFIGURED');
  checkPassword(body.password, body);
  const a = Buffer.from(body.setupCode.trim()), b = Buffer.from(setupToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw badRequest('Setup code is incorrect', { setupCode: 'Incorrect code — see the server console' });
  const [ins] = await db('users').insert({
    name: body.name, email: body.email, role: 'admin', password_hash: await hashPassword(body.password), active: true,
  }).returning('id');
  setupToken = null;
  const user = await db('users').where({ id: insertedId(ins) }).first();
  req.user = user;
  await audit(req, 'setup', 'users', user.id, { email: user.email });
  const csrf = await createSession(req, res, user);
  res.status(201).json(mePayload(user, csrf));
});

/* ---------- Login / logout ---------- */
router.post('/login', loginLimiter, async (req, res) => {
  const body = z.object({ email, password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200) }).parse(req.body ?? {});
  const user = await db('users').where({ email: body.email }).first();
  const now = Date.now();
  const invalid = () => new HttpError(401, 'Incorrect email or password', 'INVALID_CREDENTIALS');

  if (!user) {
    await verifyPassword(body.password, DUMMY_HASH); // equalise timing
    await audit(req, 'login_failed', 'users', null, { email: body.email });
    throw invalid();
  }
  if (user.locked_until && Number(user.locked_until) > now) {
    const mins = Math.ceil((Number(user.locked_until) - now) / 60_000);
    throw new HttpError(423, `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 'LOCKED');
  }
  const ok = await verifyPassword(body.password, user.password_hash);
  const active = user.active === true || user.active === 1;
  if (!ok || !active) {
    if (!ok) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const lock = attempts >= config.loginMaxAttempts;
      await db('users').where({ id: user.id }).update({
        failed_attempts: lock ? 0 : attempts,
        locked_until: lock ? now + config.loginLockMinutes * 60_000 : null,
      });
      req.user = user;
      await audit(req, lock ? 'account_locked' : 'login_failed', 'users', user.id, { email: user.email });
    }
    if (ok && !active) throw new HttpError(403, 'This account has been deactivated. Contact your administrator.', 'INACTIVE');
    throw invalid();
  }
  await db('users').where({ id: user.id }).update({ failed_attempts: 0, locked_until: null, last_login_at: now });
  if (req.session) await db('sessions').where({ id: req.session.id }).del(); // never keep the browser's previous session
  req.user = user;
  await audit(req, 'login', 'users', user.id);
  const csrf = await createSession(req, res, user);
  res.json(mePayload(user, csrf));
});

router.post('/logout', async (req, res) => {
  if (req.user) await audit(req, 'logout', 'users', req.user.id);
  await destroySession(req, res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json(mePayload(req.user, req.session.csrf));
});

router.post('/change-password', requireAuth, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword: strongPassword }).parse(req.body ?? {});
  const user = await db('users').where({ id: req.user.id }).first();
  if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
    throw badRequest('Current password is incorrect', { currentPassword: 'Incorrect password' });
  }
  if (body.currentPassword === body.newPassword) throw badRequest('Choose a different password', { newPassword: 'Must differ from the current password' });
  checkPassword(body.newPassword, user, 'newPassword');
  await db.transaction(async trx => {
    await trx('users').where({ id: user.id }).update({ password_hash: await hashPassword(body.newPassword), must_change_password: false, updated_at: trx.fn.now() });
    await trx('sessions').where({ user_id: user.id }).whereNot({ id: req.session.id }).del(); // sign out other devices
  });
  await audit(req, 'password_change', 'users', user.id);
  res.json({ ok: true, ...mePayload({ ...user, must_change_password: false }, req.session.csrf) });
});

router.post('/logout-others', requireAuth, async (req, res) => {
  const n = await db('sessions').where({ user_id: req.user.id }).whereNot({ id: req.session.id }).del();
  await audit(req, 'logout_others', 'users', req.user.id, { sessions: n });
  res.json({ ended: n });
});

export default router;
