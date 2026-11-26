/**
 * Fill an EMPTY database with 45 days of realistic demo data (customers, sales, production, expenses...).
 * Does not create user accounts. Refuses to run if any sales already exist.
 *   npm run seed:demo
 */
import { db, migrate } from '../src/db.js';
import { daysAgo } from '../src/lib/util.js';

await migrate();
const [{ c }] = await db('sales').count({ c: 'id' });
if (Number(c) > 0) {
  console.error('Database already has sales. Demo data is only loaded into an empty database.');
  process.exit(1);
}

const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
const pick = a => a[Math.floor(Math.random() * a.length)];
const r2 = v => Math.round(v * 100) / 100;

await db.transaction(async trx => {
  const settings = { business_name: 'Shree Ganesh Stone Crusher', address: 'Survey No. 42, Quarry Road', phone: '98765 43210', gstin: '', currency: '₹', bill_prefix: 'INV-' };
  for (const [key, value] of Object.entries(settings)) await trx('settings').insert({ key, value }).onConflict('key').merge(['value']);

  const mats = await trx('materials').select('*').orderBy('id');
  const raw = mats.find(m => m.is_raw === true || m.is_raw === 1);
  const prods = mats.filter(m => m !== raw);
  await trx('materials').where({ id: raw.id }).update({ opening: 1500 });
  for (const m of prods) await trx('materials').where({ id: m.id }).update({ opening: rnd(80, 160) });

  const insert = async (table, rows) => {
    const out = [];
    for (const r of rows) {
      const [ins] = await trx(table).insert(r).returning('id');
      out.push({ ...r, id: typeof ins === 'object' ? ins.id : ins });
    }
    return out;
  };
  const customers = await insert('parties', [
    ['Sharma Constructions', '98200 11111', 'Ring Road Site'], ['Patel Builders', '98200 22222', 'Green Valley Project'],
    ['City Infra Projects', '98200 33333', 'Flyover Site'], ['Highway Road Contractors', '98200 44444', 'NH Bypass Km 12'],
    ['Green Homes Developers', '98200 55555', 'Sector 9'], ['Cash Customer', null, null],
  ].map(([name, phone, address]) => ({ name, phone, address, type: 'customer', opening: 0 })));
  const suppliers = await insert('parties', [['Hill Top Quarry', '98900 66666'], ['Rocky Mines & Minerals', '98900 77777']]
    .map(([name, phone]) => ({ name, phone, type: 'supplier', opening: 0 })));
  const vehicles = await insert('vehicles', [['MH-12-AB-1234', 'Tipper / Dumper', 'own', 'Ramesh'], ['MH-12-CD-5678', 'Tipper / Dumper', 'own', 'Suresh'],
    ['MH-14-EF-9012', 'Truck', 'hired', 'Vijay'], ['JCB-01', 'JCB / Loader', 'own', 'Anil']]
    .map(([number, kind, ownership, driver]) => ({ number, kind, ownership, driver })));
  const employees = await insert('employees', [['Raju Yadav', 'Plant Operator', 'monthly', 18000], ['Anil Kumar', 'Loader Operator', 'monthly', 16000],
    ['Ramesh Singh', 'Driver', 'monthly', 15000], ['Suresh Pawar', 'Driver', 'monthly', 15000], ['Mohan Lal', 'Helper', 'daily', 500],
    ['Kishan Das', 'Helper', 'daily', 500], ['Prakash Jain', 'Supervisor', 'monthly', 25000]]
    .map(([name, role, wage_type, wage]) => ({ name, role, wage_type, wage, joined_on: daysAgo(400), active: true })));

  const shares = [[0, 0.18], [1, 0.27], [2, 0.18], [3, 0.1], [4, 0.17], [5, 0.1]];
  const weighted = [0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 5];
  let bill = 0;
  for (let i = 45; i >= 0; i--) {
    const date = daysAgo(i);
    if (new Date(date + 'T00:00:00').getDay() === 0) continue;
    const pq = rnd(200, 260);
    await trx('purchases').insert({ date, party_id: pick(suppliers).id, material_id: raw.id, qty: pq, rate: 380, transport: 0, amount: pq * 380, ...(Math.random() < 0.5 ? { paid: pq * 380, mode: 'Bank Transfer' } : { paid: 0, mode: 'Credit' }) });
    const rawUse = rnd(180, 240);
    for (const [idx, share] of shares) {
      await trx('production').insert({ date, shift: 'Day', material_id: prods[idx].id, qty: Math.round(rawUse * 0.95 * share),
        raw_material_id: idx === 0 ? raw.id : null, raw_qty: idx === 0 ? rawUse : 0, run_hours: idx === 0 ? rnd(7, 10) : 0 });
    }
    for (let k = rnd(7, 12); k > 0; k--) {
      const m = prods[pick(weighted)];
      const cust = pick(customers);
      const qty = rnd(10, 22), rate = Number(m.rate), transport = Math.random() < 0.4 ? rnd(5, 15) * 100 : 0;
      const subtotal = r2(qty * rate), amount = subtotal + transport;
      const paidNow = cust.name === 'Cash Customer' || Math.random() < 0.35;
      bill += 1;
      await trx('sales').insert({ date, bill_no: `INV-${String(bill).padStart(5, '0')}`, party_id: cust.id, vehicle_no: pick(vehicles.slice(0, 3)).number,
        material_id: m.id, qty, rate, transport, gst_pct: 0, subtotal, gst_amount: 0, amount, paid: paidNow ? amount : 0, mode: paidNow ? pick(['Cash', 'UPI', 'Bank Transfer']) : 'Credit' });
    }
    await trx('expenses').insert({ date, category: 'Diesel / Fuel', amount: rnd(60, 110) * 100, mode: 'Cash', vehicle_no: pick(vehicles).number, description: 'Diesel' });
    if (i % 7 === 2) await trx('expenses').insert({ date, category: pick(['Maintenance & Repair', 'Spare Parts', 'Blasting / Explosives', 'Food & Welfare']), amount: rnd(20, 120) * 100, mode: 'Cash', description: 'Routine' });
    if (i % 30 === 5) await trx('expenses').insert({ date, category: 'Electricity', amount: rnd(600, 900) * 100, mode: 'Bank Transfer', description: 'Electricity bill' });
    for (const e of employees) {
      await trx('attendance').insert({ date, employee_id: e.id, status: Math.random() < 0.88 ? 'P' : Math.random() < 0.5 ? 'H' : 'A' });
    }
  }
  for (const cust of customers.slice(0, 5)) {
    await trx('payments').insert({ date: daysAgo(rnd(1, 20)), direction: 'in', party_id: cust.id, amount: rnd(20, 80) * 1000, mode: 'Bank Transfer', reference: 'NEFT' });
  }
});
console.log('Demo data loaded.');
await db.destroy();
