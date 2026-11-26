import express from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requirePerm } from '../auth/session.js';
import { ROLES } from '../auth/permissions.js';
import { hashPassword, passwordProblem } from '../lib/password.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { norm, insertedId } from '../lib/util.js';

const router = express.Router();
router.use(requirePerm('users', 'read'));

const COLS = ['id', 'name', 'email', 'role', 'active', 'last_login_at', 'locked_until', 'created_at', 'must_change_password'];
const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email');
const password = z.string({ error: 'Enter a password' }).max(200);
function checkPassword(pw, who) {
  const p = passwordProblem(pw, who);
  if (p) throw badRequest(p, { password: p });
}
const name = z.string().trim().min(1, 'Enter a name').max(100);
const role = z.enum(ROLES, { error: 'Select a role' });

async function activeAdminCount(trx = db, excludeId = null) {
  const q = trx('users').where({ role: 'admin', active: true }).count({ c: 'id' });
  if (excludeId) q.whereNot({ id: excludeId });
  const [{ c }] = await q;
  return Number(c);
}

router.get('/', async (req, res) => {
  const rows = (await db('users').select(COLS).orderBy('name')).map(norm);
  res.json({ rows });
});

router.post('/', requirePerm('users', 'write'), async (req, res) => {
  const body = z.object({ name, email, role, password }).parse(req.body ?? {});
  checkPassword(body.password, body);
  const [ins] = await db('users').insert({
    name: body.name, email: body.email, role: body.role, active: true, password_hash: await hashPassword(body.password),
    must_change_password: true, // the admin chose it, so the person picks their own at first sign-in
  }).returning('id');
  const id = insertedId(ins);
  await audit(req, 'create', 'users', id, { name: body.name, email: body.email, role: body.role });
  res.status(201).json(norm(await db('users').where({ id }).first(COLS)));
});

router.put('/:id', requirePerm('users', 'write'), async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({ name, email, role, active: z.boolean() }).parse(req.body ?? {});
  const user = await db('users').where({ id }).first();
  if (!user) throw notFound('User not found');
  const demoting = user.role === 'admin' && (body.role !== 'admin' || !body.active);
  if (demoting && (await activeAdminCount(db, id)) === 0) {
    throw badRequest('There must be at least one active admin', { role: 'Keep at least one active admin' });
  }
  if (id === req.user.id && !body.active) throw badRequest('You cannot deactivate your own account', { active: 'Not allowed' });
  await db.transaction(async trx => {
    await trx('users').where({ id }).update({ ...body, updated_at: trx.fn.now() });
    if (!body.active || body.role !== user.role) await trx('sessions').where({ user_id: id }).del(); // force re-login
  });
  await audit(req, 'update', 'users', id, { from: { name: user.name, email: user.email, role: user.role, active: !!user.active }, to: body });
  res.json(norm(await db('users').where({ id }).first(COLS)));
});

router.post('/:id/reset-password', requirePerm('users', 'write'), async (req, res) => {
  const id = Number(req.params.id);
  const body = z.object({ password }).parse(req.body ?? {});
  const user = await db('users').where({ id }).first();
  if (!user) throw notFound('User not found');
  checkPassword(body.password, user);
  await db.transaction(async trx => {
    await trx('users').where({ id }).update({
      password_hash: await hashPassword(body.password), failed_attempts: 0, locked_until: null,
      must_change_password: id !== req.user.id, updated_at: trx.fn.now(),
    });
    await trx('sessions').where({ user_id: id }).del();
  });
  await audit(req, 'password_reset', 'users', id);
  res.json({ ok: true });
});

router.post('/:id/unlock', requirePerm('users', 'write'), async (req, res) => {
  const id = Number(req.params.id);
  await db('users').where({ id }).update({ failed_attempts: 0, locked_until: null });
  await audit(req, 'unlock', 'users', id);
  res.json({ ok: true });
});

export default router;
