import { bootstrap, Client, check, done, OP } from './helpers.mjs';

const a = await bootstrap();
console.log('Module 4: labour and payroll');
const daily = (await a.post('/employees', { name: 'Raju Helper', wage_type: 'daily', wage: 600, active: true })).data;
const monthly = (await a.post('/employees', { name: 'Suresh Supervisor', wage_type: 'monthly', wage: 26000, ot_rate: 150, active: true })).data;
check('employee with OT rate', monthly.ot_rate === 150, monthly);

const mark = (date, entries) => a.put('/attendance', { date, entries });
// October: Raju 2 present → 1200 earned, paid 2000 advance → −800 carried forward
await mark('2026-10-05', [{ employee_id: daily.id, status: 'P' }]);
await mark('2026-10-06', [{ employee_id: daily.id, status: 'P' }]);
await a.post('/expenses', { date: '2026-10-07', category: 'Wages / Salary', amount: 2000, mode: 'Cash', employee_id: daily.id, description: 'Advance' });
// November: Raju 3 P + 1 H with 4 h OT; Suresh 20 P with 10 h OT
await mark('2026-11-02', [{ employee_id: daily.id, status: 'P', ot_hours: 4 }, { employee_id: monthly.id, status: 'P', ot_hours: 10 }]);
await mark('2026-11-03', [{ employee_id: daily.id, status: 'P' }]);
await mark('2026-11-04', [{ employee_id: daily.id, status: 'P' }]);
await mark('2026-11-05', [{ employee_id: daily.id, status: 'H' }]);
for (let d = 6; d <= 24; d++) await mark(`2026-11-${String(d).padStart(2, '0')}`, [{ employee_id: monthly.id, status: 'P' }]);
let r = await mark('2026-11-07', [{ employee_id: daily.id, status: 'A', ot_hours: 5 }]);
const att = (await a.get('/attendance?date=2026-11-07')).data.rows.find(x => x.id === daily.id);
check('no overtime stored on an absent day', att.status === 'A' && att.ot_hours === 0, att);
r = await mark('2099-01-01', [{ employee_id: daily.id, status: 'P' }]);
check('future attendance rejected', r.status === 400, r.data);
r = await mark('2026-11-08', [{ employee_id: daily.id, status: 'P', ot_hours: 30 }]);
check('more than 16 OT hours rejected', r.status === 400, r.data);

r = await a.post('/payroll_adjustments', { month: '2026-11', employee_id: monthly.id, kind: 'bonus', amount: 1000, note: 'Diwali' });
check('bonus saved', r.status === 201, r.data);
await a.post('/payroll_adjustments', { month: '2026-11', employee_id: monthly.id, kind: 'deduction', amount: 500, note: 'Damage' });
r = await a.post('/payroll_adjustments', { month: '2026-13', employee_id: monthly.id, kind: 'bonus', amount: 1 });
check('invalid month rejected', r.status === 400, r.data);

const p = (await a.get('/payroll?month=2026-11')).data;
const rr = p.rows.find(x => x.id === daily.id), rs = p.rows.find(x => x.id === monthly.id);
// Raju: 3.5 days × 600 = 2100; OT 4 h × (600/8=75) = 300; net 2400; b/f −800 → due 1600
check('daily: basic, OT at wage÷8', rr.basic === 2100 && rr.ot_rate_effective === 75 && rr.ot_pay === 300 && rr.net === 2400, rr);
check('advance carried forward', rr.brought_forward === -800 && rr.due === 1600, rr);
// Suresh: 20 days × 26000/30 = 17333.33; OT 10 × 150 = 1500; +1000 −500 → 19333.33
check('monthly: pro-rata, own OT rate, bonus, deduction', rs.basic === 17333.33 && rs.ot_pay === 1500 && rs.bonus === 1000 && rs.deduction === 500 && rs.net === 19333.33, rs);
const oct = (await a.get('/payroll?month=2026-10')).data.rows.find(x => x.id === daily.id);
check('October shows the advance as negative balance', oct.net === 1200 && oct.paid === 2000 && oct.due === -800, oct);

await a.post('/expenses', { date: '2026-11-30', category: 'Wages / Salary', amount: 1600, mode: 'UPI', employee_id: daily.id, description: 'Salary 2026-11' });
const after = (await a.get('/payroll?month=2026-11')).data.rows.find(x => x.id === daily.id);
check('paying the balance settles it', after.due === 0, after);
const dec = (await a.get('/payroll?month=2026-12')).data.rows.find(x => x.id === daily.id);
check('nothing carried into December', dec.brought_forward === 0, dec);

const slip = (await a.get(`/payroll/slip?employee_id=${monthly.id}&month=2026-11`)).data;
check('wage slip detail', slip.employee.net === 19333.33 && slip.days.length === 20 && slip.adjustments.length === 2, { days: slip.days?.length, adj: slip.adjustments });
check('missing employee slip → 404', (await a.get('/payroll/slip?employee_id=99999&month=2026-11')).status === 404);

const op = await new Client().login(OP.email, OP.password);
check('operator can mark attendance with OT', (await op.put('/attendance', { date: '2026-11-25', entries: [{ employee_id: daily.id, status: 'P', ot_hours: 2 }] })).status === 200);
check('operator cannot see payroll or slips', (await op.get('/payroll?month=2026-11')).status === 403 && (await op.get(`/payroll/slip?employee_id=${daily.id}&month=2026-11`)).status === 403);
check('operator cannot add bonuses', (await op.post('/payroll_adjustments', { month: '2026-11', employee_id: daily.id, kind: 'bonus', amount: 9999 })).status === 403);
done();
