import { bootstrap, Client, check, done, OP } from './helpers.mjs';

const a = await bootstrap();
console.log('Module 2: weighbridge, vehicles, freight, royalty');
const mats = (await a.get('/materials?pageSize=50')).data.rows;
const m10 = mats.find(m => m.name.startsWith('10'));
await a.post('/production', { date: '2026-11-20', material_id: m10.id, qty: 500 });
const cust = (await a.post('/parties', { name: 'Road Contractor', type: 'customer', state: 'Rajasthan' })).data;
const owner = (await a.post('/parties', { name: 'Ramesh Transport', type: 'supplier' })).data;

let r = await a.post('/vehicles', { number: 'rj14 ab 1234', ownership: 'hired', tare_weight: 9500, owner_party_id: owner.id, freight_rate: 1200 });
check('hired vehicle with owner', r.status === 201 && r.data.number === 'RJ14 AB 1234' && r.data.owner_name === 'Ramesh Transport' && r.data.tare_weight === 9500, r.data);
r = await a.post('/vehicles', { number: 'RJ14 OWN 1', ownership: 'own', owner_party_id: owner.id, freight_rate: 500 });
check('own vehicle drops owner/freight', r.status === 201 && r.data.owner_party_id === null && r.data.freight_rate === 0, r.data);
const lk = (await a.get('/lookups')).data;
check('lookups include tare + states', lk.vehicles.some(v => v.tare_weight === 9500) && lk.enums.states.includes('Rajasthan'));

// Weighbridge sale: 31,250 − 9,500 = 21,750 kg → 21.75 t, client-sent qty is overridden
const s = await a.post('/sales', { date: '2026-11-21', party_id: cust.id, material_id: m10.id, vehicle_no: 'RJ14 AB 1234', slip_no: 'WB-778',
  gross_weight: 31250, tare_weight: 9500, qty: 999, rate: 800, gst_pct: 5, freight_cost: 1200, royalty_pass_no: 'ERW-001', paid: 0, mode: 'Credit' });
check('net weight and qty from weighbridge', s.status === 201 && s.data.net_weight === 21750 && s.data.qty === 21.75, s.data);
check('amount from net qty', s.data.amount === Math.round(21.75 * 800 * 1.05 * 100) / 100, s.data.amount);
r = await a.post('/sales', { date: '2026-11-21', party_id: cust.id, material_id: m10.id, gross_weight: 9000, tare_weight: 9500, qty: 1, rate: 800, mode: 'Cash' });
check('gross < tare rejected', r.status === 400 && r.data.fields?.gross_weight, r.data);
r = await a.post('/sales', { date: '2026-11-21', party_id: cust.id, material_id: m10.id, gross_weight: 20000, qty: 1, rate: 800, mode: 'Cash' });
check('gross without tare rejected', r.status === 400 && r.data.fields?.tare_weight, r.data);
await a.post('/sales', { date: '2026-11-22', party_id: cust.id, material_id: m10.id, vehicle_no: 'RJ14 AB 1234', qty: 10, rate: 800, freight_cost: 1200, paid: 8000, mode: 'Cash' });

// Freight shows as payable to the owner
let ob = (await a.get(`/parties/${owner.id}`)).data.balance;
check('owner balance = freight payable', ob === -2400, ob);
const led = (await a.get(`/parties/${owner.id}/ledger`)).data;
check('freight rows in owner ledger', led.rows.filter(x => x.ref.startsWith('freight:')).length === 2, led.rows);
await a.post('/payments', { date: '2026-11-25', direction: 'out', party_id: owner.id, amount: 2400, mode: 'Cash' });
ob = (await a.get(`/parties/${owner.id}`)).data.balance;
check('paying owner settles balance', ob === 0, ob);

// Trips report
const vr = (await a.get('/reports/vehicles?from=2026-11-01&to=2026-11-30')).data;
const v = vr.rows.find(x => x.vehicle_no === 'RJ14 AB 1234');
check('trips report', v && v.trips === 2 && v.cost === 2400 && v.owner_name === 'Ramesh Transport' && v.net_kg === 21750, vr);

// Royalty
r = await a.post('/royalty_permits', { date: '2026-11-01', permit_no: 'rp-1', qty: 100, amount: 5000 });
check('permit saved, number uppercased', r.status === 201 && r.data.permit_no === 'RP-1', r.data);
r = await a.post('/royalty_permits', { date: '2026-11-01', permit_no: 'RP-1', qty: 5 });
check('duplicate permit no. rejected', r.status === 409, r.data);
r = await a.post('/royalty_permits', { date: '2026-11-10', permit_no: 'RP-2', qty: 5, valid_until: '2026-11-01' });
check('validity before date rejected', r.status === 400, r.data);
const rs = (await a.get('/royalty/summary')).data;
check('royalty balance', rs.permitted === 100 && rs.dispatched === 21.75 && rs.balance === 78.25 && rs.low === true && rs.missingPasses30d >= 1, rs);

const op = await new Client().login(OP.email, OP.password);
check('operator can record weighbridge sale', (await op.post('/sales', { date: '2026-11-23', party_id: cust.id, material_id: m10.id, gross_weight: 20000, tare_weight: 9000, qty: 11, rate: 800, mode: 'Cash', paid: 8800 })).status === 201);
check('operator cannot see royalty', (await op.get('/royalty/summary')).status === 403 && (await op.get('/royalty_permits')).status === 403);
check('operator cannot see trips/freight report', (await op.get('/reports/vehicles')).status === 403);
done();
