import { bootstrap, Client, check, done, OP, ACC, BASE } from './helpers.mjs';

const a = await bootstrap();
console.log('Modules 5–6: reports, GST, Excel, notifications, backup');
await a.put('/settings', { business_name: 'Test Crushers', state: 'Rajasthan', gstin: '08ABCDE1234F1Z5', bill_prefix: 'INV', credit_prefix: 'CN', currency: '₹', opening_cash: 10000, opening_bank: 50000, large_expense: 20000 });
const mats = (await a.get('/materials?pageSize=50')).data.rows;
const m40 = mats.find(m => m.name.startsWith('40')), raw = mats.find(m => m.is_raw);

// Production with downtime and yield
let r = await a.post('/production', { date: '2026-10-10', shift: 'Day', material_id: m40.id, qty: 90, raw_material_id: raw.id, raw_qty: 100, run_hours: 8, downtime_hours: 2, downtime_reason: 'Power cut' });
check('production with downtime', r.status === 201 && r.data.downtime_hours === 2, r.data);
r = await a.post('/production', { date: '2026-10-10', material_id: m40.id, qty: 1, run_hours: 20, downtime_hours: 5, downtime_reason: 'Weather' });
check('run + downtime > 24 rejected', r.status === 400, r.data);
r = await a.post('/production', { date: '2026-10-10', material_id: m40.id, qty: 1, downtime_hours: 1 });
check('downtime needs a reason', r.status === 400 && r.data.fields?.downtime_reason, r.data);
await a.post('/production', { date: '2026-10-11', material_id: m40.id, qty: 500 });

// Ageing: customer with bills at 100, 70, 40 and 10 days old, partly paid
const asof = '2026-11-26';
const cust = (await a.post('/parties', { name: 'Ageing Customer', type: 'customer', phone: '9000000001', gstin: '08AAACA1111A1Z1' })).data;
const sale = (date, amt) => a.post('/sales', { date, party_id: cust.id, material_id: m40.id, qty: amt / 1000, rate: 1000, gst_pct: 0, paid: 0, mode: 'Credit', allow_negative_stock: true });
await sale('2026-08-18', 10000); await sale('2026-09-17', 20000); await sale('2026-10-17', 30000); await sale('2026-11-16', 40000);
await a.post('/payments', { date: '2026-11-20', direction: 'in', party_id: cust.id, amount: 25000, mode: 'Bank Transfer' }); // clears 100-day bill + half of 70-day bill
const ag = (await a.get(`/reports/ageing?asof=${asof}`)).data;
const ar = ag.rows.find(x => x.id === cust.id);
check('ageing FIFO buckets', ar && ar.balance === 75000 && ar['0-30'] === 40000 && ar['31-60'] === 30000 && ar['61-90'] === 5000 && ar['90+'] === 0, ar);

// Cash / bank book
await a.post('/expenses', { date: '2026-11-21', category: 'Electricity', amount: 30000, mode: 'Bank Transfer', description: 'Power bill' });
await a.post('/expenses', { date: '2026-11-21', category: 'Food & Welfare', amount: 500, mode: 'Cash' });
const bank = (await a.get('/reports/cashbook?book=bank&from=2026-11-20&to=2026-11-21')).data;
check('bank book: opening, receipts, payments, closing', bank.entries.length === 2 && bank.totalIn === 25000 && bank.totalOut === 30000 && bank.closing === r2(bank.opening - 5000), bank);
check('bank book daily closing', bank.days.length === 2 && bank.days.at(-1).closing === bank.closing, bank.days);
const cash = (await a.get('/reports/cashbook?book=cash&from=2026-11-21&to=2026-11-21')).data;
check('cash book excludes bank modes', cash.entries.every(e => e.mode === 'Cash') && cash.totalOut >= 500, cash);

// GST report
const g = (await a.get('/reports/gst?from=2026-11-01&to=2026-11-30')).data;
check('GST report shape', g.summary && Array.isArray(g.b2b) && Array.isArray(g.b2c) && Array.isArray(g.hsn) && Array.isArray(g.creditNotes), Object.keys(g));
check('B2B lists GSTIN customer', g.b2b.some(x => x.gstin === '08AAACA1111A1Z1' && x.taxable === 40000), g.b2b);
check('HSN summary nets credit notes', g.hsn.every(h => typeof h.hsn === 'string'), g.hsn);
check('net = sales − credits', g.summary.net.subtotal === r2((g.summary.sales.subtotal || 0) - (g.summary.credits.subtotal || 0)), g.summary);

// P&L report includes returns, yield, availability
const rep = (await a.get('/reports?from=2026-10-01&to=2026-10-31')).data;
check('plant yield 90% and availability 80%', rep.plant.yield === 90 && rep.plant.availability === 80 && rep.plant.downtime === 2, rep.plant);
check('downtime by reason', rep.plant.downtimeByReason.some(d => d.reason === 'Power cut' && d.hours === 2), rep.plant.downtimeByReason);
check('P&L has returns line', 'returns' in rep.pnl, rep.pnl);

// Excel exports are real xlsx files (ZIP signature) with the right type
const xl = async path => { const res = await fetch(BASE + path, { headers: { cookie: a.cookie } }); const buf = Buffer.from(await res.arrayBuffer()); return { status: res.status, type: res.headers.get('content-type'), zip: buf.subarray(0, 2).toString() === 'PK', size: buf.length, buf }; };
for (const p of ['/sales/export?format=xlsx', '/reports/gst?format=xlsx&from=2026-11-01', '/reports/ageing?format=xlsx', '/reports/cashbook?format=xlsx&book=bank', '/reports?format=xlsx', '/reports/vehicles?format=xlsx', '/reports/payroll.xlsx?month=2026-11']) {
  const x = await xl(p);
  check(`xlsx ${p.split('?')[0]}`, x.status === 200 && x.zip && x.type.includes('spreadsheetml'), x.status);
}
const salesX = await xl('/sales/export?format=xlsx');
check('xlsx has workbook parts', salesX.buf.includes(Buffer.from('xl/workbook.xml')) && salesX.buf.includes(Buffer.from('xl/worksheets/sheet1.xml')));

// Notifications
const nt = (await a.get('/notifications')).data.items;
check('overdue + large expense + low stock notifications', nt.some(i => i.kind === 'overdue') && nt.some(i => i.kind === 'expense') && nt.some(i => i.kind === 'stock'), nt.map(i => i.kind));
const op = await new Client().login(OP.email, OP.password);
const ont = (await op.get('/notifications')).data.items;
check('operator gets no money notifications', ont.every(i => !['overdue', 'expense', 'royalty'].includes(i.kind)), ont.map(i => i.kind));
check('operator cannot open finance reports', (await op.get('/reports/ageing')).status === 403 && (await op.get('/reports/gst')).status === 403 && (await op.get('/reports/cashbook')).status === 403);
check('operator cannot export Excel of payments', (await op.get('/payments/export?format=xlsx')).status === 403);

// Backup & restore
const acc = await new Client().login(ACC.email, ACC.password);
check('only admin can back up', (await acc.get('/admin/backup')).status === 403 && (await op.get('/admin/backup')).status === 403);
const bk = await a.get('/admin/backup');
check('backup downloads JSON with all tables', bk.status === 200 && bk.data.app === 'stone-crusher-manager' && bk.data.tables.sales.length >= 4 && !('sessions' in bk.data.tables), Object.keys(bk.data.tables || {}));
const salesBefore = (await a.get('/sales?pageSize=1')).data.total;
await a.post('/parties', { name: 'Created After Backup', type: 'customer' });
r = await a.post('/admin/restore', { backup: bk.data });
check('restore needs typed confirmation', r.status === 400 && r.data.fields?.confirm, r.data);
r = await a.post('/admin/restore', { confirm: 'RESTORE', backup: { app: 'other' } });
check('foreign file rejected with clear message', r.status === 400 && /not a Stone Crusher/.test(r.data.error), r.data);
const tampered = JSON.parse(JSON.stringify(bk.data)); tampered.tables.parties[0].evil_col = 1;
r = await a.post('/admin/restore', { confirm: 'RESTORE', backup: tampered });
check('unknown column rejected', r.status === 400 && /Unknown column/.test(r.data.error), r.data);
const noAdmin = JSON.parse(JSON.stringify(bk.data)); noAdmin.tables.users.forEach(u => { u.role = 'operator'; });
r = await a.post('/admin/restore', { confirm: 'RESTORE', backup: noAdmin });
check('backup without admin rejected', r.status === 400 && /no active admin/.test(r.data.error), r.data);
r = await a.post('/admin/restore', { confirm: 'RESTORE', backup: bk.data });
check('restore succeeds', r.status === 200 && r.data.ok, r.data);
check('restore signed everyone out', (await a.get('/auth/me')).status === 401);
await a.login('admin@example.test', 'TestAdminPass2026');
const parties = (await a.get('/parties?q=Created%20After')).data.total;
check('data rolled back to the backup', parties === 0 && (await a.get('/sales?pageSize=1')).data.total === salesBefore);
const nextSale = await a.post('/sales', { date: '2026-11-26', party_id: cust.id, material_id: m40.id, qty: 1, rate: 1000, mode: 'Cash', paid: 1000, allow_negative_stock: true });
check('new records still insert after restore', nextSale.status === 201, nextSale.data);
r = await a.post('/admin/backups/run');
check('daily backup file written', r.status === 200 && r.data.rows.some(b => b.name.startsWith('backup-')), r.data);
const name = r.data.rows[0].name;
check('backup file download', (await a.get(`/admin/backups/${name}`)).status === 200);
check('path traversal blocked', (await a.get('/admin/backups/..%2F..%2Fdata%2Fapp.db')).status === 404);
done();

function r2(v) { return Math.round(v * 100) / 100; }
