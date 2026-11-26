import { bootstrap, Client, check, done, OP, BASE } from './helpers.mjs';

const a = await bootstrap();
console.log('Security');

// Unauthenticated / CSRF
const anon = new Client();
check('API needs sign-in', (await anon.get('/sales')).status === 401);
const noCsrf = await fetch(BASE + '/parties', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: a.cookie }, body: '{"name":"x","type":"customer"}' });
check('change without CSRF token rejected', noCsrf.status === 403);

// Public status reveals nothing sensitive
const st = await anon.get('/auth/status');
check('public status has only setup flag + branding', JSON.stringify(Object.keys(st.data).sort()) === JSON.stringify(['businessName', 'logo', 'needsSetup']), st.data);

// Security headers
const h = (await anon.get('/health')).headers;
check('CSP header', /default-src 'self'/.test(h.get('content-security-policy') || ''));
check('Permissions-Policy header', /camera=\(\)/.test(h.get('permissions-policy') || ''));
check('nosniff + frame protection', h.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'none'/.test(h.get('content-security-policy')));
check('no X-Powered-By', !h.get('x-powered-by'));

// Password policy
let r = await a.post('/users', { name: 'Weak One', email: 'weak@example.test', role: 'operator', password: 'Password@2026' });
check('common password rejected', r.status === 400 && /too easy/.test(r.data.fields?.password || ''), r.data);
r = await a.post('/users', { name: 'Ramesh Kumar', email: 'ramesh@example.test', role: 'operator', password: 'Ramesh12345' });
check('password based on own name rejected', r.status === 400 && /name or email/.test(r.data.fields?.password || ''), r.data);
r = await a.post('/users', { name: 'Short', email: 'short@example.test', role: 'operator', password: 'abc123' });
check('short password rejected', r.status === 400, r.data);

// Admin-set passwords must be replaced at first sign-in
r = await a.post('/users', { name: 'New Staff', email: 'new@example.test', role: 'manager', password: 'TempStart7391x' });
check('user created', r.status === 201 && r.data.must_change_password !== false, r.data);
const newId = r.data.id;
const n = new Client();
r = await n.post('/auth/login', { email: 'new@example.test', password: 'TempStart7391x' });
check('sign-in flags required password change', r.status === 200 && r.data.user.mustChangePassword === true, r.data);
check('everything else blocked until changed', (await n.get('/sales')).status === 403 && (await n.get('/dashboard')).data.code === 'PASSWORD_CHANGE_REQUIRED');
check('/auth/me still works', (await n.get('/auth/me')).status === 200);
r = await n.post('/auth/change-password', { currentPassword: 'TempStart7391x', newPassword: 'qwerty12345' });
check('weak new password rejected', r.status === 400 && r.data.fields?.newPassword, r.data);
r = await n.post('/auth/change-password', { currentPassword: 'TempStart7391x', newPassword: 'Gravel Truck 8842' });
check('own password accepted, flag cleared', r.status === 200 && r.data.user.mustChangePassword === false, r.data);
check('access works after change', (await n.get('/sales')).status === 200);
await a.post(`/users/${newId}/reset-password`, { password: 'ResetTemp5521z' });
r = await new Client().post('/auth/login', { email: 'new@example.test', password: 'ResetTemp5521z' });
check('admin reset requires change again', r.status === 200 && r.data.user.mustChangePassword === true, r.data);

// Signing in again ends the previous session in that browser
const s = new Client();
await s.login(OP.email, OP.password);
const oldCookie = s.cookie;
await s.post('/auth/login', { email: OP.email, password: OP.password });
const stale = await fetch(BASE + '/auth/me', { headers: { cookie: oldCookie } });
check('previous session invalidated on new sign-in', s.cookie !== oldCookie && stale.status === 401);

// Privilege escalation & injection attempts
const op = await new Client().login(OP.email, OP.password);
check('operator cannot list or edit users', (await op.get('/users')).status === 403 && (await op.put(`/users/${newId}`, { name: 'x', email: 'x@example.test', role: 'admin', active: true })).status === 403);
check('operator cannot back up or restore', (await op.get('/admin/backup')).status === 403 && (await op.post('/admin/restore', { confirm: 'RESTORE', backup: {} })).status === 403);
r = await a.get(`/sales?q=${encodeURIComponent("' OR 1=1 --")}`);
check('SQL-like search is treated as text', r.status === 200 && r.data.total === 0, r.data);
r = await a.get('/sales?sort=id;drop%20table%20users&dir=asc');
check('unknown sort column ignored', r.status === 200);
r = await a.post('/parties', { name: 'Evil', type: 'customer', unexpected_col: 'x', id: 999999 });
check('unknown fields and ids are dropped', r.status === 201 && r.data.id !== 999999 && !('unexpected_col' in r.data), r.data);

// Lockout after repeated failures
for (let i = 0; i < 5; i++) await new Client().post('/auth/login', { email: 'new@example.test', password: 'wrong-password-1' });
r = await new Client().post('/auth/login', { email: 'new@example.test', password: 'ResetTemp5521z' });
check('account locks after 5 failures', r.status === 423 && r.data.code === 'LOCKED', r.data);
done();
