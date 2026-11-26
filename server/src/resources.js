import { z } from 'zod';
import { badRequest, conflict } from './lib/errors.js';
import { r2, r3, norm } from './lib/util.js';
import { stockOf, partyBalances, getSettings } from './services/business.js';
import { isoTime } from './lib/util.js';
import { syncExpense } from './services/linked.js';
import { can } from './auth/permissions.js';
import { STATE_NAMES, fyOf, taxType, splitTax, nextNumber } from './lib/gst.js';

export const UNITS = ['Ton', 'Brass', 'CFT', 'CUM', 'Trip'];
export const PAY_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Credit'];
export const EXPENSE_CATEGORIES = ['Diesel / Fuel', 'Electricity', 'Wages / Salary', 'Maintenance & Repair', 'Spare Parts',
  'Blasting / Explosives', 'Royalty & Permits', 'Transport / Freight', 'Rent / Lease', 'Office & Admin', 'Food & Welfare', 'Other'];
export const SHIFTS = ['Day', 'Night', 'General'];
export const WEIGHMENT_TYPES = ['Loaded', 'Empty', 'Re-weighment'];
export const DELIVERY_STATUSES = ['Dispatched', 'Delivered'];
export const MAINTENANCE_KINDS = ['Service', 'Repair', 'Breakdown', 'Tyres', 'Spare parts', 'Inspection', 'Other'];
export const DOWNTIME_REASONS = ['Breakdown', 'Power cut', 'No raw material', 'Maintenance', 'Jaw / liner change', 'Belt / conveyor', 'Weather', 'Labour shortage', 'Other'];
export const VEHICLE_KINDS = ['Tipper / Dumper', 'Truck', 'Tractor', 'JCB / Loader', 'Excavator', 'Crusher Unit', 'Generator', 'Other'];
export const PARTY_TYPES = ['customer', 'supplier', 'both'];

/* ---------------- Schema building blocks ---------------- */
const text = (max, label = 'This field') => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `Must be at most ${max} characters`);
const optText = max => z.string().trim().max(max, `Must be at most ${max} characters`).nullish().transform(v => (v ? v : null));
export const dateStr = z.string({ error: 'Enter a valid date' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
  .refine(v => !Number.isNaN(Date.parse(v + 'T00:00:00Z')), 'Enter a valid date');
const optDate = z.union([z.literal(''), z.null(), dateStr]).optional().transform(v => v || null);
const num = () => z.coerce.number({ error: 'Enter a number' });
const money = () => num().min(0, 'Cannot be negative').max(1e11, 'Too large');
const positive = () => num().gt(0, 'Must be more than 0').max(1e9, 'Too large');
const signed = () => num().min(-1e11).max(1e11);
const id = label => z.coerce.number({ error: `Select ${label}` }).int().positive(`Select ${label}`);
const optId = z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).optional().transform(v => (v ? Number(v) : null));
const oneOf = (values, label) => z.enum(values, { error: `Select ${label}` });
const optState = z.union([z.literal(''), z.null(), z.enum(STATE_NAMES, { error: 'Select a state from the list' })]).optional().transform(v => v || null);
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const optGstin = optText(20).transform(v => (v ? v.toUpperCase().replace(/\s/g, '') : null))
  .refine(v => !v || GSTIN_RE.test(v), 'Enter a valid 15-character GSTIN');
const optEmail = optText(254).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email');
const optNum = (max, label = 'Value') => z.union([z.literal(''), z.null(), num().min(0, 'Cannot be negative').max(max, `${label} is too large`)])
  .optional().transform(v => (v === '' || v == null ? null : v));
const optHsn = optText(10).refine(v => !v || /^\d{4,8}$/.test(v), 'HSN is 4 to 8 digits');

async function mustExist(trx, table, idValue, field, label) {
  const row = await trx(table).where({ id: idValue }).first();
  if (!row) throw badRequest(`Select a valid ${label}`, { [field]: `Select a valid ${label}` });
  return row;
}

/*
 * Generic CRUD resources. Each entry drives list / get / create / update / delete / CSV export routes.
 *  - schema:   zod validation of the request body (unknown fields are dropped)
 *  - prepare:  server-side business rules + computed fields (never trust client totals)
 *  - joins/select/search/filters/sums: list query building (all whitelisted, parameterised)
 */
export const RESOURCES = {
  materials: {
    table: 'materials', label: 'Material',
    sortable: { name: 'materials.name', rate: 'materials.rate' },
    schema: z.object({
      name: text(100, 'Name'), unit: oneOf(UNITS, 'a unit'), rate: money(), is_raw: z.boolean().default(false),
      opening: signed().default(0), reorder_level: money().default(0), hsn: optHsn,
    }),
    search: ['materials.name'],
    filters: { is_raw: 'materials.is_raw' },
    order: [['materials.is_raw', 'desc'], ['materials.name', 'asc']],
    csv: [['Name', 'name'], ['Unit', 'unit'], ['HSN', 'hsn'], ['Rate', 'rate'], ['Raw', r => (r.is_raw ? 'Yes' : 'No')], ['Opening', 'opening'], ['Alert level', 'reorder_level']],
  },

  parties: {
    table: 'parties', label: 'Party',
    sortable: { name: 'parties.name', type: 'parties.type' },
    schema: z.object({
      name: text(120, 'Name'), type: oneOf(PARTY_TYPES, 'a type'), phone: optText(30), gstin: optGstin,
      address: optText(300), state: optState, email: optEmail, opening: signed().default(0),
      credit_limit: money().default(0),
    }),
    search: ['parties.name', 'parties.phone', 'parties.address', 'parties.gstin'],
    filters: { type: 'parties.type' },
    order: [['parties.name', 'asc']],
    async decorate(rows, req) {
      if (!can(req.user.role, 'ledger')) return;
      const bal = await partyBalances(rows.map(r => r.id));
      rows.forEach(r => { r.balance = bal.get(r.id) ?? r.opening; });
    },
    csv: [['Name', 'name'], ['Type', 'type'], ['Phone', 'phone'], ['Email', 'email'], ['GSTIN', 'gstin'], ['Address', 'address'], ['State', 'state'], ['Credit limit', 'credit_limit'], ['Opening', 'opening'], ['Balance', 'balance']],
  },

  vehicles: {
    table: 'vehicles', label: 'Vehicle',
    sortable: { number: 'vehicles.number' },
    schema: z.object({
      number: text(30, 'Number').transform(v => v.toUpperCase()), kind: optText(40), ownership: oneOf(['own', 'hired'], 'ownership').default('own'),
      driver: optText(100), phone: optText(30), notes: optText(500),
      tare_weight: optNum(100000, 'Tare weight'), owner_party_id: optId, freight_rate: money().default(0),
      meter_type: oneOf(['km', 'hours'], 'a meter type').default('km'),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'vehicles.owner_party_id'),
    select: ['vehicles.*', 'parties.name as owner_name'],
    async prepare(d, trx) {
      if (d.owner_party_id) await mustExist(trx, 'parties', d.owner_party_id, 'owner_party_id', 'owner');
      if (d.ownership === 'own') { d.owner_party_id = null; d.freight_rate = 0; }
      return d;
    },
    search: ['vehicles.number', 'vehicles.driver', 'vehicles.kind'],
    filters: { ownership: 'vehicles.ownership' },
    order: [['vehicles.number', 'asc']],
    csv: [['Number', 'number'], ['Kind', 'kind'], ['Ownership', 'ownership'], ['Owner', 'owner_name'], ['Freight per trip', 'freight_rate'],
      ['Tare (kg)', 'tare_weight'], ['Driver', 'driver'], ['Phone', 'phone'], ['Notes', 'notes']],
  },

  employees: {
    table: 'employees', label: 'Employee',
    sortable: { name: 'employees.name', wage: 'employees.wage' },
    schema: z.object({
      name: text(100, 'Name'), role: optText(60), phone: optText(30), joined_on: optDate,
      wage_type: oneOf(['daily', 'monthly'], 'wage type').default('daily'), wage: money(), active: z.boolean().default(true),
      ot_rate: money().default(0),
    }),
    search: ['employees.name', 'employees.role', 'employees.phone'],
    filters: { active: 'employees.active', wage_type: 'employees.wage_type' },
    order: [['employees.active', 'desc'], ['employees.name', 'asc']],
    csv: [['Name', 'name'], ['Role', 'role'], ['Phone', 'phone'], ['Joined', 'joined_on'], ['Wage type', 'wage_type'], ['Wage', 'wage'], ['Active', r => (r.active ? 'Yes' : 'No')]],
  },

  sales: {
    table: 'sales', label: 'Sale', dated: true, createdBy: true,
    sortable: { date: 'sales.date', bill_no: 'sales.bill_no', party: 'parties.name', vehicle: 'sales.vehicle_no', material: 'materials.name', qty: 'sales.qty', rate: 'sales.rate', amount: 'sales.amount', paid: 'sales.paid' },
    schema: z.object({
      date: dateStr, bill_no: optText(40), party_id: id('a customer'), vehicle_no: optText(30).transform(v => v && v.toUpperCase()),
      material_id: id('a material'), qty: positive(), rate: money(), transport: money().default(0),
      gst_pct: num().min(0).max(28, 'GST cannot be more than 28%').default(0), paid: money().default(0),
      mode: oneOf(PAY_MODES, 'a payment mode').default('Cash'), notes: optText(500), allow_negative_stock: z.boolean().optional(),
      slip_no: optText(30), gross_weight: optNum(200000, 'Gross weight'), tare_weight: optNum(200000, 'Tare weight'),
      freight_cost: money().default(0), royalty_pass_no: optText(40),
      destination: optText(200), driver: optText(100), delivery_status: oneOf(DELIVERY_STATUSES, 'a status').default('Dispatched'),
      weighment_id: optId, allow_over_credit: z.boolean().optional(),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'sales.party_id').leftJoin('materials', 'materials.id', 'sales.material_id'),
    select: ['sales.*', 'parties.name as party_name', 'materials.name as material_name', 'materials.unit as unit'],
    search: ['sales.bill_no', 'sales.vehicle_no', 'sales.slip_no', 'sales.royalty_pass_no', 'parties.name', 'materials.name'],
    filters: { party_id: 'sales.party_id', material_id: 'sales.material_id', mode: 'sales.mode', delivery_status: 'sales.delivery_status' },
    sums: ['qty', 'amount', 'paid'],
    async prepare(d, trx, existing, req) {
      const party = await mustExist(trx, 'parties', d.party_id, 'party_id', 'customer');
      if (party.type === 'supplier') throw badRequest('This party is a supplier, not a customer', { party_id: 'Select a customer' });
      const mat = await mustExist(trx, 'materials', d.material_id, 'material_id', 'material');
      // Billing a weighbridge slip: the recorded weights, slip number and vehicle are taken from the slip, not the form.
      let weighmentId = null;
      if (d.weighment_id) {
        const w = norm(await mustExist(trx, 'weighments', d.weighment_id, 'weighment_id', 'weighbridge slip'));
        if (w.type === 'Empty') throw badRequest('An empty-vehicle weighment cannot be billed', { weighment_id: 'Choose a loaded weighment' });
        if (w.sale_id && w.sale_id !== existing?.id) throw conflict(`Slip ${w.slip_no} is already billed`, 'ALREADY_BILLED');
        Object.assign(d, { gross_weight: w.gross_weight, tare_weight: w.tare_weight, slip_no: w.slip_no, vehicle_no: w.vehicle_no });
        if (!d.driver && w.driver) d.driver = w.driver;
        weighmentId = w.id;
      }
      // Weighbridge: net = gross − tare (kg). For materials sold by the ton, the net weight IS the quantity.
      d.net_weight = null;
      if (d.gross_weight != null || d.tare_weight != null) {
        if (d.gross_weight == null || d.tare_weight == null) throw badRequest('Enter both gross and tare weight', { [d.gross_weight == null ? 'gross_weight' : 'tare_weight']: 'Required with the other weight' });
        if (d.gross_weight <= d.tare_weight) throw badRequest('Gross weight must be more than tare weight', { gross_weight: 'Must be more than tare' });
        d.net_weight = r2(d.gross_weight - d.tare_weight);
        if (mat.unit === 'Ton') d.qty = r3(d.net_weight / 1000);
      }
      const subtotal = r2(d.qty * d.rate);
      const gst_amount = r2((subtotal * d.gst_pct) / 100);
      const amount = r2(subtotal + gst_amount + d.transport);
      const settings = await getSettings(trx);
      const tax_type = taxType(settings.state, party.state, party.gstin);
      const tax = splitTax(gst_amount, tax_type);
      if (d.paid > amount) throw badRequest('Amount received is more than the bill total', { paid: 'More than the total' });
      if (d.paid > 0 && d.mode === 'Credit') throw badRequest('Choose how the money was received', { mode: 'Select Cash, UPI, Bank Transfer or Cheque' });
      // Credit limit: the customer's balance after this bill must stay within their limit (0 = no limit).
      const limit = Number(party.credit_limit) || 0;
      if (limit > 0 && !(d.allow_over_credit && can(req.user.role, 'ledger'))) {
        const current = (await partyBalances([party.id], trx)).get(party.id) || 0;
        const before = existing && existing.party_id === party.id ? Number(existing.amount) - Number(existing.paid) : 0;
        const after = r2(current - before + amount - d.paid);
        // Only bills that add to what the customer owes are stopped (a fully paid bill is always fine).
        if (after > limit + 0.005 && after > current + 0.005) {
          const finance = can(req.user.role, 'ledger');
          throw conflict(finance
            ? `This bill takes ${party.name} to ${after.toLocaleString('en-IN')} outstanding, over their credit limit of ${limit.toLocaleString('en-IN')}.`
            : `This bill would take ${party.name} over their credit limit. Collect payment or ask a manager.`,
          'CREDIT_LIMIT', { canOverride: finance });
        }
      }
      if (!d.allow_negative_stock) {
        const st = await stockOf(d.material_id, trx);
        const available = r2(st.current + (existing && existing.material_id === d.material_id ? existing.qty : 0));
        if (d.qty > available + 1e-9) {
          throw conflict(`Only ${available} ${mat.unit} of ${mat.name} is in stock.`, 'LOW_STOCK', { available });
        }
      }
      const { allow_negative_stock, allow_over_credit, weighment_id, ...row } = d;
      // Only change the slip link when the request is about a slip (editing a bill without one keeps its link).
      row._weighment = Object.prototype.hasOwnProperty.call(req?.body || {}, 'weighment_id') ? weighmentId : undefined;
      const numbering = {};
      if (existing) {
        if (!row.bill_no) row.bill_no = existing.bill_no;
        if (row.bill_no === existing.bill_no) Object.assign(numbering, { fy: existing.fy || fyOf(existing.date), seq: existing.seq });
        else Object.assign(numbering, { fy: fyOf(d.date), seq: null });
      } else if (!row.bill_no) {
        const fy = fyOf(d.date);
        const next = await nextNumber(trx, 'sales', settings.bill_prefix, fy);
        Object.assign(numbering, { fy, seq: next.seq });
        row.bill_no = next.number;
      } else {
        Object.assign(numbering, { fy: fyOf(d.date), seq: null });
      }
      return { ...row, ...numbering, subtotal, gst_amount, amount, tax_type, ...tax };
    },
    /** Link the billed weighbridge slip to this sale (one slip ↔ one bill). */
    async afterSave(saleId, row, trx) {
      if (row._weighment === undefined) return;
      await trx('weighments').where({ sale_id: saleId }).whereNot({ id: row._weighment || 0 }).update({ sale_id: null });
      if (row._weighment) await trx('weighments').where({ id: row._weighment }).update({ sale_id: saleId });
    },
    csv: [['Date', 'date'], ['Bill No', 'bill_no'], ['Customer', 'party_name'], ['Vehicle', 'vehicle_no'], ['Driver', 'driver'], ['Destination', 'destination'],
      ['Delivery', 'delivery_status'], ['Slip No', 'slip_no'],
      ['Gross (kg)', 'gross_weight'], ['Tare (kg)', 'tare_weight'], ['Net (kg)', 'net_weight'], ['Royalty pass', 'royalty_pass_no'], ['Freight cost', 'freight_cost'],
      ['Material', 'material_name'],
      ['Unit', 'unit'], ['Qty', 'qty'], ['Rate', 'rate'], ['Taxable value', 'subtotal'], ['Transport', 'transport'], ['GST %', 'gst_pct'],
      ['CGST', 'cgst'], ['SGST', 'sgst'], ['IGST', 'igst'], ['GST', 'gst_amount'],
      ['Amount', 'amount'], ['Received', 'paid'], ['Mode', 'mode'], ['Notes', 'notes']],
  },

  weighments: {
    table: 'weighments', label: 'Weighbridge slip', dated: true, createdBy: true,
    sortable: { date: 'weighments.date', slip_no: 'weighments.slip_no', vehicle: 'weighments.vehicle_no', net: 'weighments.net_weight' },
    schema: z.object({
      date: dateStr, time: z.union([z.literal(''), z.null(), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')]).optional().transform(v => v || null),
      type: oneOf(WEIGHMENT_TYPES, 'a weighment type').default('Loaded'),
      vehicle_no: text(30, 'Vehicle no.').transform(v => v.toUpperCase()), party_id: optId, material_id: optId,
      gross_weight: optNum(200000, 'Gross weight'), tare_weight: optNum(200000, 'Tare weight'), rate: money().default(0),
      driver: optText(100), notes: optText(300),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'weighments.party_id').leftJoin('materials', 'materials.id', 'weighments.material_id')
      .leftJoin('sales', 'sales.id', 'weighments.sale_id'),
    select: ['weighments.*', 'parties.name as party_name', 'materials.name as material_name', 'materials.unit as unit', 'sales.bill_no as bill_no'],
    search: ['weighments.slip_no', 'weighments.vehicle_no', 'weighments.driver', 'parties.name', 'materials.name', 'sales.bill_no'],
    filters: { type: 'weighments.type', party_id: 'weighments.party_id' },
    sums: ['net_weight'],
    async prepare(d, trx, existing) {
      if (existing?.sale_id) throw badRequest('This slip is already billed. Edit the bill instead, or delete the bill first.');
      if (d.party_id) {
        const p = await mustExist(trx, 'parties', d.party_id, 'party_id', 'customer');
        if (p.type === 'supplier') throw badRequest('This party is a supplier, not a customer', { party_id: 'Select a customer' });
      }
      if (d.material_id) await mustExist(trx, 'materials', d.material_id, 'material_id', 'material');
      let net = null;
      if (d.type === 'Empty') {
        // Empty vehicle: only its own (tare) weight is recorded; it also updates the vehicle's saved tare.
        if (d.tare_weight == null) throw badRequest('Enter the empty vehicle weight', { tare_weight: 'Required' });
        d.gross_weight = null;
      } else {
        if (d.gross_weight == null || d.tare_weight == null) throw badRequest('Enter both gross and tare weight', { [d.gross_weight == null ? 'gross_weight' : 'tare_weight']: 'Required' });
        if (d.gross_weight <= d.tare_weight) throw badRequest('Gross weight must be more than tare weight', { gross_weight: 'Must be more than tare' });
        net = r2(d.gross_weight - d.tare_weight);
      }
      const row = { ...d, net_weight: net, time: d.time || existing?.time || isoTime() };
      if (existing) return { ...row, slip_no: existing.slip_no, fy: existing.fy, seq: existing.seq };
      const fy = fyOf(d.date);
      const next = await nextNumber(trx, 'weighments', 'WB', fy);
      return { ...row, fy, seq: next.seq, slip_no: next.number };
    },
    async afterSave(id, row, trx) {
      if (row.type === 'Empty') await trx('vehicles').where({ number: row.vehicle_no }).update({ tare_weight: row.tare_weight });
    },
    async beforeDelete(existing) {
      if (existing.sale_id) throw badRequest('This slip is already billed. Delete the bill first.');
    },
    decorate(rows) {
      rows.forEach(r => { r.amount = r.net_weight && r.unit === 'Ton' && r.rate ? r2((r.net_weight / 1000) * r.rate) : null; });
    },
    csv: [['Date', 'date'], ['Time', 'time'], ['Slip no.', 'slip_no'], ['Type', 'type'], ['Vehicle', 'vehicle_no'], ['Customer', 'party_name'], ['Material', 'material_name'],
      ['Gross (kg)', 'gross_weight'], ['Tare (kg)', 'tare_weight'], ['Net (kg)', 'net_weight'], ['Rate', 'rate'], ['Amount', 'amount'], ['Driver', 'driver'],
      ['Billed on', 'bill_no'], ['Notes', 'notes']],
  },

  credit_notes: {
    table: 'credit_notes', label: 'Credit note', dated: true, createdBy: true,
    sortable: { date: 'credit_notes.date', amount: 'credit_notes.amount', party: 'parties.name' },
    schema: z.object({
      date: dateStr, sale_id: id('the original bill'), qty: positive(), rate: z.union([z.literal(''), z.null(), money()]).optional().transform(v => (v === '' || v == null ? null : v)),
      restock: z.boolean().default(true), reason: optText(300),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'credit_notes.party_id').leftJoin('materials', 'materials.id', 'credit_notes.material_id')
      .leftJoin('sales', 'sales.id', 'credit_notes.sale_id'),
    select: ['credit_notes.*', 'parties.name as party_name', 'materials.name as material_name', 'materials.unit as unit', 'sales.bill_no as bill_no'],
    search: ['credit_notes.note_no', 'credit_notes.reason', 'parties.name', 'sales.bill_no'],
    filters: { party_id: 'credit_notes.party_id' },
    sums: ['qty', 'amount'],
    /** Party, material, GST rate and tax type always come from the original bill. */
    async prepare(d, trx, existing) {
      const sale = norm(await mustExist(trx, 'sales', d.sale_id, 'sale_id', 'bill'));
      if (existing && existing.sale_id !== sale.id) throw badRequest('The original bill of a credit note cannot be changed', { sale_id: 'Create a new credit note instead' });
      if (d.date < sale.date) throw badRequest('A credit note cannot be dated before its bill', { date: `Bill is dated ${sale.date}` });
      const pq = trx('credit_notes').where({ sale_id: sale.id }).sum({ q: 'qty' });
      if (existing) pq.whereNot({ id: existing.id });
      const prior = await pq.first();
      const remaining = r2(sale.qty - Number(prior?.q || 0));
      if (d.qty > remaining + 1e-9) throw badRequest(`Only ${remaining} can still be returned on this bill`, { qty: `At most ${remaining}` });
      const rate = d.rate ?? sale.rate;
      if (rate > sale.rate) throw badRequest('Return rate cannot be more than the billed rate', { rate: `At most ${sale.rate}` });
      const subtotal = r2(d.qty * rate);
      const gst_amount = r2((subtotal * sale.gst_pct) / 100);
      const tax_type = sale.tax_type || 'intra';
      const row = {
        date: d.date, sale_id: sale.id, party_id: sale.party_id, material_id: sale.material_id, qty: d.qty, rate, gst_pct: sale.gst_pct,
        tax_type, subtotal, gst_amount, ...splitTax(gst_amount, tax_type), amount: r2(subtotal + gst_amount), restock: d.restock, reason: d.reason,
      };
      if (existing) return { ...row, note_no: existing.note_no, fy: existing.fy, seq: existing.seq };
      const fy = fyOf(d.date);
      const { credit_prefix } = await getSettings(trx);
      const next = await nextNumber(trx, 'credit_notes', credit_prefix, fy);
      return { ...row, fy, seq: next.seq, note_no: next.number };
    },
    csv: [['Date', 'date'], ['Credit note', 'note_no'], ['Against bill', 'bill_no'], ['Customer', 'party_name'], ['Material', 'material_name'],
      ['Unit', 'unit'], ['Qty', 'qty'], ['Rate', 'rate'], ['Taxable value', 'subtotal'], ['CGST', 'cgst'], ['SGST', 'sgst'], ['IGST', 'igst'],
      ['Amount', 'amount'], ['Back to stock', r => (r.restock ? 'Yes' : 'No')], ['Reason', 'reason']],
  },

  purchases: {
    table: 'purchases', label: 'Purchase', dated: true, createdBy: true,
    sortable: { date: 'purchases.date', party: 'parties.name', material: 'materials.name', qty: 'purchases.qty', rate: 'purchases.rate', amount: 'purchases.amount', paid: 'purchases.paid' },
    schema: z.object({
      date: dateStr, party_id: id('a supplier'), material_id: id('a material'), vehicle_no: optText(30).transform(v => v && v.toUpperCase()),
      qty: positive(), rate: money(), transport: money().default(0), paid: money().default(0),
      mode: oneOf(PAY_MODES, 'a payment mode').default('Cash'), notes: optText(500),
      bill_no: optText(40), gst_pct: num().min(0).max(28, 'GST cannot be more than 28%').default(0),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'purchases.party_id').leftJoin('materials', 'materials.id', 'purchases.material_id'),
    select: ['purchases.*', 'parties.name as party_name', 'materials.name as material_name', 'materials.unit as unit'],
    search: ['purchases.vehicle_no', 'purchases.bill_no', 'parties.name', 'materials.name'],
    filters: { party_id: 'purchases.party_id', material_id: 'purchases.material_id' },
    sums: ['qty', 'amount', 'paid'],
    async prepare(d, trx) {
      const party = await mustExist(trx, 'parties', d.party_id, 'party_id', 'supplier');
      if (party.type === 'customer') throw badRequest('This party is a customer, not a supplier', { party_id: 'Select a supplier' });
      await mustExist(trx, 'materials', d.material_id, 'material_id', 'material');
      // Input GST is on the goods value; CGST+SGST or IGST from the supplier's state, as for sales.
      const subtotal = r2(d.qty * d.rate);
      const gst_amount = r2((subtotal * d.gst_pct) / 100);
      const settings = await getSettings(trx);
      const tax_type = taxType(settings.state, party.state, party.gstin);
      const amount = r2(subtotal + gst_amount + d.transport);
      if (d.paid > amount) throw badRequest('Amount paid is more than the total', { paid: 'More than the total' });
      if (d.paid > 0 && d.mode === 'Credit') throw badRequest('Choose how the money was paid', { mode: 'Select Cash, UPI, Bank Transfer or Cheque' });
      return { ...d, subtotal, gst_amount, tax_type, ...splitTax(gst_amount, tax_type), amount };
    },
    csv: [['Date', 'date'], ['Supplier bill', 'bill_no'], ['Supplier', 'party_name'], ['Material', 'material_name'], ['Unit', 'unit'], ['Vehicle', 'vehicle_no'],
      ['Qty', 'qty'], ['Rate', 'rate'], ['Taxable value', 'subtotal'], ['GST %', 'gst_pct'], ['CGST', 'cgst'], ['SGST', 'sgst'], ['IGST', 'igst'],
      ['Transport', 'transport'], ['Amount', 'amount'], ['Paid', 'paid'], ['Mode', 'mode'], ['Notes', 'notes']],
  },

  production: {
    table: 'production', label: 'Production entry', dated: true, createdBy: true,
    sortable: { date: 'production.date', material: 'materials.name', qty: 'production.qty', run_hours: 'production.run_hours', downtime: 'production.downtime_hours' },
    schema: z.object({
      date: dateStr, shift: oneOf(SHIFTS, 'a shift').default('Day'), material_id: id('an output material'), qty: positive(),
      raw_material_id: optId, raw_qty: money().default(0), run_hours: num().min(0).max(24, 'Cannot exceed 24 hours').default(0), notes: optText(500),
      downtime_hours: num().min(0).max(24, 'Cannot exceed 24 hours').default(0),
      downtime_reason: z.union([z.literal(''), z.null(), z.enum(DOWNTIME_REASONS, { error: 'Select a reason' })]).optional().transform(v => v || null),
      operator_id: optId,
    }),
    joins: q => q.leftJoin('materials', 'materials.id', 'production.material_id').leftJoin('materials as raw', 'raw.id', 'production.raw_material_id')
      .leftJoin('employees as op', 'op.id', 'production.operator_id'),
    select: ['production.*', 'materials.name as material_name', 'materials.unit as unit', 'raw.name as raw_name', 'raw.unit as raw_unit', 'op.name as operator_name'],
    search: ['materials.name', 'production.notes'],
    filters: { material_id: 'production.material_id', shift: 'production.shift' },
    sums: ['qty', 'raw_qty', 'run_hours', 'downtime_hours'],
    async prepare(d, trx) {
      const out = await mustExist(trx, 'materials', d.material_id, 'material_id', 'material');
      if (out.is_raw === true || out.is_raw === 1) throw badRequest('Output must be a finished product', { material_id: 'Select a product' });
      if (d.raw_qty > 0 && !d.raw_material_id) throw badRequest('Select the raw material used', { raw_material_id: 'Select the raw material' });
      if (d.raw_material_id) await mustExist(trx, 'materials', d.raw_material_id, 'raw_material_id', 'raw material');
      if (d.operator_id) await mustExist(trx, 'employees', d.operator_id, 'operator_id', 'operator');
      if (d.run_hours + d.downtime_hours > 24) throw badRequest('Running hours plus downtime cannot exceed 24', { downtime_hours: 'Too many hours in one day' });
      if (d.downtime_hours > 0 && !d.downtime_reason) throw badRequest('Select why the crusher stopped', { downtime_reason: 'Select a reason' });
      if (!d.downtime_hours) d.downtime_reason = null;
      return d;
    },
    csv: [['Date', 'date'], ['Shift', 'shift'], ['Material', 'material_name'], ['Output', 'qty'], ['Unit', 'unit'],
      ['Raw material', 'raw_name'], ['Raw used', 'raw_qty'], ['Hours', 'run_hours'], ['Downtime hrs', 'downtime_hours'], ['Downtime reason', 'downtime_reason'], ['Operator', 'operator_name'], ['Notes', 'notes']],
  },

  expenses: {
    table: 'expenses', label: 'Expense', dated: true, createdBy: true,
    sortable: { date: 'expenses.date', category: 'expenses.category', amount: 'expenses.amount' },
    schema: z.object({
      date: dateStr, category: oneOf(EXPENSE_CATEGORIES, 'a category'), amount: positive(), mode: oneOf(PAY_MODES, 'a payment mode').default('Cash'),
      vehicle_no: optText(30).transform(v => v && v.toUpperCase()), employee_id: optId, description: optText(300),
      paid_to: optText(120),
    }),
    joins: q => q.leftJoin('employees', 'employees.id', 'expenses.employee_id'),
    select: ['expenses.*', 'employees.name as employee_name'],
    search: ['expenses.description', 'expenses.category', 'expenses.vehicle_no', 'expenses.paid_to', 'employees.name'],
    filters: { category: 'expenses.category', employee_id: 'expenses.employee_id', mode: 'expenses.mode' },
    sums: ['amount'],
    async prepare(d, trx, existing) {
      if (existing?.source) throw badRequest(`This expense comes from the ${existing.source} log. Edit it there.`);
      if (d.employee_id) await mustExist(trx, 'employees', d.employee_id, 'employee_id', 'employee');
      return d;
    },
    async beforeDelete(existing) {
      if (existing.source) throw badRequest(`This expense comes from the ${existing.source} log. Delete it there.`);
    },
    csv: [['Date', 'date'], ['Category', 'category'], ['Paid to', 'paid_to'], ['Description', 'description'], ['Vehicle', 'vehicle_no'], ['Employee', 'employee_name'], ['Mode', 'mode'], ['Amount', 'amount']],
  },

  diesel_logs: {
    table: 'diesel_logs', label: 'Diesel entry', dated: true, createdBy: true,
    sortable: { date: 'diesel_logs.date', vehicle: 'vehicles.number', litres: 'diesel_logs.litres' },
    schema: z.object({
      date: dateStr, vehicle_id: id('a vehicle or machine'), litres: positive().max(5000, 'Too many litres for one fill'),
      rate: optNum(1000, 'Rate'), meter: optNum(1e8, 'Meter reading'), mode: oneOf(PAY_MODES, 'a payment mode').default('Cash'), notes: optText(300),
    }),
    joins: q => q.leftJoin('vehicles', 'vehicles.id', 'diesel_logs.vehicle_id'),
    select: ['diesel_logs.*', 'vehicles.number as vehicle_no', 'vehicles.kind as vehicle_kind', 'vehicles.meter_type as meter_type'],
    search: ['vehicles.number', 'diesel_logs.notes'],
    filters: { vehicle_id: 'diesel_logs.vehicle_id' },
    sums: ['litres', 'amount'],
    /** Operators log litres and meter readings; the rate and cost are set and seen by finance roles only. */
    async prepare(d, trx, existing, req) {
      const veh = await mustExist(trx, 'vehicles', d.vehicle_id, 'vehicle_id', 'vehicle');
      const finance = can(req.user.role, 'finance');
      let rate = finance ? d.rate : null;
      if (rate == null) rate = existing ? Number(existing.rate) : null;
      if (rate == null) {
        const last = await trx('diesel_logs').where('rate', '>', 0).orderBy([{ column: 'date', order: 'desc' }, { column: 'id', order: 'desc' }]).first('rate');
        rate = last ? Number(last.rate) : Number((await getSettings(trx)).diesel_rate) || 0;
      }
      if (d.meter != null) {
        const q = trx('diesel_logs').where({ vehicle_id: d.vehicle_id }).whereNotNull('meter').where('date', '<=', d.date);
        if (existing) q.whereNot({ id: existing.id });
        const prev = await q.orderBy([{ column: 'date', order: 'desc' }, { column: 'meter', order: 'desc' }]).first('meter', 'date');
        if (prev && d.meter < Number(prev.meter)) {
          throw badRequest(`Meter reading is lower than the last one (${Number(prev.meter)} on ${prev.date})`, { meter: `At least ${Number(prev.meter)}` });
        }
      }
      const mode = finance ? d.mode : existing?.mode || 'Cash';
      return { date: d.date, vehicle_id: d.vehicle_id, litres: d.litres, rate, amount: r2(d.litres * rate), meter: d.meter, mode, notes: d.notes, _veh: veh.number };
    },
    async afterSave(rowId, row, trx, req, existing) {
      const expense_id = await syncExpense(trx, existing?.expense_id, {
        date: row.date, category: 'Diesel / Fuel', amount: row.amount, mode: row.mode, vehicle_no: row._veh,
        description: `Diesel ${row.litres} L · ${row._veh}`, source: 'diesel', created_by: req.user.id,
      });
      await trx('diesel_logs').where({ id: rowId }).update({ expense_id });
    },
    async afterDelete(existing, trx) {
      if (existing.expense_id) await trx('expenses').where({ id: existing.expense_id }).del();
    },
    decorate(rows, req, totals) {
      if (can(req.user.role, 'finance')) return;
      rows.forEach(r => { delete r.rate; delete r.amount; delete r.mode; });
      if (totals) delete totals.amount;
    },
    csv: [['Date', 'date'], ['Vehicle', 'vehicle_no'], ['Litres', 'litres'], ['Rate', 'rate'], ['Amount', 'amount'], ['Meter', 'meter'],
      ['Meter type', 'meter_type'], ['Mode', 'mode'], ['Notes', 'notes']],
  },

  maintenance: {
    table: 'maintenance', label: 'Maintenance entry', dated: true, createdBy: true,
    sortable: { date: 'maintenance.date', vehicle: 'vehicles.number', downtime: 'maintenance.downtime_hours' },
    schema: z.object({
      date: dateStr, vehicle_id: id('a vehicle or machine'), kind: oneOf(MAINTENANCE_KINDS, 'a type'), description: text(300, 'Description'),
      parts_cost: money().default(0), labour_cost: money().default(0), meter: optNum(1e8, 'Meter reading'),
      downtime_hours: num().min(0).max(2000, 'Too many hours').default(0), next_due_date: optDate, next_due_meter: optNum(1e8, 'Next due reading'),
      mode: oneOf(PAY_MODES, 'a payment mode').default('Cash'),
    }),
    joins: q => q.leftJoin('vehicles', 'vehicles.id', 'maintenance.vehicle_id'),
    select: ['maintenance.*', 'vehicles.number as vehicle_no', 'vehicles.meter_type as meter_type'],
    search: ['vehicles.number', 'maintenance.description', 'maintenance.kind'],
    filters: { vehicle_id: 'maintenance.vehicle_id', kind: 'maintenance.kind' },
    sums: ['amount', 'downtime_hours'],
    async prepare(d, trx, existing, req) {
      const veh = await mustExist(trx, 'vehicles', d.vehicle_id, 'vehicle_id', 'vehicle');
      if (d.next_due_date && d.next_due_date < d.date) throw badRequest('Next service date must be after this entry', { next_due_date: 'Must be after the date' });
      if (d.next_due_meter != null && d.meter != null && d.next_due_meter <= d.meter) throw badRequest('Next service reading must be above the current reading', { next_due_meter: 'Must be above the current reading' });
      const finance = can(req.user.role, 'finance');
      const costs = finance
        ? { parts_cost: d.parts_cost, labour_cost: d.labour_cost, mode: d.mode }
        : { parts_cost: existing ? Number(existing.parts_cost) : 0, labour_cost: existing ? Number(existing.labour_cost) : 0, mode: existing?.mode || 'Cash' };
      return { ...d, ...costs, amount: r2(costs.parts_cost + costs.labour_cost), _veh: veh.number };
    },
    async afterSave(rowId, row, trx, req, existing) {
      const expense_id = await syncExpense(trx, existing?.expense_id, {
        date: row.date, category: 'Maintenance & Repair', amount: row.amount, mode: row.mode, vehicle_no: row._veh,
        description: `${row.kind}: ${row.description}`.slice(0, 300), source: 'maintenance', created_by: req.user.id,
      });
      await trx('maintenance').where({ id: rowId }).update({ expense_id });
    },
    async afterDelete(existing, trx) {
      if (existing.expense_id) await trx('expenses').where({ id: existing.expense_id }).del();
    },
    decorate(rows, req, totals) {
      if (can(req.user.role, 'finance')) return;
      rows.forEach(r => { delete r.parts_cost; delete r.labour_cost; delete r.amount; delete r.mode; });
      if (totals) delete totals.amount;
    },
    csv: [['Date', 'date'], ['Vehicle', 'vehicle_no'], ['Type', 'kind'], ['Description', 'description'], ['Parts', 'parts_cost'], ['Labour', 'labour_cost'],
      ['Total', 'amount'], ['Meter', 'meter'], ['Downtime hrs', 'downtime_hours'], ['Next due date', 'next_due_date'], ['Next due reading', 'next_due_meter']],
  },

  payroll_adjustments: {
    table: 'payroll_adjustments', label: 'Adjustment', createdBy: true,
    schema: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'), employee_id: id('an employee'),
      kind: oneOf(['bonus', 'deduction'], 'bonus or deduction'), amount: positive(), note: optText(200),
    }),
    joins: q => q.leftJoin('employees', 'employees.id', 'payroll_adjustments.employee_id'),
    select: ['payroll_adjustments.*', 'employees.name as employee_name'],
    search: ['employees.name', 'payroll_adjustments.note'],
    filters: { month: 'payroll_adjustments.month', employee_id: 'payroll_adjustments.employee_id', kind: 'payroll_adjustments.kind' },
    order: [['payroll_adjustments.month', 'desc'], ['payroll_adjustments.id', 'desc']],
    sums: ['amount'],
    async prepare(d, trx) {
      await mustExist(trx, 'employees', d.employee_id, 'employee_id', 'employee');
      return d;
    },
    csv: [['Month', 'month'], ['Employee', 'employee_name'], ['Type', 'kind'], ['Amount', 'amount'], ['Note', 'note']],
  },

  royalty_permits: {
    table: 'royalty_permits', label: 'Royalty permit', dated: true, createdBy: true,
    schema: z.object({
      date: dateStr, permit_no: text(40, 'Permit no.').transform(v => v.toUpperCase()), qty: positive(), amount: money().default(0),
      valid_until: optDate, notes: optText(300), quarry: optText(120), mineral: optText(60), payment_ref: optText(60),
    }),
    search: ['royalty_permits.permit_no', 'royalty_permits.quarry', 'royalty_permits.payment_ref', 'royalty_permits.notes'],
    sums: ['qty', 'amount'],
    async prepare(d) {
      if (d.valid_until && d.valid_until < d.date) throw badRequest('Validity cannot end before the permit date', { valid_until: 'Must be on or after the date' });
      return d;
    },
    csv: [['Date', 'date'], ['Permit no.', 'permit_no'], ['Quarry / source', 'quarry'], ['Mineral', 'mineral'], ['Tons', 'qty'], ['Amount', 'amount'],
      ['Payment ref.', 'payment_ref'], ['Valid until', 'valid_until'], ['Notes', 'notes']],
  },

  payments: {
    table: 'payments', label: 'Payment', dated: true, createdBy: true,
    sortable: { date: 'payments.date', party: 'parties.name', amount: 'payments.amount' },
    schema: z.object({
      date: dateStr, direction: oneOf(['in', 'out'], 'a type'), party_id: id('a party'), amount: positive(),
      mode: oneOf(PAY_MODES.filter(m => m !== 'Credit'), 'a mode').default('Cash'), reference: optText(60), notes: optText(500),
    }),
    joins: q => q.leftJoin('parties', 'parties.id', 'payments.party_id'),
    select: ['payments.*', 'parties.name as party_name'],
    search: ['parties.name', 'payments.reference', 'payments.notes'],
    filters: { direction: 'payments.direction', party_id: 'payments.party_id', mode: 'payments.mode' },
    sums: ['amount'],
    async prepare(d, trx) {
      await mustExist(trx, 'parties', d.party_id, 'party_id', 'party');
      return d;
    },
    csv: [['Date', 'date'], ['Type', r => (r.direction === 'in' ? 'Received' : 'Paid')], ['Party', 'party_name'], ['Mode', 'mode'], ['Reference', 'reference'], ['Amount', 'amount'], ['Notes', 'notes']],
  },
};
