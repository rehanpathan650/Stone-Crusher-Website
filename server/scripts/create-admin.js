/**
 * Create or reset an admin from the command line (useful if you are locked out).
 *   npm run create-admin -- --email you@example.com --name "Your Name"
 * The password is read from the ADMIN_PASSWORD environment variable or typed interactively (not echoed to history).
 */
import readline from 'node:readline';
import { db, migrate } from '../src/db.js';
import { hashPassword, passwordProblem } from '../src/lib/password.js';

const arg = k => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a); }));
}

const email = String(arg('email') || '').trim().toLowerCase();
const name = arg('name') || 'Administrator';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- --email you@example.com [--name "Your Name"]');
  process.exit(1);
}
await migrate();
const password = process.env.ADMIN_PASSWORD || (await ask('New password: '));
const problem = passwordProblem(password, { email });
if (problem) {
  console.error(problem);
  process.exit(1);
}
const password_hash = await hashPassword(password);
const existing = await db('users').where({ email }).first();
if (existing) {
  await db('users').where({ id: existing.id }).update({ password_hash, role: 'admin', active: true, failed_attempts: 0, locked_until: null });
  await db('sessions').where({ user_id: existing.id }).del();
  console.log(`Updated ${email}: now an active admin with the new password.`);
} else {
  await db('users').insert({ email, name, role: 'admin', active: true, password_hash });
  console.log(`Created admin ${email}.`);
}
await db.destroy();
