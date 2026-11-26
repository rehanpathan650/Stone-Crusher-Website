// Tiny API client for the integration tests. The runner (run.mjs) starts a throwaway server and sets BASE.
export const BASE = process.env.BASE || 'http://127.0.0.1:4200/api';
let failures = 0;

export class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== 'GET' && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
    if (data && data.csrfToken) this.csrf = data.csrfToken;
    return { status: r.status, data, headers: r.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  put(p, b) { return this.req('PUT', p, b ?? {}); }
  del(p) { return this.req('DELETE', p); }
  async login(email, password) {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.data));
    return this;
  }
}

export function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
export const done = () => { console.log(failures ? `\n${failures} FAILED` : '\nall passed'); process.exitCode = failures ? 1 : 0; };

// Test-only accounts for the throwaway test database.
export const ADMIN = { email: 'admin@example.test', password: 'TestAdminPass2026' };
export const OP = { email: 'op@example.test', password: 'TestOperPass2026' };
export const ACC = { email: 'acc@example.test', password: 'TestAcctPass2026' };
export const SETUP_CODE = process.env.SETUP_TOKEN || 'test-setup-code';

/**
 * Admin client, creating the admin + operator + accountant on a fresh database.
 * Admin-created accounts must replace their password at first sign-in, so each one does that here.
 */
export async function bootstrap() {
  const a = new Client();
  const st = await a.get('/auth/status');
  if (st.data.needsSetup) {
    await a.post('/auth/setup', { setupCode: SETUP_CODE, name: 'Test Admin', ...ADMIN });
    for (const [u, role, name] of [[OP, 'operator', 'Op'], [ACC, 'accountant', 'Acc']]) {
      const temp = `Temp${u.password}9`;
      await a.post('/users', { name, role, email: u.email, password: temp });
      const c = await new Client().login(u.email, temp);
      await c.post('/auth/change-password', { currentPassword: temp, newPassword: u.password });
    }
  } else await a.login(ADMIN.email, ADMIN.password);
  return a;
}
