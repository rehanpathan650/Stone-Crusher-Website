import express from 'express';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth/session.js';
import { audit } from '../lib/audit.js';
import { norm, n, r2, today, monthStart } from '../lib/util.js';
import { sendXlsx } from '../lib/xlsx.js';
import { partyBalances, getSettings } from '../services/business.js';
import { payrollFor } from '../services/payroll.js';

const router = express.Router();
router.use(requireAuth, requirePerm('finance'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const qDate = v => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
const wantsXlsx = req => req.query.format === 'xlsx';
async function xlsx(req, res, name, sheets) {
  await audit(req, 'export', `report:${name}`, null, { format: 'xlsx', from: req.query.from || null, to: req.query.to || null });
  sendXlsx(res, `${name}-${today()}`, sheets);
}

/* ---------------- Outstanding ageing ---------------- */
const BUCKETS = [['0-30', 30], ['31-60', 60], ['61-90', 90], ['90+', Infinity]];

/**
 * Receivables by age. Payments settle the oldest bills first (FIFO), so what is still
 * outstanding is made of the newest bills: walk bills from newest to oldest until the
 * party's balance is covered. Anything left over is older than every bill (opening balance).
 */
export async function ageing(asof = today()) {
  const [parties, balances, sales] = await Promise.all([
    db('parties').whereIn('type', ['customer', 'both']).select('id', 'name', 'phone'),
    partyBalances(),
    db('sales').where('date', '<=', asof).whereRaw('amount > paid').select('party_id', 'date', 'bill_no', 'amount', 'paid')
      .orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]),
  ]);
  const bills = new Map();
  sales.map(norm).forEach(s => { if (!bills.has(s.party_id)) bills.set(s.party_id, []); bills.get(s.party_id).push(s); });
  const rows = [];
  for (const p of parties) {
    const id = Number(p.id), balance = balances.get(id) || 0;
    if (balance <= 0.005) continue;
    let left = balance;
    const b = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
    let oldest = null;
    for (const s of bills.get(id) || []) {
      if (left <= 0.005) break;
      const take = Math.min(left, s.amount - s.paid);
      const age = daysBetween(s.date, asof);
      b[BUCKETS.find(([, max]) => age <= max)[0]] += take;
      left -= take;
      oldest = s.date;
    }
    if (left > 0.005) b['90+'] += left; // opening balance or older than every bill
    for (const k of Object.keys(b)) b[k] = r2(b[k]);
    rows.push({ id, name: p.name, phone: p.phone, balance, ...b, oldest_bill: oldest, oldest_days: oldest ? daysBetween(oldest, asof) : null });
  }
  rows.sort((x, y) => y['90+'] - x['90+'] || y.balance - x.balance);
  const totals = Object.fromEntries(['balance', ...BUCKETS.map(([k]) => k)].map(k => [k, r2(rows.reduce((a, r) => a + r[k], 0))]));
  return { asof, buckets: BUCKETS.map(([k]) => k), rows, totals };
}

router.get('/ageing', async (req, res) => {
  const data = await ageing(qDate(req.query.asof) || today());
  if (wantsXlsx(req)) {
    return xlsx(req, res, 'outstanding-ageing', [{ name: `Ageing ${data.asof}`, rows: [
      ['Customer', 'Phone', 'Outstanding', ...data.buckets.map(b => `${b} days`), 'Oldest unpaid bill'],
      ...data.rows.map(r => [r.name, r.phone || '', r.balance, ...data.buckets.map(b => r[b]), r.oldest_bill || '']),
      ['Total', '', data.totals.balance, ...data.buckets.map(b => data.totals[b])],
    ] }]);
  }
  res.json(data);
});

/* ---------------- Cash book / bank book ---------------- */
const BANK_MODES = ['UPI', 'Bank Transfer', 'Cheque'];
const forBook = (q, book, col = 'mode') => (book === 'cash' ? q.where(col, 'Cash') : q.whereIn(col, BANK_MODES));

/** Every money movement in a book: receipts with sales, payments with purchases, separate payments, and expenses. */
function movements(book, from, to) {
  const range = q => { if (from) q.where('date', '>=', from); if (to) q.where('date', '<=', to); return q; };
  return Promise.all([
    forBook(range(db('sales as s').leftJoin('parties as p', 'p.id', 's.party_id')), book, 's.mode').where('s.paid', '>', 0)
      .select('s.id', 's.date', 's.bill_no', 's.paid as amount', 's.mode', 'p.name as party'),
    forBook(range(db('purchases as x').leftJoin('parties as p', 'p.id', 'x.party_id')), book, 'x.mode').where('x.paid', '>', 0)
      .select('x.id', 'x.date', 'x.paid as amount', 'x.mode', 'p.name as party'),
    forBook(range(db('payments as y').leftJoin('parties as p', 'p.id', 'y.party_id')), book, 'y.mode')
      .select('y.id', 'y.date', 'y.direction', 'y.amount', 'y.mode', 'y.reference', 'p.name as party'),
    forBook(range(db('expenses as e')), book, 'e.mode').select('e.id', 'e.date', 'e.amount', 'e.mode', 'e.category', 'e.description'),
  ]);
}
async function netBefore(book, from) {
  const sum = async (q, col) => n((await q.sum({ v: col }).first())?.v);
  const before = q => q.where('date', '<', from);
  const [sIn, pOut, yIn, yOut, eOut] = await Promise.all([
    sum(forBook(before(db('sales')), book), 'paid'),
    sum(forBook(before(db('purchases')), book), 'paid'),
    sum(forBook(before(db('payments')), book).where('direction', 'in'), 'amount'),
    sum(forBook(before(db('payments')), book).where('direction', 'out'), 'amount'),
    sum(forBook(before(db('expenses')), book), 'amount'),
  ]);
  return sIn + yIn - pOut - yOut - eOut;
}

export async function cashBook(book, from, to) {
  const settings = await getSettings();
  const openingSetting = n(book === 'cash' ? settings.opening_cash : settings.opening_bank);
  const opening = r2(openingSetting + (await netBefore(book, from)));
  const [sales, purchases, payments, expenses] = await movements(book, from, to);
  const entries = [
    ...sales.map(norm).map(s => ({ date: s.date, ref: `sale:${s.id}`, desc: `Sale ${s.bill_no || ''} · ${s.party || ''}`, mode: s.mode, in: n(s.amount), out: 0 })),
    ...purchases.map(norm).map(x => ({ date: x.date, ref: `purchase:${x.id}`, desc: `Purchase · ${x.party || ''}`, mode: x.mode, in: 0, out: n(x.amount) })),
    ...payments.map(norm).map(y => ({ date: y.date, ref: `payment:${y.id}`, desc: `${y.direction === 'in' ? 'Received from' : 'Paid to'} ${y.party || ''}${y.reference ? ` (${y.reference})` : ''}`,
      mode: y.mode, in: y.direction === 'in' ? n(y.amount) : 0, out: y.direction === 'out' ? n(y.amount) : 0 })),
    ...expenses.map(norm).map(e => ({ date: e.date, ref: `expense:${e.id}`, desc: `${e.category}${e.description ? ` · ${e.description}` : ''}`, mode: e.mode, in: 0, out: n(e.amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.in - a.in);
  let bal = opening;
  const days = new Map();
  for (const e of entries) {
    bal = r2(bal + e.in - e.out);
    e.balance = bal;
    const d = days.get(e.date) || { date: e.date, in: 0, out: 0 };
    d.in = r2(d.in + e.in); d.out = r2(d.out + e.out); d.closing = bal;
    days.set(e.date, d);
  }
  return {
    book, from, to, opening, closing: bal,
    totalIn: r2(entries.reduce((a, e) => a + e.in, 0)), totalOut: r2(entries.reduce((a, e) => a + e.out, 0)),
    entries, days: [...days.values()],
  };
}

router.get('/cashbook', async (req, res) => {
  const book = req.query.book === 'bank' ? 'bank' : 'cash';
  const from = qDate(req.query.from) || monthStart(), to = qDate(req.query.to) || today();
  const data = await cashBook(book, from, to);
  if (wantsXlsx(req)) {
    const title = book === 'cash' ? 'Cash book' : 'Bank book';
    return xlsx(req, res, `${book}-book`, [
      { name: title, rows: [['Date', 'Particulars', 'Mode', 'Receipt', 'Payment', 'Balance'], ['', 'Opening balance', '', '', '', data.opening],
        ...data.entries.map(e => [e.date, e.desc, e.mode, e.in || '', e.out || '', e.balance]), ['', 'Closing balance', '', data.totalIn, data.totalOut, data.closing]] },
      { name: 'Daily closing', rows: [['Date', 'Receipts', 'Payments', 'Closing'], ...data.days.map(d => [d.date, d.in, d.out, d.closing])] },
    ]);
  }
  res.json(data);
});

/* ---------------- GST returns (GSTR-1 style summary) ---------------- */
export async function gstReport(from, to) {
  const range = (q, col) => { if (from) q.where(col, '>=', from); if (to) q.where(col, '<=', to); return q; };
  const [sales, credits, purchases] = await Promise.all([
    range(db('sales as s'), 's.date').join('parties as p', 'p.id', 's.party_id').join('materials as m', 'm.id', 's.material_id')
      .select('s.id', 's.date', 's.bill_no', 's.qty', 's.subtotal', 's.gst_pct', 's.gst_amount', 's.cgst', 's.sgst', 's.igst', 's.amount', 's.tax_type',
        'p.name as party', 'p.gstin', 'p.state', 'm.hsn', 'm.unit', 'm.name as material')
      .orderBy([{ column: 's.date' }, { column: 's.id' }]),
    range(db('credit_notes as c'), 'c.date').join('parties as p', 'p.id', 'c.party_id').join('materials as m', 'm.id', 'c.material_id')
      .join('sales as s', 's.id', 'c.sale_id')
      .select('c.id', 'c.date', 'c.note_no', 's.bill_no', 's.date as bill_date', 'c.qty', 'c.subtotal', 'c.gst_pct', 'c.gst_amount', 'c.cgst', 'c.sgst', 'c.igst',
        'c.amount', 'c.tax_type', 'p.name as party', 'p.gstin', 'm.hsn', 'm.unit')
      .orderBy([{ column: 'c.date' }, { column: 'c.id' }]),
    range(db('purchases as x'), 'x.date').join('parties as p', 'p.id', 'x.party_id').where('x.gst_amount', '>', 0)
      .select('x.id', 'x.date', 'x.bill_no', 'x.subtotal', 'x.gst_pct', 'x.gst_amount', 'x.cgst', 'x.sgst', 'x.igst', 'x.amount', 'p.name as party', 'p.gstin')
      .orderBy([{ column: 'x.date' }, { column: 'x.id' }]),
  ]);
  const S = sales.map(norm), C = credits.map(norm);
  const tax = ['subtotal', 'cgst', 'sgst', 'igst', 'gst_amount'];
  const add = (acc, r, sign = 1) => { tax.forEach(k => { acc[k] = r2((acc[k] || 0) + sign * r[k]); }); return acc; };

  const b2b = S.filter(s => s.gstin).map(s => ({ date: s.date, bill_no: s.bill_no, party: s.party, gstin: s.gstin, place: s.state || '', rate: s.gst_pct,
    taxable: s.subtotal, cgst: s.cgst, sgst: s.sgst, igst: s.igst, invoice_value: s.amount }));
  const b2cMap = new Map();
  S.filter(s => !s.gstin).forEach(s => {
    const k = `${s.tax_type}|${s.gst_pct}`;
    b2cMap.set(k, add(b2cMap.get(k) || { supply: s.tax_type === 'inter' ? 'Inter-state' : 'Intra-state', rate: s.gst_pct, count: 0 }, s));
    b2cMap.get(k).count += 1;
  });
  const hsnMap = new Map();
  const hsnAdd = (r, sign) => {
    const k = `${r.hsn || ''}|${r.unit}|${r.gst_pct}`;
    const h = hsnMap.get(k) || { hsn: r.hsn || '', unit: r.unit, rate: r.gst_pct, qty: 0 };
    h.qty = r2(h.qty + sign * r.qty);
    hsnMap.set(k, add(h, r, sign));
  };
  S.forEach(s => hsnAdd(s, 1));
  C.forEach(c => hsnAdd(c, -1));
  const salesTot = S.reduce((a, s) => add(a, s), {});
  const creditTot = C.reduce((a, c) => add(a, c), {});
  const net = Object.fromEntries(tax.map(k => [k, r2((salesTot[k] || 0) - (creditTot[k] || 0))]));
  const P = purchases.map(norm);
  const input = P.reduce((a, x) => add(a, x), {});
  // Net payable per head after input tax credit (negative = credit carried forward). A working figure, not a filed return.
  const payable = Object.fromEntries(['cgst', 'sgst', 'igst', 'gst_amount'].map(k => [k, r2((net[k] || 0) - (input[k] || 0))]));
  return {
    from, to,
    summary: { invoices: S.length, creditNotes: C.length, purchases: P.length, sales: salesTot, credits: creditTot, net, input, payable },
    inputBills: P.map(x => ({ date: x.date, bill_no: x.bill_no || '', party: x.party, gstin: x.gstin || '', rate: x.gst_pct, taxable: x.subtotal,
      cgst: x.cgst, sgst: x.sgst, igst: x.igst, value: x.amount })),
    b2b, b2c: [...b2cMap.values()].sort((a, b) => a.rate - b.rate),
    hsn: [...hsnMap.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate),
    creditNotes: C.map(c => ({ date: c.date, note_no: c.note_no, bill_no: c.bill_no, bill_date: c.bill_date, party: c.party, gstin: c.gstin || '',
      rate: c.gst_pct, taxable: c.subtotal, cgst: c.cgst, sgst: c.sgst, igst: c.igst, value: c.amount })),
  };
}

router.get('/gst', async (req, res) => {
  const from = qDate(req.query.from) || monthStart(), to = qDate(req.query.to) || today();
  const g = await gstReport(from, to);
  if (wantsXlsx(req)) {
    return xlsx(req, res, `gst-${from}-to-${to}`, [
      { name: 'Summary', rows: [['', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total tax'],
        ['Sales', g.summary.sales.subtotal || 0, g.summary.sales.cgst || 0, g.summary.sales.sgst || 0, g.summary.sales.igst || 0, g.summary.sales.gst_amount || 0],
        ['Less: credit notes', g.summary.credits.subtotal || 0, g.summary.credits.cgst || 0, g.summary.credits.sgst || 0, g.summary.credits.igst || 0, g.summary.credits.gst_amount || 0],
        ['Net output tax', g.summary.net.subtotal, g.summary.net.cgst, g.summary.net.sgst, g.summary.net.igst, g.summary.net.gst_amount],
        ['Less: input tax on purchases', g.summary.input.subtotal || 0, g.summary.input.cgst || 0, g.summary.input.sgst || 0, g.summary.input.igst || 0, g.summary.input.gst_amount || 0],
        ['Net GST payable', '', g.summary.payable.cgst, g.summary.payable.sgst, g.summary.payable.igst, g.summary.payable.gst_amount]] },
      { name: 'Input tax (purchases)', rows: [['Date', 'Supplier bill', 'Supplier', 'GSTIN', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Value'],
        ...g.inputBills.map(r => [r.date, r.bill_no, r.party, r.gstin, r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.value])] },
      { name: 'B2B', rows: [['GSTIN', 'Customer', 'Invoice no.', 'Date', 'Place of supply', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Invoice value'],
        ...g.b2b.map(r => [r.gstin, r.party, r.bill_no, r.date, r.place, r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.invoice_value])] },
      { name: 'B2C', rows: [['Supply', 'Rate %', 'Invoices', 'Taxable', 'CGST', 'SGST', 'IGST'],
        ...g.b2c.map(r => [r.supply, r.rate, r.count, r.subtotal, r.cgst, r.sgst, r.igst])] },
      { name: 'HSN', rows: [['HSN', 'Unit', 'Rate %', 'Quantity', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total tax'],
        ...g.hsn.map(r => [r.hsn, r.unit, r.rate, r.qty, r.subtotal, r.cgst, r.sgst, r.igst, r.gst_amount])] },
      { name: 'Credit notes', rows: [['Note no.', 'Date', 'Against bill', 'Bill date', 'Customer', 'GSTIN', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Value'],
        ...g.creditNotes.map(r => [r.note_no, r.date, r.bill_no, r.bill_date, r.party, r.gstin, r.rate, r.taxable, r.cgst, r.sgst, r.igst, r.value])] },
    ]);
  }
  res.json(g);
});

/* ---------------- Excel versions of payroll ---------------- */
router.get('/payroll.xlsx', requirePerm('payroll'), async (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month)) ? String(req.query.month) : today().slice(0, 7);
  const p = await payrollFor(month);
  return xlsx(req, res, `payroll-${month}`, [{ name: `Payroll ${month}`, rows: [
    ['Employee', 'Role', 'Wage', 'Wage type', 'Present', 'Half', 'Absent', 'Paid days', 'OT hours', 'Basic', 'Overtime', 'Bonus', 'Deduction', 'Net', 'Brought forward', 'Paid', 'Balance'],
    ...p.rows.map(r => [r.name, r.role || '', r.wage, r.wage_type, r.present, r.half, r.absent, r.days, r.ot_hours, r.basic, r.ot_pay, r.bonus, r.deduction, r.net, r.brought_forward, r.paid, r.due]),
  ] }]);
});

export default router;
