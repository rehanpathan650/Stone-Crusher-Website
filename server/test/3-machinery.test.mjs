import { bootstrap, Client, check, done, OP, ACC } from './helpers.mjs';

const a = await bootstrap();
console.log('Module 3: diesel and machinery');
const jcb = (await a.post('/vehicles', { number: 'JCB-01', kind: 'JCB / Loader', ownership: 'own', meter_type: 'hours' })).data;
const tip = (await a.post('/vehicles', { number: 'RJ14 TIP 9', kind: 'Tipper / Dumper', ownership: 'own', meter_type: 'km' })).data;
check('vehicles with meter type', jcb.meter_type === 'hours' && tip.meter_type === 'km', [jcb, tip]);

// JCB: fills at 1000h (100L), 1010h (80L), 1020h (80L), 1030h (130L ← abnormal)
const fill = (date, vid, litres, meter, extra = {}) => a.post('/diesel_logs', { date, vehicle_id: vid, litres, meter, rate: 92, mode: 'Cash', ...extra });
let r = await fill('2026-11-01', jcb.id, 100, 1000);
check('diesel entry with cost', r.status === 201 && r.data.amount === 9200 && r.data.vehicle_no === 'JCB-01', r.data);
const firstId = r.data.id;
await fill('2026-11-05', jcb.id, 80, 1010);
await fill('2026-11-09', jcb.id, 80, 1020);
await fill('2026-11-13', jcb.id, 130, 1030);
r = await fill('2026-11-14', jcb.id, 50, 900);
check('meter going backwards rejected', r.status === 400 && r.data.fields?.meter, r.data);
// Tipper: 0 → 400 → 800 km, 50 L + 50 L → 8 km/L
await fill('2026-11-02', tip.id, 60, 10000);
await fill('2026-11-06', tip.id, 50, 10400);
await fill('2026-11-10', tip.id, 50, 10800);

const eff = (await a.get('/diesel/efficiency?from=2026-11-01')).data.rows;
const ej = eff.find(x => x.number === 'JCB-01'), et = eff.find(x => x.number === 'RJ14 TIP 9');
check('JCB L/hr average = 290 L / 30 h', ej && ej.efficiency === 9.67 && ej.efficiencyUnit === 'L/hr', ej);
check('JCB latest interval flagged abnormal', ej.abnormal === true && ej.latest === 13, ej);
check('tipper km/L = 800 km / 100 L', et && et.efficiency === 8 && et.efficiencyUnit === 'km/L' && et.abnormal === false, et);
check('abnormal machines listed first', eff[0].number === 'JCB-01');

// Linked expenses
let ex = (await a.get('/expenses?category=Diesel%20%2F%20Fuel&pageSize=100&from=2026-11-01')).data;
check('each fill created one diesel expense', ex.total === 7 && ex.totals.amount === (100 + 80 + 80 + 130 + 60 + 50 + 50) * 92, ex.totals);
const linked = ex.rows.find(e => e.description.startsWith('Diesel 100 L'));
r = await a.put(`/expenses/${linked.id}`, { date: '2026-11-01', category: 'Diesel / Fuel', amount: 1, mode: 'Cash' });
check('linked expense cannot be edited directly', r.status === 400, r.data);
r = await a.del(`/expenses/${linked.id}`);
check('linked expense cannot be deleted directly', r.status === 400, r.data);
r = await a.put(`/diesel_logs/${firstId}`, { date: '2026-11-01', vehicle_id: jcb.id, litres: 110, meter: 1000, rate: 92, mode: 'UPI' });
ex = (await a.get(`/expenses/${linked.id}`)).data;
check('editing the fill updates its expense', r.status === 200 && ex.amount === 10120 && ex.mode === 'UPI', ex);
r = await a.del(`/diesel_logs/${firstId}`);
check('deleting the fill removes its expense', r.status === 204 && (await a.get(`/expenses/${linked.id}`)).status === 404);

// Operator: logs litres, never sees or sets money
const op = await new Client().login(OP.email, OP.password);
r = await op.post('/diesel_logs', { date: '2026-11-15', vehicle_id: tip.id, litres: 40, meter: 11100, rate: 1, mode: 'Cash' });
check('operator fill uses last rate, ignores theirs', r.status === 201 && r.data.rate === undefined && r.data.amount === undefined, r.data);
const opFill = (await a.get(`/diesel_logs/${r.data.id}`)).data;
check('…and server priced it at last rate', opFill.rate === 92 && opFill.amount === 3680, opFill);
const opList = (await op.get('/diesel_logs?from=2026-11-01')).data;
check('operator list has no money or totals', opList.rows.every(x => x.amount === undefined && x.rate === undefined) && opList.totals.amount === undefined && opList.totals.litres > 0, opList.totals);

// Maintenance
r = await a.post('/maintenance', { date: '2026-11-10', vehicle_id: jcb.id, kind: 'Service', description: '250 hr service', parts_cost: 4000, labour_cost: 1000, meter: 1020, downtime_hours: 3, next_due_meter: 1060, next_due_date: '2026-12-20', mode: 'Cash' });
check('maintenance with cost', r.status === 201 && r.data.amount === 5000, r.data);
const mId = r.data.id;
ex = (await a.get('/expenses?category=Maintenance%20%26%20Repair&from=2026-11-01')).data;
check('maintenance expense linked', ex.total === 1 && ex.totals.amount === 5000, ex);
r = await a.post('/maintenance', { date: '2026-11-10', vehicle_id: jcb.id, kind: 'Service', description: 'x', meter: 1020, next_due_meter: 1000 });
check('next due reading must be ahead', r.status === 400 && r.data.fields?.next_due_meter, r.data);
// JCB meter is now 1030 ≥ 1060 − 50 → due soon
let due = (await a.get('/maintenance/due')).data.rows;
check('service due by hour meter', due.some(d => d.number === 'JCB-01' && d.current_meter === 1030 && !d.overdue), due);
await a.post('/maintenance', { date: '2026-11-11', vehicle_id: tip.id, kind: 'Tyres', description: 'Rear tyre', next_due_date: '2026-11-12' });
due = (await a.get('/maintenance/due')).data.rows;
check('service overdue by date', due.some(d => d.number === 'RJ14 TIP 9' && d.overdue), due);
r = await op.post('/maintenance', { date: '2026-11-16', vehicle_id: tip.id, kind: 'Breakdown', description: 'Hydraulic leak', parts_cost: 99999, downtime_hours: 5 });
check('operator can report breakdown without cost', r.status === 201 && r.data.amount === undefined, r.data);
const opM = (await a.get(`/maintenance/${r.data.id}`)).data;
check('…operator-entered cost ignored', opM.amount === 0 && opM.parts_cost === 0, opM);
check('operator cannot delete maintenance', (await op.del(`/maintenance/${mId}`)).status === 403);
const acc = await new Client().login(ACC.email, ACC.password);
check('accountant sees diesel cost', (await acc.get('/diesel_logs')).data.totals.amount > 0);
done();
