import express from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth, requirePerm } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { norm, n, r2, today, monthStart, daysAgo } from '../lib/util.js';
import { stockTable, partyBalances, partyLedger, getSettings, DEFAULT_SETTINGS } from '../services/business.js';
import { dateStr, UNITS, PAY_MODES, EXPENSE_CATEGORIES, SHIFTS, VEHICLE_KINDS, MAINTENANCE_KINDS, DOWNTIME_REASONS, WEIGHMENT_TYPES } from '../resources.js';
import { STATE_NAMES, STATES } from '../lib/gst.js';
import { payrollFor, wageSlip } from '../services/payroll.js';
import { ageing } from './reports.js';
import { badRequest } from '../lib/errors.js';
import { sendXlsx } from '../lib/xlsx.js';

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const qDate = v => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
const ranged = (q, from, to, col = 'date') => {
  if (from) q.where(col, '>=', from);
  if (to) q.where(col, '<=', to);
  return q;
};
async function sums(table, cols, where) {
  const q = db(table).count({ count: 'id' });
  for (const [alias, col] of Object.entries(cols)) q.sum({ [alias]: col });
  where?.(q);
  const row = (await q.first()) || {};
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, n(v)]));
}

/* ---------- Dropdown data for forms (minimal fields) ---------- */
router.get('/lookups', async (req, res) => {
  const [materials, parties, employees, vehicles, settings] = await Promise.all([
    db('materials').select('id', 'name', 'unit', 'rate', 'is_raw', 'hsn').orderBy([{ column: 'is_raw', order: 'desc' }, { column: 'name' }]),
    db('parties').select('id', 'name', 'type').orderBy('name'),
    db('employees').select('id', 'name', 'active').orderBy('name'),
    db('vehicles').select('id', 'number', 'ownership', 'tare_weight', 'freight_rate', 'kind', 'meter_type').orderBy('number'),
    getSettings(),
  ]);
  res.json({
    materials: materials.map(norm), parties, employees: employees.map(norm), vehicles: vehicles.map(norm), settings,
    enums: { units: UNITS, payModes: PAY_MODES, expenseCategories: EXPENSE_CATEGORIES, shifts: SHIFTS, vehicleKinds: VEHICLE_KINDS, states: STATE_NAMES, stateCodes: Object.fromEntries(STATES),
      maintenanceKinds: MAINTENANCE_KINDS, downtimeReasons: DOWNTIME_REASONS, weighmentTypes: WEIGHMENT_TYPES },
  });
});

/* ---------- Stock ---------- */
router.get('/stock', requirePerm('stock'), async (req, res) => {
  const rows = await stockTable();
  if (!can(req.user.role, 'finance')) rows.forEach(r => { delete r.value; });
  res.json({ rows });
});

/* ---------- Royalty balance ---------- */
export async function royaltySummary() {
  const [permits, used, missing, settings] = await Promise.all([
    db('royalty_permits').sum({ q: 'qty' }).first(),
    db('sales as s').join('materials as m', 'm.id', 's.material_id').where('m.unit', 'Ton').whereNotNull('s.royalty_pass_no').sum({ q: 's.qty' }).first(),
    db('sales as s').join('materials as m', 'm.id', 's.material_id').where('m.unit', 'Ton').whereNull('s.royalty_pass_no')
      .where('s.date', '>=', daysAgo(29)).count({ c: 's.id' }).first(),
    getSettings(),
  ]);
  const permitted = n(permits?.q), dispatched = n(used?.q);
  const alertAt = n(settings.royalty_alert_qty);
  const balance = r2(permitted - dispatched);
  return { permitted, dispatched, balance, alertAt, low: permitted > 0 && balance <= alertAt, missingPasses30d: n(missing?.c) };
}
router.get('/royalty/summary', requirePerm('royalty_permits'), async (req, res) => res.json(await royaltySummary()));

/* ---------- Diesel efficiency ---------- */
/**
 * Per machine: consumption between meter readings. Litres of the first fill in the period are excluded,
 * because they were burned before the first reading. An interval >25% above the machine's own average is flagged.
 */
export async function dieselEfficiency(from, to) {
  const logs = await ranged(db('diesel_logs as d'), from, to, 'd.date').join('vehicles as v', 'v.id', 'd.vehicle_id')
    .select('d.id', 'd.date', 'd.vehicle_id', 'd.litres', 'd.meter', 'v.number', 'v.meter_type', 'v.kind')
    .orderBy([{ column: 'd.vehicle_id' }, { column: 'd.date' }, { column: 'd.meter' }, { column: 'd.id' }]);
  const by = new Map();
  for (const l of logs.map(norm)) {
    if (!by.has(l.vehicle_id)) by.set(l.vehicle_id, { vehicle_id: l.vehicle_id, number: l.number, kind: l.kind, meter_type: l.meter_type, fills: 0, litres: 0, logs: [] });
    const v = by.get(l.vehicle_id);
    v.fills += 1;
    v.litres = r2(v.litres + n(l.litres));
    v.logs.push(l);
  }
  const out = [];
  for (const v of by.values()) {
    const read = v.logs.filter(l => l.meter != null);
    const intervals = [];
    for (let i = 1; i < read.length; i++) {
      const span = read[i].meter - read[i - 1].meter;
      const litresBetween = v.logs.filter(l => l !== read[i - 1] && v.logs.indexOf(l) > v.logs.indexOf(read[i - 1]) && v.logs.indexOf(l) <= v.logs.indexOf(read[i]))
        .reduce((a, l) => a + n(l.litres), 0);
      if (span > 0 && litresBetween > 0) intervals.push({ date: read[i].date, span, litres: litresBetween, perUnit: litresBetween / span });
    }
    const span = intervals.reduce((a, x) => a + x.span, 0), used = intervals.reduce((a, x) => a + x.litres, 0);
    const avg = span ? used / span : null; // litres per km or per hour
    const latest = intervals.at(-1);
    const flagged = intervals.filter(x => avg && x.perUnit > avg * 1.25).map(x => ({ date: x.date, perUnit: r2(x.perUnit) }));
    out.push({
      vehicle_id: v.vehicle_id, number: v.number, kind: v.kind, meter_type: v.meter_type, fills: v.fills, litres: v.litres,
      distance: r2(span),
      // Hours-based machines: litres per hour. Vehicles: km per litre (how drivers think about it).
      efficiency: avg == null ? null : v.meter_type === 'hours' ? r2(avg) : r2(1 / avg),
      efficiencyUnit: v.meter_type === 'hours' ? 'L/hr' : 'km/L',
      latest: latest ? (v.meter_type === 'hours' ? r2(latest.perUnit) : r2(1 / latest.perUnit)) : null,
      abnormal: flagged.length > 0 && latest && flagged.at(-1).date === latest.date,
      flagged,
    });
  }
  return out.sort((a, b) => Number(b.abnormal) - Number(a.abnormal) || b.litres - a.litres);
}
router.get('/diesel/efficiency', requirePerm('diesel_logs'), async (req, res) => {
  res.json({ rows: await dieselEfficiency(qDate(req.query.from), qDate(req.query.to)) });
});

/* ---------- Service reminders ---------- */
/** Machines whose latest maintenance set a next-due date within 7 days or a next-due reading within 50 units of the latest meter. */
export async function serviceDue() {
  const [latest, dieselMeters, serviceMeters, vehicles] = await Promise.all([
    db('maintenance').where(q => q.whereNotNull('next_due_date').orWhereNotNull('next_due_meter'))
      .select('vehicle_id', 'date', 'kind', 'next_due_date', 'next_due_meter', 'id').orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]),
    db('diesel_logs').whereNotNull('meter').select('vehicle_id').max({ m: 'meter' }).groupBy('vehicle_id'),
    db('maintenance').whereNotNull('meter').select('vehicle_id').max({ m: 'meter' }).groupBy('vehicle_id'),
    db('vehicles').select('id', 'number', 'meter_type'),
  ]);
  const meters = [...dieselMeters, ...serviceMeters];
  const seen = new Set(), meterMap = new Map(), vmap = new Map(vehicles.map(v => [Number(v.id), v]));
  meters.forEach(m => meterMap.set(Number(m.vehicle_id), Math.max(meterMap.get(Number(m.vehicle_id)) || 0, n(m.m))));
  const soon = daysAgo(-7), out = [];
  for (const raw of latest) {
    const m = norm(raw), vid = Number(m.vehicle_id);
    if (seen.has(vid)) continue; // only the most recent plan per machine counts
    seen.add(vid);
    const current = meterMap.get(vid) ?? null;
    const byDate = m.next_due_date && m.next_due_date <= soon;
    const byMeter = m.next_due_meter != null && current != null && current >= m.next_due_meter - 50;
    if (!byDate && !byMeter) continue;
    const v = vmap.get(vid) || {};
    out.push({ vehicle_id: vid, number: v.number, meter_type: v.meter_type, last_service: m.date, kind: m.kind, next_due_date: m.next_due_date,
      next_due_meter: m.next_due_meter, current_meter: current, overdue: Boolean((m.next_due_date && m.next_due_date < today()) || (byMeter && current >= m.next_due_meter)) });
  }
  return out;
}
router.get('/maintenance/due', requirePerm('maintenance'), async (req, res) => res.json({ rows: await serviceDue() }));

/* ---------- Notifications ---------- */
/**
 * Computed on request from the live data, filtered by role. Ids are stable, so the browser can
 * remember which ones a person dismissed; a changed situation (e.g. stock drops further) gets a new id.
 */
/** '2026-11-12' → '12 Nov 2026' for alert text. */
const niceDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

router.get('/notifications', async (req, res) => {
  const role = req.user.role, items = [];
  const fin = can(role, 'finance');
  const tasks = [stockTable(), can(role, 'maintenance') ? serviceDue() : [], can(role, 'diesel_logs') ? dieselEfficiency(daysAgo(29), '') : [],
    fin ? royaltySummary() : null, fin ? ageing() : null, fin ? getSettings() : null];
  const [stock, due, diesel, royalty, age, settings] = await Promise.all(tasks);
  stock.filter(s => s.low && (s.reorder_level > 0 || s.current < 0)).forEach(s => items.push({
    id: `stock:${s.id}:${Math.floor(s.current)}`, kind: 'stock', severity: s.current <= 0 ? 'high' : 'medium',
    title: `Low stock: ${s.name}`, body: `${s.current} ${s.unit} left (alert at ${s.reorder_level}).`, link: '/stock',
  }));
  due.forEach(d => items.push({
    id: `service:${d.vehicle_id}:${d.next_due_date || ''}:${d.next_due_meter ?? ''}`, kind: 'service', severity: d.overdue ? 'high' : 'medium',
    title: `${d.overdue ? 'Service overdue' : 'Service due'}: ${d.number}`,
    body: [d.next_due_date && `Due ${niceDate(d.next_due_date)}`, d.next_due_meter != null && `at ${d.next_due_meter} ${d.meter_type === 'hours' ? 'hours' : 'km'} (now ${d.current_meter ?? '?'})`].filter(Boolean).join(', '),
    link: '/maintenance',
  }));
  diesel.filter(d => d.abnormal).forEach(d => items.push({
    id: `diesel:${d.vehicle_id}:${d.flagged.at(-1).date}`, kind: 'diesel', severity: 'medium',
    title: `High diesel use: ${d.number}`, body: `Latest ${d.latest} ${d.efficiencyUnit} vs usual ${d.efficiency} ${d.efficiencyUnit}.`, link: '/diesel_logs',
  }));
  if (royalty?.low) items.push({
    id: `royalty:${Math.floor(royalty.balance)}`, kind: 'royalty', severity: royalty.balance <= 0 ? 'high' : 'medium',
    title: 'Royalty balance low', body: `${royalty.balance} tons left on permits (alert at ${royalty.alertAt}).`, link: '/royalty_permits',
  });
  if (age) {
    const overdue = age.rows.filter(r => r['61-90'] + r['90+'] > 0.005);
    overdue.slice(0, 5).forEach(r => items.push({
      id: `overdue:${r.id}:${Math.round(r['61-90'] + r['90+'])}`, kind: 'overdue', severity: r['90+'] > 0 ? 'high' : 'medium',
      title: `Overdue payment: ${r.name}`, body: `${settings.currency}${(r['61-90'] + r['90+']).toLocaleString('en-IN')} unpaid for over 60 days.`, link: `/parties/${r.id}`,
      phone: r.phone, amount: r2(r['61-90'] + r['90+']),
    }));
    if (overdue.length > 5) items.push({ id: `overdue:more:${overdue.length}`, kind: 'overdue', severity: 'low', title: `${overdue.length - 5} more customers overdue`, body: 'See the ageing report.', link: '/reports?tab=ageing' });
  }
  if (settings && n(settings.large_expense) > 0) {
    const big = await db('expenses').where('date', '>=', daysAgo(6)).where('amount', '>=', n(settings.large_expense)).orderBy('date', 'desc').limit(10)
      .select('id', 'date', 'category', 'amount', 'description');
    big.map(norm).forEach(e => items.push({
      id: `expense:${e.id}`, kind: 'expense', severity: 'low', title: `Large expense: ${settings.currency}${e.amount.toLocaleString('en-IN')}`,
      body: `${e.category}${e.description ? ` · ${e.description}` : ''} on ${niceDate(e.date)}.`, link: '/expenses',
    }));
  }
  const rank = { high: 0, medium: 1, low: 2 };
  res.json({ items: items.sort((a, b) => rank[a.severity] - rank[b.severity]) });
});

/* ---------- Trips & freight per vehicle ---------- */
router.get('/reports/vehicles', requirePerm('finance'), async (req, res) => {
  const from = qDate(req.query.from), to = qDate(req.query.to);
  const rows = await ranged(db('sales as s'), from, to, 's.date').whereNotNull('s.vehicle_no')
    .leftJoin('vehicles as v', 'v.number', 's.vehicle_no').leftJoin('parties as p', 'p.id', 'v.owner_party_id')
    .select('s.vehicle_no', 'v.ownership', 'v.kind', 'p.name as owner_name')
    .count({ trips: 's.id' }).sum({ qty: 's.qty', net: 's.net_weight', charged: 's.transport', cost: 's.freight_cost' })
    .groupBy('s.vehicle_no', 'v.ownership', 'v.kind', 'p.name').orderBy('trips', 'desc');
  const out = rows.map(r => ({
    vehicle_no: r.vehicle_no, ownership: r.ownership || 'unregistered', kind: r.kind, owner_name: r.owner_name,
    trips: n(r.trips), qty: n(r.qty), net_kg: n(r.net), charged: n(r.charged), cost: n(r.cost),
  }));
  if (req.query.format === 'xlsx') {
    await audit(req, 'export', 'report:vehicles', null, { format: 'xlsx', from, to });
    return sendXlsx(res, `vehicle-trips-${today()}`, [{ name: 'Trips & freight', rows: [
      ['Vehicle', 'Ownership', 'Owner', 'Trips', 'Quantity', 'Net weight (kg)', 'Freight charged', 'Freight payable'],
      ...out.map(r => [r.vehicle_no, r.ownership, r.owner_name || '', r.trips, r.qty, r.net_kg, r.charged, r.cost])] }]);
  }
  res.json({ from, to, rows: out });
});

/* ---------- Stock movement ledger (one material) ---------- */
/** Every movement in or out, oldest first, with a running balance. Opening = material opening + all movements before `from`. */
router.get('/stock/:id/ledger', requirePerm('stock'), async (req, res) => {
  const id = Number(req.params.id);
  const mat = norm(await db('materials').where({ id }).first());
  if (!mat) throw notFound('Material not found');
  const from = qDate(req.query.from), to = qDate(req.query.to);
  const R = (q, col = 'date') => ranged(q, from, to, col);
  const before = async (table, col, where) => {
    if (!from) return 0;
    const q = db(table).where(col, id).where('date', '<', from);
    if (where) where(q);
    const row = await q.sum({ s: table === 'production' && col === 'raw_material_id' ? 'raw_qty' : 'qty' }).first();
    return n(row?.s);
  };
  const [bPur, bProd, bCons, bSale, bRet, purchases, produced, consumed, sales, returns] = await Promise.all([
    before('purchases', 'material_id'), before('production', 'material_id'), before('production', 'raw_material_id'), before('sales', 'material_id'),
    before('credit_notes', 'material_id', q => q.where('restock', true)),
    R(db('purchases as x').leftJoin('parties as p', 'p.id', 'x.party_id'), 'x.date').where('x.material_id', id).select('x.id', 'x.date', 'x.qty', 'x.bill_no', 'p.name as party'),
    R(db('production'), 'date').where('material_id', id).select('id', 'date', 'qty', 'shift'),
    R(db('production as x').leftJoin('materials as m', 'm.id', 'x.material_id'), 'x.date').where('x.raw_material_id', id).where('x.raw_qty', '>', 0).select('x.id', 'x.date', 'x.raw_qty as qty', 'm.name as output'),
    R(db('sales as x').leftJoin('parties as p', 'p.id', 'x.party_id'), 'x.date').where('x.material_id', id).select('x.id', 'x.date', 'x.qty', 'x.bill_no', 'x.vehicle_no', 'p.name as party'),
    R(db('credit_notes as x'), 'x.date').where('x.material_id', id).where('x.restock', true).select('x.id', 'x.date', 'x.qty', 'x.note_no'),
  ]);
  const rows = [
    ...purchases.map(norm).map(x => ({ date: x.date, ref: `purchase:${x.id}`, type: 'Purchase', desc: [x.party, x.bill_no && `bill ${x.bill_no}`].filter(Boolean).join(' · '), in: x.qty, out: 0 })),
    ...produced.map(norm).map(x => ({ date: x.date, ref: `production:${x.id}`, type: 'Production', desc: `${x.shift || ''} shift`.trim(), in: x.qty, out: 0 })),
    ...returns.map(norm).map(x => ({ date: x.date, ref: `credit:${x.id}`, type: 'Return', desc: `Credit note ${x.note_no}`, in: x.qty, out: 0 })),
    ...consumed.map(norm).map(x => ({ date: x.date, ref: `consumed:${x.id}`, type: 'Used in crushing', desc: `For ${x.output || 'production'}`, in: 0, out: x.qty })),
    ...sales.map(norm).map(x => ({ date: x.date, ref: `sale:${x.id}`, type: 'Dispatch', desc: [x.bill_no, x.party, x.vehicle_no].filter(Boolean).join(' · '), in: 0, out: x.qty })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.in - a.in);
  const opening = r2(mat.opening + bPur + bProd + bRet - bCons - bSale);
  let bal = opening;
  for (const r of rows) { bal = r2(bal + r.in - r.out); r.balance = bal; }
  res.json({ material: { id: mat.id, name: mat.name, unit: mat.unit, is_raw: mat.is_raw }, from, to, opening, closing: bal,
    totalIn: r2(rows.reduce((a, r) => a + r.in, 0)), totalOut: r2(rows.reduce((a, r) => a + r.out, 0)), rows });
});

/* ---------- Party ledger ---------- */
router.get('/parties/:id/ledger', requirePerm('ledger'), async (req, res) => {
  const data = await partyLedger(Number(req.params.id));
  if (!data) throw notFound('Party not found');
  res.json(data);
});

/* ---------- Dashboard ---------- */
router.get('/dashboard', async (req, res) => {
  const fin = can(req.user.role, 'finance');
  const t = today(), ms = monthStart(), start14 = daysAgo(13);
  // Same period last month: 1st .. same day-of-month (capped at that month's length)
  const now = new Date();
  const pmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pmEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const pms = iso(pmStart), pme = iso(pmEnd);
  const [salesToday, salesMonth, prodToday, prodMonth, stock, recent, salesPrev, prodPrev] = await Promise.all([
    sums('sales', { amount: 'amount', qty: 'qty' }, q => q.where('date', t)),
    sums('sales', { amount: 'amount', gst: 'gst_amount', qty: 'qty' }, q => q.where('date', '>=', ms)),
    sums('production', { qty: 'qty' }, q => q.where('date', t)),
    sums('production', { qty: 'qty', hours: 'run_hours' }, q => q.where('date', '>=', ms)),
    stockTable(),
    db('sales as s').leftJoin('parties as p', 'p.id', 's.party_id').leftJoin('materials as m', 'm.id', 's.material_id')
      .select('s.id', 's.date', 's.bill_no', 's.qty', 's.amount', 'p.name as party_name', 'm.name as material_name', 'm.unit')
      .orderBy([{ column: 's.date', order: 'desc' }, { column: 's.id', order: 'desc' }]).limit(8),
    sums('sales', { amount: 'amount', qty: 'qty' }, q => q.whereBetween('date', [pms, pme])),
    sums('production', { qty: 'qty' }, q => q.whereBetween('date', [pms, pme])),
  ]);
  const pct = (cur, prev) => (prev > 0 ? r2(((cur - prev) / prev) * 100) : null);
  const out = {
    today: { sales: { count: salesToday.count, qty: salesToday.qty }, productionQty: prodToday.qty },
    month: { sales: { count: salesMonth.count, qty: salesMonth.qty }, productionQty: prodMonth.qty, runHours: prodMonth.hours },
    trend: { salesQty: pct(salesMonth.qty, salesPrev.qty), production: pct(prodMonth.qty, prodPrev.qty) },
    weighbridge: {
      today: n((await db('weighments').where('date', t).count({ c: 'id' }).first())?.c),
      unbilled: n((await db('weighments').whereNull('sale_id').whereNot('type', 'Empty').count({ c: 'id' }).first())?.c),
    },
    stock: stock.map(s => ({ id: s.id, name: s.name, unit: s.unit, current: s.current, reorder_level: s.reorder_level, low: s.low, is_raw: s.is_raw })),
    recent: recent.map(norm).map(r => (fin ? r : { ...r, amount: undefined })),
  };
  if (fin) {
    const [expMonth, purMonth, salesSeries, expSeries, purSeries, balances, parties, credMonth] = await Promise.all([
      sums('expenses', { amount: 'amount' }, q => q.where('date', '>=', ms)),
      sums('purchases', { amount: 'amount', gst: 'gst_amount' }, q => q.where('date', '>=', ms)),
      db('sales').where('date', '>=', start14).select('date').sum({ v: 'amount' }).groupBy('date'),
      db('expenses').where('date', '>=', start14).select('date').sum({ v: 'amount' }).groupBy('date'),
      db('purchases').where('date', '>=', start14).select('date', db.raw('sum(amount - gst_amount) as v')).groupBy('date'),
      partyBalances(),
      db('parties').select('id', 'name'),
      sums('credit_notes', { amount: 'amount', gst: 'gst_amount' }, q => q.where('date', '>=', ms)),
    ]);
    const days = Array.from({ length: 14 }, (_, i) => daysAgo(13 - i));
    const toMap = rows => new Map(rows.map(r => [r.date, n(r.v)]));
    const sm = toMap(salesSeries), em = toMap(expSeries), pm = toMap(purSeries);
    let receivable = 0, payable = 0;
    for (const b of balances.values()) b > 0 ? (receivable += b) : (payable -= b);
    const names = new Map(parties.map(p => [Number(p.id), p.name]));
    out.today.sales.amount = salesToday.amount;
    out.trend.salesAmount = pct(salesMonth.amount, salesPrev.amount);
    Object.assign(out.month, {
      sales: { ...out.month.sales, amount: salesMonth.amount },
      revenue: r2(salesMonth.amount - salesMonth.gst - (credMonth.amount - credMonth.gst)),
      returns: credMonth.amount,
      expenses: expMonth.amount,
      purchases: r2(purMonth.amount - purMonth.gst),
      profit: r2(salesMonth.amount - salesMonth.gst - (credMonth.amount - credMonth.gst) - expMonth.amount - (purMonth.amount - purMonth.gst)),
    });
    out.receivable = r2(receivable);
    out.payable = r2(payable);
    out.series = days.map(d => ({ date: d, sales: sm.get(d) || 0, costs: r2((em.get(d) || 0) + (pm.get(d) || 0)) }));
    out.topDues = [...balances.entries()].filter(([, b]) => b > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, balance]) => ({ id, name: names.get(id), balance }));
  }
  res.json(out);
});

/* ---------- Reports ---------- */
router.get('/reports', requirePerm('finance'), async (req, res) => {
  const from = qDate(req.query.from), to = qDate(req.query.to);
  const R = (table, col = 'date') => ranged(db(table), from, to, col);
  const [sales, purchases, expByCat, salesByMat, prodByMat, byCustomer, payIn, payOut, expNonCredit, prod, mats, parties, credits, downtime, rawByMat] = await Promise.all([
    sums('sales', { amount: 'amount', gst: 'gst_amount', paid: 'paid', qty: 'qty' }, q => ranged(q, from, to)),
    sums('purchases', { amount: 'amount', paid: 'paid', gst: 'gst_amount' }, q => ranged(q, from, to)),
    R('expenses').select('category').sum({ amount: 'amount' }).groupBy('category').orderBy('amount', 'desc'),
    R('sales').select('material_id').sum({ qty: 'qty', value: 'subtotal' }).count({ count: 'id' }).groupBy('material_id'),
    R('production').select('material_id').sum({ qty: 'qty' }).groupBy('material_id'),
    R('sales').select('party_id').sum({ amount: 'amount', qty: 'qty' }).count({ count: 'id' }).groupBy('party_id').orderBy('amount', 'desc').limit(50),
    sums('payments', { amount: 'amount' }, q => ranged(q, from, to).where('direction', 'in')),
    sums('payments', { amount: 'amount' }, q => ranged(q, from, to).where('direction', 'out')),
    sums('expenses', { amount: 'amount' }, q => ranged(q, from, to).whereNot('mode', 'Credit')),
    sums('production', { qty: 'qty', raw: 'raw_qty', hours: 'run_hours', down: 'downtime_hours' }, q => ranged(q, from, to)),
    db('materials').select('id', 'name', 'unit'),
    db('parties').select('id', 'name'),
    sums('credit_notes', { amount: 'amount', gst: 'gst_amount' }, q => ranged(q, from, to)),
    R('production').whereNotNull('downtime_reason').select('downtime_reason').sum({ h: 'downtime_hours' }).count({ c: 'id' }).groupBy('downtime_reason').orderBy('h', 'desc'),
    R('production').whereNotNull('raw_material_id').where('raw_qty', '>', 0).select('material_id').sum({ out: 'qty', raw: 'raw_qty' }).groupBy('material_id'),
  ]);
  const diesel = n((await R('expenses').where('category', 'Diesel / Fuel').sum({ v: 'amount' }).first())?.v);
  const matMap = new Map(mats.map(m => [Number(m.id), m]));
  const partyMap = new Map(parties.map(p => [Number(p.id), p.name]));
  const expenses = expByCat.map(r => ({ category: r.category, amount: n(r.amount) }));
  const expTotal = r2(expenses.reduce((a, r) => a + r.amount, 0));
  const returnsNet = r2(credits.amount - credits.gst); // credit notes excluding their GST
  const revenue = r2(sales.amount - sales.gst - returnsNet);
  const prodMap = new Map(prodByMat.map(r => [Number(r.material_id), n(r.qty)]));
  const matIds = new Set([...salesByMat.map(r => Number(r.material_id)), ...prodMap.keys()]);
  const salesMatMap = new Map(salesByMat.map(r => [Number(r.material_id), r]));
  const balances = await partyBalances(byCustomer.map(r => Number(r.party_id)));
  const scheduled = r2(prod.hours + prod.down);
  const out = {
    from, to,
    // Purchases are shown without input GST: that tax is recovered from the GST payable, so it is not a cost.
    pnl: { gross: sales.amount, gst: r2(sales.gst - credits.gst), returns: credits.amount, revenue, purchases: r2(purchases.amount - purchases.gst),
      inputGst: purchases.gst, expenses, expenseTotal: expTotal, net: r2(revenue - (purchases.amount - purchases.gst) - expTotal) },
    cash: {
      inflow: r2(sales.paid + payIn.amount),
      outflow: r2(purchases.paid + payOut.amount + expNonCredit.amount),
    },
    plant: {
      output: prod.qty, raw: prod.raw, hours: prod.hours, diesel, dispatches: sales.count,
      downtime: prod.down, availability: scheduled ? r2((prod.hours / scheduled) * 100) : null,
      // Output from entries that recorded raw input ÷ that raw input
      yield: (() => { const o = rawByMat.reduce((a, r) => a + n(r.out), 0), i = rawByMat.reduce((a, r) => a + n(r.raw), 0); return i ? r2((o / i) * 100) : null; })(),
      downtimeByReason: downtime.map(d => ({ reason: d.downtime_reason, hours: n(d.h), count: n(d.c) })),
    },
    byMaterial: [...matIds].map(id => {
      const s = salesMatMap.get(id), m = matMap.get(id) || {};
      const qty = n(s?.qty), value = n(s?.value);
      return { id, name: m.name, unit: m.unit, produced: prodMap.get(id) || 0, sold: qty, value, avgRate: qty ? r2(value / qty) : 0 };
    }).sort((a, b) => b.value - a.value),
    byCustomer: byCustomer.map(r => ({ id: Number(r.party_id), name: partyMap.get(Number(r.party_id)), count: n(r.count), qty: n(r.qty), amount: n(r.amount), balance: balances.get(Number(r.party_id)) ?? 0 })),
  };
  if (req.query.format === 'xlsx') {
    await audit(req, 'export', 'report:summary', null, { format: 'xlsx', from, to });
    const p = out.pnl;
    return sendXlsx(res, `business-report-${from || 'start'}-to-${to || today()}`, [
      { name: 'Profit & loss', rows: [['Item', 'Amount'], ['Sales (incl. GST)', p.gross], ['Less: credit notes', -p.returns], ['Less: GST collected (net)', -p.gst],
        ['Revenue', p.revenue], ['Purchases', -p.purchases], ...p.expenses.map(e => [e.category, -e.amount]), ['Net profit', p.net]] },
      { name: 'By material', rows: [['Material', 'Unit', 'Produced', 'Sold', 'Sales value', 'Average rate'], ...out.byMaterial.map(m => [m.name, m.unit, m.produced, m.sold, m.value, m.avgRate])] },
      { name: 'By customer', rows: [['Customer', 'Bills', 'Quantity', 'Billed', 'Balance now'], ...out.byCustomer.map(c => [c.name, c.count, c.qty, c.amount, c.balance])] },
      { name: 'Plant', rows: [['Measure', 'Value'], ['Output', out.plant.output], ['Raw used', out.plant.raw], ['Running hours', out.plant.hours], ['Downtime hours', out.plant.downtime],
        ['Availability %', out.plant.availability ?? ''], ['Yield %', out.plant.yield ?? ''], ['Diesel cost', out.plant.diesel], ['Dispatches', out.plant.dispatches],
        ...out.plant.downtimeByReason.map(d => [`Downtime: ${d.reason}`, d.hours])] },
    ]);
  }
  res.json(out);
});

/* ---------- Attendance ---------- */
router.get('/attendance', requirePerm('attendance'), async (req, res) => {
  const date = qDate(req.query.date) || today();
  const rows = await db('employees as e')
    .leftJoin('attendance as a', function () { this.on('a.employee_id', 'e.id').andOnVal('a.date', '=', date); })
    .where('e.active', true)
    .select('e.id', 'e.name', 'e.role', 'a.status', 'a.ot_hours')
    .orderBy('e.name');
  res.json({ date, rows: rows.map(r => ({ ...r, ot_hours: n(r.ot_hours) })) });
});

router.put('/attendance', requirePerm('attendance', 'write'), async (req, res) => {
  const body = z.object({
    date: dateStr,
    entries: z.array(z.object({
      employee_id: z.coerce.number().int().positive(), status: z.enum(['P', 'H', 'A']).nullable(),
      ot_hours: z.coerce.number().min(0, 'Cannot be negative').max(16, 'At most 16 overtime hours a day').default(0),
    })).max(2000),
  }).parse(req.body ?? {});
  if (body.date > today()) throw badRequest('Attendance cannot be marked for a future date', { date: 'Choose today or earlier' });
  await db.transaction(async trx => {
    for (const e of body.entries) {
      if (!e.status) await trx('attendance').where({ date: body.date, employee_id: e.employee_id }).del();
      else {
        const ot_hours = e.status === 'A' ? 0 : e.ot_hours; // no overtime on an absent day
        await trx('attendance').insert({ date: body.date, employee_id: e.employee_id, status: e.status, ot_hours })
          .onConflict(['date', 'employee_id']).merge(['status', 'ot_hours']);
      }
    }
  });
  await audit(req, 'attendance', 'attendance', body.date, { entries: body.entries.length });
  res.json({ ok: true });
});

const qMonth = v => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(v)) ? String(v) : today().slice(0, 7));

router.get('/payroll', requirePerm('payroll'), async (req, res) => res.json(await payrollFor(qMonth(req.query.month))));

router.get('/payroll/slip', requirePerm('payroll'), async (req, res) => {
  const slip = await wageSlip(Number(req.query.employee_id) || 0, qMonth(req.query.month));
  if (!slip) throw notFound('Employee not found');
  res.json(slip);
});


/* ---------- Settings ---------- */
router.get('/settings', requirePerm('settings'), async (req, res) => res.json(await getSettings()));

router.put('/settings', requirePerm('settings', 'write'), async (req, res) => {
  const opt = max => z.string().trim().max(max, `Must be at most ${max} characters`).nullish().transform(v => v ?? '');
  const prefix = z.string().trim().max(10).regex(/^[A-Za-z0-9-]*$/, 'Letters, numbers and - only').nullish().transform(v => v ?? '');
  const body = z.object({
    business_name: z.string().trim().min(1, 'Enter the business name').max(120),
    address: opt(300), phone: opt(40), email: opt(254),
    gstin: opt(20).transform(v => v.toUpperCase().replace(/\s/g, ''))
      .refine(v => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v), 'Enter a valid 15-character GSTIN'),
    state: z.union([z.literal(''), z.null(), z.enum(STATE_NAMES)]).optional().transform(v => v || ''),
    currency: z.string().trim().min(1).max(5).default('₹'), bill_prefix: prefix, credit_prefix: prefix,
    opening_cash: z.union([z.literal(''), z.coerce.number().min(-1e11).max(1e11)]).nullish().transform(v => (v === '' || v == null ? '0' : String(v))),
    opening_bank: z.union([z.literal(''), z.coerce.number().min(-1e11).max(1e11)]).nullish().transform(v => (v === '' || v == null ? '0' : String(v))),
    diesel_rate: z.union([z.literal(''), z.coerce.number().min(0).max(1000)]).nullish().transform(v => (v === '' || v == null ? '0' : String(v))),
    royalty_alert_qty: z.union([z.literal(''), z.coerce.number().min(0).max(1e7)]).nullish().transform(v => (v === '' || v == null ? '0' : String(v))),
    large_expense: z.union([z.literal(''), z.coerce.number().min(0).max(1e10)]).nullish().transform(v => (v === '' || v == null ? '0' : String(v))),
    bank_name: opt(100), bank_account: opt(30), bank_ifsc: opt(15), bank_branch: opt(100), upi_id: opt(60), invoice_terms: opt(1000),
    logo: z.string().max(450_000, 'Logo is too large (max 300 KB)').nullish().transform(v => v ?? ''),
  }).parse(req.body ?? {});
  // Logo: only small PNG/JPEG/WebP images as base64 data URLs; content is checked by magic bytes, not just the label.
  if (body.logo) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.logo);
    const buf = m ? Buffer.from(m[2], 'base64') : null;
    const sig = buf && buf.subarray(0, 12).toString('hex');
    const okSig = sig && (sig.startsWith('89504e47') || sig.startsWith('ffd8ff') || (sig.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP'));
    if (!okSig || buf.length > 300 * 1024) throw badRequest('Logo must be a PNG, JPEG or WebP image up to 300 KB', { logo: 'Use a PNG, JPEG or WebP image up to 300 KB' });
  }
  const before = await getSettings();
  await db.transaction(async trx => {
    // Only fields actually sent are changed, so a partial save never wipes the logo, bank details, etc.
    const sent = req.body && typeof req.body === 'object' ? req.body : {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!Object.prototype.hasOwnProperty.call(sent, key)) continue;
      await trx('settings').insert({ key, value: body[key] ?? '' }).onConflict('key').merge(['value']);
    }
  });
  const sentKeys = Object.keys(DEFAULT_SETTINGS).filter(k => req.body && Object.prototype.hasOwnProperty.call(req.body, k));
  const pick = o => Object.fromEntries(sentKeys.map(k => [k, k === 'logo' ? (o[k] ? `[image ${o[k].length} chars]` : '') : o[k]]));
  await audit(req, 'update', 'settings', null, { from: pick(before), to: pick(body) });
  res.json(await getSettings());
});

/* ---------- Audit log ---------- */
router.get('/audit', requirePerm('audit'), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  const q = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id');
  if (typeof req.query.entity === 'string' && req.query.entity) q.where('a.entity', req.query.entity.slice(0, 40));
  if (typeof req.query.action === 'string' && req.query.action) q.where('a.action', req.query.action.slice(0, 40));
  const [{ count }] = await q.clone().count({ count: 'a.id' });
  const rows = await q.clone().select('a.*', 'u.name as user_name', 'u.email as user_email')
    .orderBy('a.id', 'desc').limit(pageSize).offset((page - 1) * pageSize);
  res.json({ rows: rows.map(r => ({ ...r, created_at: Number(r.created_at) })), total: Number(count), page, pageSize });
});

export default router;
