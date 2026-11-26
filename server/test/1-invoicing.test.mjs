import { bootstrap, Client, check, done, OP } from './helpers.mjs';

const a = await bootstrap();
console.log('Module 1: GST invoices, credit notes, settings');

// Settings
let r = await a.put('/settings', { business_name: 'Test Crushers', state: 'Rajasthan', gstin: '08ABCDE1234F1Z5', bill_prefix: 'INV', credit_prefix: 'CN', currency: '₹', bank_name: 'SBI', bank_account: '123', bank_ifsc: 'SBIN0000001', invoice_terms: 'Pay in 30 days' });
check('settings save', r.status === 200 && r.data.state === 'Rajasthan', r.data);
r = await a.put('/settings', { business_name: 'X', gstin: 'BADGSTIN' });
check('bad GSTIN rejected', r.status === 400 && r.data.fields?.gstin, r.data);
r = await a.put('/settings', { business_name: 'X', logo: 'data:image/png;base64,' + Buffer.from('<svg>evil</svg>').toString('base64') });
check('fake PNG logo rejected', r.status === 400 && r.data.fields?.logo, r.data);
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
r = await a.put('/settings', { business_name: 'Test Crushers', state: 'Rajasthan', gstin: '08ABCDE1234F1Z5', bill_prefix: 'INV', credit_prefix: 'CN', currency: '₹', logo: 'data:image/png;base64,' + png });
check('real PNG logo accepted', r.status === 200 && r.data.logo.startsWith('data:image/png'), r.data);
r = await a.put('/settings', { business_name: 'Test Crushers', upi_id: 'crusher@upi' });
check('partial save keeps other settings', r.status === 200 && r.data.upi_id === 'crusher@upi' && r.data.logo.startsWith('data:image/png') && r.data.bank_name === 'SBI' && r.data.state === 'Rajasthan', r.data);

// Parties
const local = (await a.post('/parties', { name: 'Local Builder', type: 'customer', state: 'Rajasthan', phone: '9876543210' })).data;
const outer = (await a.post('/parties', { name: 'Gujarat Infra', type: 'customer', gstin: '24AAACG1234K1Z2' })).data;
r = await a.post('/parties', { name: 'Bad', type: 'customer', state: 'Atlantis' });
check('invalid state rejected', r.status === 400 && r.data.fields?.state, r.data);
check('party with gstin saved', outer.id && outer.gstin === '24AAACG1234K1Z2', outer);

const mats = (await a.get('/materials?pageSize=50')).data.rows;
const m20 = mats.find(m => m.name.startsWith('20'));
check('materials backfilled with HSN 2517', mats.every(m => m.hsn === '2517'), mats.map(m => m.hsn));
await a.post('/production', { date: '2026-11-20', material_id: m20.id, qty: 100 });

// Sales: intra (CGST+SGST) and inter (IGST via GSTIN state code 24)
const s1 = (await a.post('/sales', { date: '2026-11-21', party_id: local.id, material_id: m20.id, qty: 10, rate: 1000, gst_pct: 5, paid: 0, mode: 'Credit' })).data;
check('FY bill number', s1.bill_no === 'INV/2026-27/0001', s1.bill_no);
check('intra-state split', s1.tax_type === 'intra' && s1.cgst === 250 && s1.sgst === 250 && s1.igst === 0 && s1.amount === 10500, s1);
const s2 = (await a.post('/sales', { date: '2026-11-22', party_id: outer.id, material_id: m20.id, qty: 5, rate: 1000, gst_pct: 5, paid: 0, mode: 'Credit' })).data;
check('sequential number', s2.bill_no === 'INV/2026-27/0002', s2.bill_no);
check('inter-state IGST from GSTIN', s2.tax_type === 'inter' && s2.igst === 250 && s2.cgst === 0, s2);
const s3 = (await a.post('/sales', { date: '2027-04-02', party_id: local.id, material_id: m20.id, qty: 1, rate: 1000, gst_pct: 0, paid: 1000, mode: 'UPI' })).data;
check('new FY restarts at 0001', s3.bill_no === 'INV/2027-28/0001', s3.bill_no);
const upd = (await a.put(`/sales/${s1.id}`, { date: '2026-11-21', party_id: local.id, material_id: m20.id, qty: 12, rate: 1000, gst_pct: 5, paid: 0, mode: 'Credit' })).data;
check('edit keeps bill number', upd.bill_no === 'INV/2026-27/0001' && upd.amount === 12600, upd);

// Credit notes
const stockBefore = (await a.get('/stock')).data.rows.find(x => x.id === m20.id).current;
let cn = await a.post('/credit_notes', { date: '2026-11-23', sale_id: s1.id, qty: 2, restock: true, reason: 'Wrong size' });
check('credit note created', cn.status === 201 && cn.data.note_no === 'CN/2026-27/0001' && cn.data.amount === 2100 && cn.data.cgst === 50, cn.data);
const stockAfter = (await a.get('/stock')).data.rows.find(x => x.id === m20.id).current;
check('restock adds back to stock', stockAfter === stockBefore + 2, { stockBefore, stockAfter });
r = await a.post('/credit_notes', { date: '2026-11-23', sale_id: s1.id, qty: 11 });
check('cannot return more than billed', r.status === 400 && r.data.fields?.qty, r.data);
r = await a.post('/credit_notes', { date: '2026-11-01', sale_id: s1.id, qty: 1 });
check('cannot date before bill', r.status === 400 && r.data.fields?.date, r.data);
r = await a.post('/credit_notes', { date: '2026-11-24', sale_id: s1.id, qty: 1, rate: 5000 });
check('cannot credit above billed rate', r.status === 400 && r.data.fields?.rate, r.data);
r = await a.post('/credit_notes', { date: '2026-11-24', sale_id: s2.id, qty: 1, rate: 200, restock: false, reason: 'Rate correction' });
check('IGST credit note, no restock', r.status === 201 && r.data.igst === 10 && r.data.amount === 210 && r.data.restock === false, r.data);
const bal = (await a.get(`/parties/${local.id}`)).data.balance;
check('credit reduces customer balance', bal === 12600 - 2100, bal);
const led = (await a.get(`/parties/${local.id}/ledger`)).data;
check('credit note in ledger', led.rows.some(x => x.ref.startsWith('credit:')) && led.balance === 10500, led.balance);
r = await a.del(`/sales/${s1.id}`);
check('bill with credit note cannot be deleted', r.status === 409, r.data);
const csv = await a.get('/sales/export');
check('CSV has CGST/IGST columns', typeof csv.data === 'string' && csv.data.includes('CGST') && csv.data.includes('IGST'));

// Operator restrictions
const op = await new Client().login(OP.email, OP.password);
check('operator cannot read credit notes', (await op.get('/credit_notes')).status === 403);
check('operator cannot create credit notes', (await op.post('/credit_notes', { date: '2026-11-25', sale_id: s1.id, qty: 1 })).status === 403);
check('operator cannot change settings', (await op.put('/settings', { business_name: 'x' })).status === 403);
done();
