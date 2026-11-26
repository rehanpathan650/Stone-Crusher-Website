import { db } from '../db.js';
import { norm, n, r2, r3 } from '../lib/util.js';

/* ---------------- Settings ---------------- */
export const DEFAULT_SETTINGS = {
  business_name: 'My Stone Crusher',
  address: '',
  phone: '',
  gstin: '',
  currency: '₹',
  bill_prefix: 'INV',
  credit_prefix: 'CN',
  state: '',
  email: '',
  bank_name: '',
  bank_account: '',
  bank_ifsc: '',
  bank_branch: '',
  upi_id: '',
  invoice_terms: 'Goods once sold will not be taken back. Interest @18% p.a. will be charged on payments delayed beyond 30 days. Subject to local jurisdiction.',
  opening_cash: '0', // cash in hand when you started using the app
  opening_bank: '0', // bank balance when you started using the app
  diesel_rate: '90', // default diesel rate when no earlier fill has one
  royalty_alert_qty: '100', // warn when royalty balance (tons) falls below this
  large_expense: '25000', // notify on single expenses above this amount
  logo: '', // data: URL (PNG/JPEG/WebP), validated on save
};

/** Settings that only admins/finance need; never sent to clients in /lookups beyond what bills need. */
export async function getSettings(trx = db) {
  const rows = await trx('settings').select('key', 'value');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value ?? '';
  return out;
}

/* ---------------- Stock ---------------- */
async function sumBy(trx, table, keyCol, sumCol, where) {
  const q = trx(table).select(`${keyCol} as id`).sum({ s: sumCol }).whereNotNull(keyCol).groupBy(keyCol);
  if (where) where(q);
  const rows = await q;
  return new Map(rows.map(r => [Number(r.id), n(r.s)]));
}

/** Stock = opening + purchased + produced + returned − raw consumed − sold, per material. */
export async function stockTable(trx = db, materialId = null) {
  const mq = trx('materials').select('*').orderBy([{ column: 'is_raw', order: 'desc' }, { column: 'name' }]);
  if (materialId) mq.where('id', materialId);
  const [mats, purchased, produced, consumed, sold, returned] = await Promise.all([
    mq,
    sumBy(trx, 'purchases', 'material_id', 'qty', materialId && (q => q.where('material_id', materialId))),
    sumBy(trx, 'production', 'material_id', 'qty', materialId && (q => q.where('material_id', materialId))),
    sumBy(trx, 'production', 'raw_material_id', 'raw_qty', materialId && (q => q.where('raw_material_id', materialId))),
    sumBy(trx, 'sales', 'material_id', 'qty', materialId && (q => q.where('material_id', materialId))),
    sumBy(trx, 'credit_notes', 'material_id', 'qty', q => { q.where('restock', true); if (materialId) q.where('material_id', materialId); }),
  ]);
  return mats.map(raw => {
    const m = norm(raw);
    const row = {
      ...m,
      purchased: purchased.get(m.id) || 0,
      produced: produced.get(m.id) || 0,
      consumed: consumed.get(m.id) || 0,
      sold: sold.get(m.id) || 0,
      returned: returned.get(m.id) || 0,
    };
    row.current = r3(m.opening + row.purchased + row.produced + row.returned - row.consumed - row.sold);
    row.value = r2(Math.max(0, row.current) * m.rate);
    row.low = row.current <= m.reorder_level;
    return row;
  });
}

export async function stockOf(materialId, trx = db) {
  const [row] = await stockTable(trx, materialId);
  return row;
}

/* ---------------- Party balances & ledger ---------------- */
/** Positive = party owes us (receivable). Negative = we owe the party (payable). */
export async function partyBalances(ids = null, trx = db) {
  const scope = q => (ids ? q.whereIn('party_id', ids) : q);
  const freightQ = trx('sales as s').join('vehicles as v', 'v.number', 's.vehicle_no').whereNotNull('v.owner_party_id').where('s.freight_cost', '>', 0)
    .select('v.owner_party_id as party_id').sum({ a: 's.freight_cost' }).groupBy('v.owner_party_id');
  if (ids) freightQ.whereIn('v.owner_party_id', ids);
  const [parties, sales, purchases, payments, credits, freight] = await Promise.all([
    (ids ? trx('parties').whereIn('id', ids) : trx('parties')).select('id', 'opening'),
    scope(trx('sales').select('party_id').sum({ a: 'amount', p: 'paid' }).groupBy('party_id')),
    scope(trx('purchases').select('party_id').sum({ a: 'amount', p: 'paid' }).groupBy('party_id')),
    scope(trx('payments').select('party_id', 'direction').sum({ a: 'amount' }).groupBy('party_id', 'direction')),
    scope(trx('credit_notes').select('party_id').sum({ a: 'amount' }).groupBy('party_id')),
    freightQ,
  ]);
  const bal = new Map(parties.map(p => [Number(p.id), n(p.opening)]));
  const add = (id, v) => bal.set(Number(id), (bal.get(Number(id)) || 0) + v);
  sales.forEach(r => add(r.party_id, n(r.a) - n(r.p)));
  purchases.forEach(r => add(r.party_id, -(n(r.a) - n(r.p))));
  payments.forEach(r => add(r.party_id, r.direction === 'in' ? -n(r.a) : n(r.a)));
  credits.forEach(r => add(r.party_id, -n(r.a)));
  freight.forEach(r => add(r.party_id, -n(r.a)));
  for (const [k, v] of bal) bal.set(k, r2(v));
  return bal;
}

export async function partyLedger(partyId, trx = db) {
  const party = norm(await trx('parties').where({ id: partyId }).first());
  if (!party) return null;
  const [sales, purchases, payments, credits, freight] = await Promise.all([
    trx('sales as s').join('materials as m', 'm.id', 's.material_id').where('s.party_id', partyId)
      .select('s.id', 's.date', 's.bill_no', 's.qty', 's.amount', 's.paid', 's.mode', 'm.name as material', 'm.unit'),
    trx('purchases as p').join('materials as m', 'm.id', 'p.material_id').where('p.party_id', partyId)
      .select('p.id', 'p.date', 'p.qty', 'p.amount', 'p.paid', 'p.mode', 'm.name as material', 'm.unit'),
    trx('payments').where('party_id', partyId).select('id', 'date', 'direction', 'amount', 'mode', 'reference'),
    trx('credit_notes').where('party_id', partyId).select('id', 'date', 'note_no', 'qty', 'amount'),
    trx('sales as s').join('vehicles as v', 'v.number', 's.vehicle_no').where('v.owner_party_id', partyId).where('s.freight_cost', '>', 0)
      .select('s.id', 's.date', 's.bill_no', 's.vehicle_no', 's.freight_cost'),
  ]);
  const rows = [];
  sales.map(norm).forEach(s => {
    rows.push({ date: s.date, ref: `sale:${s.id}`, desc: `Sale ${s.bill_no || ''} · ${s.material} ${s.qty} ${s.unit}`, debit: s.amount, credit: 0 });
    if (s.paid) rows.push({ date: s.date, ref: `sale:${s.id}`, desc: `Received with ${s.bill_no || 'sale'} (${s.mode || ''})`, debit: 0, credit: s.paid });
  });
  purchases.map(norm).forEach(p => {
    rows.push({ date: p.date, ref: `purchase:${p.id}`, desc: `Purchase · ${p.material} ${p.qty} ${p.unit}`, debit: 0, credit: p.amount });
    if (p.paid) rows.push({ date: p.date, ref: `purchase:${p.id}`, desc: `Paid with purchase (${p.mode || ''})`, debit: p.paid, credit: 0 });
  });
  payments.map(norm).forEach(p => {
    rows.push(p.direction === 'in'
      ? { date: p.date, ref: `payment:${p.id}`, desc: `Payment received (${p.mode || ''}) ${p.reference || ''}`.trim(), debit: 0, credit: p.amount }
      : { date: p.date, ref: `payment:${p.id}`, desc: `Payment made (${p.mode || ''}) ${p.reference || ''}`.trim(), debit: p.amount, credit: 0 });
  });
  credits.map(norm).forEach(c => {
    rows.push({ date: c.date, ref: `credit:${c.id}`, desc: `Credit note ${c.note_no} (return ${c.qty})`, debit: 0, credit: c.amount });
  });
  freight.map(norm).forEach(f => {
    rows.push({ date: f.date, ref: `freight:${f.id}`, desc: `Freight · ${f.vehicle_no} trip ${f.bill_no || ''}`.trim(), debit: 0, credit: f.freight_cost });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let balance = party.opening;
  for (const r of rows) {
    balance = r2(balance + r.debit - r.credit);
    r.balance = balance;
  }
  return { party, opening: party.opening, rows, balance };
}
