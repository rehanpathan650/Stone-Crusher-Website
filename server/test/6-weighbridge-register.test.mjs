import { bootstrap, Client, check, done, OP, ACC } from './helpers.mjs';

const a = await bootstrap();
console.log('Weighbridge register, delivery, credit limit, purchase GST, stock ledger');
await a.put('/settings', { business_name: 'Test Crushers', state: 'Rajasthan', bill_prefix: 'INV', credit_prefix: 'CN', currency: '₹' });
const mats = (await a.get('/materials?pageSize=50')).data.rows;
const m20 = mats.find(m => m.name.startsWith('20')), raw = mats.find(m => m.is_raw);
await a.post('/production', { date: '2026-11-20', material_id: m20.id, qty: 400 });
const cust = (await a.post('/parties', { name: 'WB Customer', type: 'customer', state: 'Rajasthan', credit_limit: 50000 })).data;
check('party credit limit saved', cust.credit_limit === 50000, cust);
await a.post('/vehicles', { number: 'RJ27 WB 1', ownership: 'own' });

// Empty weighment records the vehicle's tare
let r = await a.post('/weighments', { date: '2026-11-24', type: 'Empty', vehicle_no: 'rj27 wb 1', tare_weight: 9800 });
check('empty weighment saved with slip number and time', r.status === 201 && /^WB\/2026-27\/\d{4}$/.test(r.data.slip_no) && r.data.net_weight === null && /^\d\d:\d\d$/.test(r.data.time), r.data);
const veh = (await a.get('/vehicles?q=RJ27')).data.rows[0];
check('empty weighment updates vehicle tare', veh.tare_weight === 9800, veh);

// Loaded weighment
r = await a.post('/weighments', { date: '2026-11-25', type: 'Loaded', vehicle_no: 'RJ27 WB 1', party_id: cust.id, material_id: m20.id, gross_weight: 30800, tare_weight: 9800, rate: 900, driver: 'Kishan' });
const slip = r.data;
check('loaded slip: net weight and amount', r.status === 201 && slip.net_weight === 21000 && slip.amount === 18900 && slip.bill_no === null, slip);
r = await a.post('/weighments', { date: '2026-11-25', vehicle_no: 'X1', gross_weight: 5000, tare_weight: 6000 });
check('gross below tare rejected', r.status === 400, r.data);
r = await a.post('/weighments', { date: '2026-11-25', vehicle_no: 'X1', type: 'Loaded', tare_weight: 6000 });
check('loaded slip needs gross', r.status === 400 && r.data.fields?.gross_weight, r.data);

// Bill from the slip: weights come from the slip, not the form
r = await a.post('/sales', { date: '2026-11-25', party_id: cust.id, material_id: m20.id, qty: 99, rate: 900, gst_pct: 5, mode: 'Credit', paid: 0,
  weighment_id: slip.id, gross_weight: 99999, tare_weight: 1, destination: 'NH-48 site', delivery_status: 'Dispatched' });
const sale = r.data;
check('bill from slip uses slip weights', r.status === 201 && sale.net_weight === 21000 && sale.qty === 21 && sale.slip_no === slip.slip_no && sale.driver === 'Kishan' && sale.destination === 'NH-48 site', sale);
const billed = (await a.get(`/weighments/${slip.id}`)).data;
check('slip shows its bill', billed.sale_id === sale.id && billed.bill_no === sale.bill_no, billed);
r = await a.post('/sales', { date: '2026-11-25', party_id: cust.id, material_id: m20.id, qty: 1, rate: 900, mode: 'Cash', paid: 900, weighment_id: slip.id });
check('a slip cannot be billed twice', r.status === 409 && r.data.code === 'ALREADY_BILLED', r.data);
check('billed slip cannot be edited or deleted', (await a.put(`/weighments/${slip.id}`, { date: '2026-11-25', vehicle_no: 'RJ27 WB 1', gross_weight: 1, tare_weight: 0 })).status === 400
  && (await a.del(`/weighments/${slip.id}`)).status === 400);
r = await a.put(`/sales/${sale.id}`, { date: '2026-11-25', party_id: cust.id, material_id: m20.id, qty: 21, rate: 900, gst_pct: 5, mode: 'Credit', paid: 0,
  gross_weight: 30800, tare_weight: 9800, delivery_status: 'Delivered' });
check('editing the bill keeps the slip link and marks delivered', r.status === 200 && r.data.delivery_status === 'Delivered' && (await a.get(`/weighments/${slip.id}`)).data.sale_id === sale.id, r.data);

// Credit limit: balance 19845 now; another 40k would exceed 50k
r = await a.post('/sales', { date: '2026-11-26', party_id: cust.id, material_id: m20.id, qty: 45, rate: 900, mode: 'Credit', paid: 0 });
check('credit limit blocks the bill', r.status === 409 && r.data.code === 'CREDIT_LIMIT' && r.data.details.canOverride === true, r.data);
const op = await new Client().login(OP.email, OP.password);
r = await op.post('/sales', { date: '2026-11-26', party_id: cust.id, material_id: m20.id, qty: 45, rate: 900, mode: 'Credit', paid: 0, allow_over_credit: true });
check('operator cannot override and sees no amounts', r.status === 409 && r.data.details.canOverride === false && !/\d{2},\d{3}/.test(r.data.error), r.data);
r = await a.post('/sales', { date: '2026-11-26', party_id: cust.id, material_id: m20.id, qty: 45, rate: 900, mode: 'Credit', paid: 0, allow_over_credit: true });
check('manager/admin can override', r.status === 201, r.data);
r = await op.post('/sales', { date: '2026-11-26', party_id: cust.id, material_id: m20.id, qty: 1, rate: 900, mode: 'Cash', paid: 900 });
check('fully paid bill is allowed even over the limit', r.status === 201, r.data);

// Operators can use the weighbridge
r = await op.post('/weighments', { date: '2026-11-26', vehicle_no: 'RJ27 WB 1', gross_weight: 25000, tare_weight: 9800, material_id: m20.id });
check('operator records a weighment', r.status === 201, r.data);
check('operator cannot delete slips', (await op.del(`/weighments/${r.data.id}`)).status === 403);
const dash = (await a.get('/dashboard')).data;
check('dashboard counts unbilled slips', dash.weighbridge && dash.weighbridge.unbilled >= 1, dash.weighbridge);

// Purchase GST (input tax)
const sup = (await a.post('/parties', { name: 'Diesel & Spares Co', type: 'supplier', gstin: '24AAACD1234K1Z9' })).data;
r = await a.post('/purchases', { date: '2026-11-25', party_id: sup.id, material_id: raw.id, qty: 100, rate: 400, gst_pct: 5, transport: 500, bill_no: 'S-77', paid: 0, mode: 'Credit' });
check('purchase: taxable, IGST from other state, total', r.status === 201 && r.data.subtotal === 40000 && r.data.igst === 2000 && r.data.amount === 42500 && r.data.bill_no === 'S-77', r.data);
check('supplier balance includes the tax', (await a.get(`/parties/${sup.id}`)).data.balance === -42500);
const g = (await a.get('/reports/gst?from=2026-11-01&to=2026-11-30')).data;
check('GST report: input tax and net payable', g.summary.input.igst === 2000 && g.summary.payable.gst_amount === Math.round((g.summary.net.gst_amount - 2000) * 100) / 100 && g.inputBills.length === 1, g.summary);
const rep = (await a.get('/reports?from=2026-11-01&to=2026-11-30')).data;
check('profit & loss counts purchases without input GST', rep.pnl.purchases === 40500 && rep.pnl.inputGst === 2000, rep.pnl);

// Stock movement ledger
const led = (await a.get(`/stock/${m20.id}/ledger`)).data;
const stockNow = (await a.get('/stock')).data.rows.find(x => x.id === m20.id).current;
check('stock ledger: running balance ends at current stock', led.closing === stockNow && led.rows.some(x => x.type === 'Production') && led.rows.some(x => x.type === 'Dispatch'), { closing: led.closing, stockNow });
const ledFrom = (await a.get(`/stock/${m20.id}/ledger?from=2026-11-25`)).data;
const balBefore = [...led.rows].filter(x => x.date < '2026-11-25').at(-1)?.balance ?? led.opening;
check('stock ledger opening carries earlier movements', ledFrom.opening === balBefore && ledFrom.closing === stockNow, { opening: ledFrom.opening, balBefore });
const ledRange = (await a.get(`/stock/${m20.id}/ledger?from=2026-11-01&to=2026-11-30`)).data;
check('stock ledger respects the date range', ledRange.rows.every(x => x.date >= '2026-11-01' && x.date <= '2026-11-30'));
check('stock ledger needs stock access only', (await op.get(`/stock/${m20.id}/ledger`)).status === 200);
check('unknown material → 404', (await a.get('/stock/999999/ledger')).status === 404);

// Smaller fields
r = await a.post('/royalty_permits', { date: '2026-11-01', permit_no: 'Q-9', qty: 50, quarry: 'Khasra 112', mineral: 'Stone', payment_ref: 'UTR123' });
check('royalty permit quarry / mineral / payment ref', r.status === 201 && r.data.quarry === 'Khasra 112' && r.data.payment_ref === 'UTR123', r.data);
r = await a.post('/expenses', { date: '2026-11-25', category: 'Electricity', amount: 1200, mode: 'Cash', paid_to: 'JVVNL' });
check('expense paid-to', r.status === 201 && r.data.paid_to === 'JVVNL', r.data);
const emp = (await a.post('/employees', { name: 'Shift Operator', wage_type: 'daily', wage: 700, active: true })).data;
r = await a.post('/production', { date: '2026-11-25', material_id: m20.id, qty: 10, operator_id: emp.id });
check('production operator', r.status === 201 && r.data.operator_name === 'Shift Operator', r.data);
const acc = await new Client().login(ACC.email, ACC.password);
check('accountant can view weighbridge register', (await acc.get('/weighments')).status === 200);
done();
