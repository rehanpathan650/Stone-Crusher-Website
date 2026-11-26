import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

/** Hash with scrypt (memory-hard KDF built into Node). Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Used when the email does not exist, so response time does not reveal which accounts exist. */
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

/** Words that make a password easy to guess once digits and symbols are stripped (e.g. "Password@2026" → "password"). */
const COMMON = new Set(['password', 'passwd', 'pass', 'admin', 'administrator', 'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'zxcvbn', 'welcome', 'letmein',
  'iloveyou', 'abc', 'abcd', 'abcdef', 'abcdefgh', 'india', 'bharat', 'crusher', 'stonecrusher', 'stone', 'test', 'tester', 'user', 'changeme', 'login',
  'monkey', 'dragon', 'master', 'secret', 'sunshine', 'football', 'cricket', 'manager', 'accountant', 'operator', 'default', 'guest', 'root', 'company']);

/**
 * Returns a problem description, or null if the password is acceptable.
 * `who` (optional) is { email, name } so the password cannot simply be the person's own name or email.
 */
export function passwordProblem(pw, who = {}) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain both letters and numbers';
  const letters = pw.toLowerCase().replace(/[^a-z]/g, '');
  if (COMMON.has(letters)) return 'This password is too easy to guess. Use a few unrelated words with numbers';
  if (/^(.)\1+$/.test(letters) || /(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654)/.test(pw) && letters.length < 4) {
    return 'This password is too easy to guess. Use a few unrelated words with numbers';
  }
  const parts = [String(who.email || '').split('@')[0], ...String(who.name || '').split(/\s+/)].map(s => s.toLowerCase().replace(/[^a-z]/g, '')).filter(s => s.length >= 4);
  if (parts.some(p => letters.includes(p) && letters.length - p.length < 4)) return 'Do not base the password on your name or email';
  return null;
}
