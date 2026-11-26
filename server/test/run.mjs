/**
 * Integration test runner: starts the real server on a throwaway SQLite database and a free port,
 * runs every *.test.mjs file in order against it, then shuts it down and deletes the database.
 *   npm test                 (from the server folder)
 *   TEST_BASE=http://host:port/api npm test   (run against an already-running server instead)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

let base = process.env.TEST_BASE;
let child, tmp;
if (!base) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crusher-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: '', SQLITE_FILE: path.join(tmp, 'test.db'),
      SETUP_TOKEN: 'test-setup-code', BACKUP_DIR: path.join(tmp, 'backups'), API_RATE_LIMIT_PER_MINUTE: '100000', LOGIN_RATE_LIMIT: '1000', COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { /* not up yet */ }
    if (i > 60) { console.error('Server did not start:\n' + log); process.exit(1); }
    await new Promise(r => setTimeout(r, 250));
  }
  process.on('exit', () => { child.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
  child.serverLog = () => log;
}

const files = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const f of files) {
  const code = await new Promise(res => {
    const p = spawn(process.execPath, [path.join(here, f)], { env: { ...process.env, BASE: base }, stdio: 'inherit' });
    p.on('exit', res);
  });
  if (code !== 0) failed++;
}
const errors = child ? child.serverLog().split('\n').filter(l => l.includes('"level":"error"')) : [];
if (errors.length) { console.log('\nServer errors:\n' + errors.slice(0, 5).join('\n')); failed++; }
console.log(failed ? `\n${failed} test file(s) failed` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
