'use client';
import { Badge } from './components/ui.jsx';
import { fmtDate, fmtMoney, fmtNum, today, r2 } from './lib/format.js';

/* Option helpers (value, label) */
const opts = arr => arr.map(v => [v, v]);
const customers = L => L.parties.filter(p => p.type !== 'supplier').map(p => [p.id, p.name]);
const suppliers = L => L.parties.filter(p => p.type !== 'customer').map(p => [p.id, p.name]);
const allParties = L => L.parties.map(p => [p.id, p.name]);
const products = L => L.materials.filter(m => !m.is_raw).map(m => [m.id, `${m.name} (${m.unit})`]);
const rawMats = L => L.materials.filter(m => m.is_raw).map(m => [m.id, `${m.name} (${m.unit})`]);
const allMats = L => L.materials.map(m => [m.id, `${m.name} (${m.unit})`]);
const vehicleList = L => L.vehicles.map(v => v.number);
const vehicleOpts = L => L.vehicles.map(v => [v.id, `${v.number}${v.kind ? ` · ${v.kind}` : ''}`]);
const meterLabel = (L, vid) => (L.vehicles.find(v => String(v.id) === String(vid))?.meter_type === 'hours' ? 'Hour meter reading' : 'Odometer (km)');
const mat = (L, id) => L.materials.find(m => String(m.id) === String(id));
const vehicleBy = (L, no) => L.vehicles.find(v => v.number === String(no || '').trim().toUpperCase());
const num = v => (v === '' || v == null ? null : Number(v));
/** Weighbridge preview: net kg = gross − tare; for materials sold by the ton the net weight becomes the quantity. */
function weighbridge(next, L) {
  const g = num(next.gross_weight), t = num(next.tare_weight);
  if (g == null || t == null || !(g > t)) return {};
  return mat(L, next.material_id)?.unit === 'Ton' ? { qty: Math.round((g - t)) / 1000 } : {};
}
function saleChange(key, v, L) {
  const out = {};
  if (key === 'material_id' && mat(L, v.material_id)) out.rate = mat(L, v.material_id).rate;
  if (key === 'vehicle_no') {
    const veh = vehicleBy(L, v.vehicle_no);
    if (veh?.tare_weight) out.tare_weight = veh.tare_weight;
    if (veh?.ownership === 'hired' && veh.freight_rate && !Number(v.freight_cost)) out.freight_cost = veh.freight_rate;
  }
  if (['gross_weight', 'tare_weight', 'material_id', 'vehicle_no'].includes(key)) Object.assign(out, weighbridge({ ...v, ...out }, L));
  return out;
}
const payStatus = r => (r.paid >= r.amount - 0.005 ? <Badge tone="green">Paid</Badge> : r.paid > 0 ? <Badge tone="amber">Partial</Badge> : <Badge tone="red">Due</Badge>);
const balanceBadge = b => (b == null ? '—' : b > 0.009 ? <Badge tone="amber">To receive {fmtMoney(b)}</Badge>
  : b < -0.009 ? <Badge tone="red">To pay {fmtMoney(-b)}</Badge> : <Badge tone="green">Settled</Badge>);
const PARTY_TYPES = [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Customer & supplier']];

export { balanceBadge };

/**
 * Client-side description of each data module: table columns, form fields, filters.
 * Validation and calculations are enforced on the server; these only drive the UI.
 */
export const RESOURCES = {
  sales: {
    title: 'Sales & Dispatch', singular: 'sale', plural: 'sales', dated: true,
    description: 'Bills and challans for material dispatched to customers.',
    searchPlaceholder: 'Bill no., customer, vehicle…',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Bill no.', sort: 'bill_no', render: r => <span className="mono">{r.bill_no}</span> },
      { label: 'Customer', sort: 'party', key: 'party_name' },
      { label: 'Vehicle', sort: 'vehicle', render: r => <span className="mono">{r.vehicle_no}</span> },
      { label: 'Material', sort: 'material', key: 'material_name' },
      { label: 'Quantity', sort: 'qty', align: 'right', render: r => `${fmtNum(r.qty, 3)} ${r.unit}`, total: t => fmtNum(t.qty) },
      { label: 'Rate', sort: 'rate', align: 'right', render: r => fmtMoney(r.rate) },
      { label: 'Amount', sort: 'amount', align: 'right', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Received', sort: 'paid', align: 'right', render: r => fmtMoney(r.paid), total: t => fmtMoney(t.paid) },
      { label: 'Status', render: payStatus },
      { label: 'Delivery', render: r => (r.delivery_status === 'Delivered' ? <Badge tone="green">Delivered</Badge> : <Badge tone="blue">On the way</Badge>) },
    ],
    filters: L => [
      { key: 'party_id', label: 'Customer', options: customers(L) },
      { key: 'material_id', label: 'Material', options: products(L) },
      { key: 'delivery_status', label: 'Delivery', options: [['Dispatched', 'On the way'], ['Delivered', 'Delivered']] },
    ],
    defaults: () => ({ date: today(), mode: 'Cash', gst_pct: 0, transport: 0, paid: 0, delivery_status: 'Dispatched' }),
    fields: (L, v) => [
      ...(v?.weighment_id ? [{ key: 'weighment_id', label: 'From weighbridge slip', type: 'readonly', full: true, section: 'Weighbridge slip',
        display: x => `${x.slip_no || ''} · net ${fmtNum((Number(x.gross_weight) || 0) - (Number(x.tare_weight) || 0), 0)} kg (weights are taken from the slip)` }] : []),
      { key: 'date', label: 'Date', type: 'date', required: true, section: 'Dispatch' },
      { key: 'bill_no', label: 'Bill / challan no.', max: 40, hint: 'Leave blank to number automatically' },
      { key: 'party_id', label: 'Customer', type: 'select', required: true, options: customers },
      { key: 'vehicle_no', label: 'Vehicle no.', max: 30, list: vehicleList },
      { key: 'material_id', label: 'Material', type: 'select', required: true, options: products },
      { key: 'slip_no', label: 'Weighbridge slip no.', max: 30, section: 'Weighbridge' },
      { key: 'gross_weight', label: 'Gross weight (kg)', type: 'number' },
      { key: 'tare_weight', label: 'Tare weight (kg)', type: 'number', hint: 'Filled from the vehicle if saved' },
      { key: 'qty', label: 'Quantity', type: 'number', required: true, hint: 'Sold by the ton? Filled from the net weight', section: 'Pricing' },
      { key: 'rate', label: 'Rate per unit', type: 'number', required: true },
      { key: 'transport', label: 'Transport charged to customer', type: 'number' },
      { key: 'freight_cost', label: 'Freight payable to vehicle', type: 'number', hint: 'For hired vehicles; added to the owner’s balance' },
      { key: 'gst_pct', label: 'GST %', type: 'number' },
      { key: 'royalty_pass_no', label: 'Royalty / e-Rawanna pass no.', max: 40, section: 'Payment & compliance' },
      { key: 'driver', label: 'Driver', max: 100 },
      { key: 'destination', label: 'Delivery site / destination', max: 200 },
      { key: 'delivery_status', label: 'Delivery', type: 'select', required: true, options: [['Dispatched', 'On the way'], ['Delivered', 'Delivered']] },
      { key: 'paid', label: 'Amount received now', type: 'number' },
      { key: 'mode', label: 'Payment mode', type: 'select', required: true, options: opts(L.enums.payModes) },
      { key: 'notes', label: 'Notes', max: 500, full: true },
    ],
    onChange: saleChange,
    summary: (v, L) => {
      const g = num(v.gross_weight), t = num(v.tare_weight);
      const net = g != null && t != null && g > t ? <> · Net {fmtNum(g - t, 1)} kg</> : null;
      const sub = (Number(v.qty) || 0) * (Number(v.rate) || 0);
      const total = r2(sub + (sub * (Number(v.gst_pct) || 0)) / 100 + (Number(v.transport) || 0));
      const unit = mat(L, v.material_id)?.unit;
      return <>Total <b>{fmtMoney(total)}</b>{unit && v.qty ? <> · {fmtNum(v.qty, 3)} {unit}</> : null}{net}</>;
    },
    rowActions: [
      { label: 'Tax invoice', icon: 'printer', onClick: r => window.open(`/print/sale/${r.id}`, '_blank', 'noopener') },
      { label: 'Delivery challan', icon: 'file', onClick: r => window.open(`/print/challan/${r.id}`, '_blank', 'noopener') },
      { label: 'Return / credit note', icon: 'undo', perm: ['credit_notes', 'write'],
        onClick: (r, { navigate }) => navigate(`/credit_notes?new=1&sale_id=${r.id}&bill_no=${encodeURIComponent(r.bill_no || '')}`) },
    ],
  },

  credit_notes: {
    title: 'Credit Notes', singular: 'credit note', plural: 'credit notes', dated: true, noCreate: true,
    description: 'Sales returns and rate corrections against a bill. To create one, use the return button on a sale.',
    searchPlaceholder: 'Note no., bill no., customer…',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Note no.', render: r => <span className="mono">{r.note_no}</span> },
      { label: 'Against bill', render: r => <span className="mono">{r.bill_no}</span> },
      { label: 'Customer', sort: 'party', key: 'party_name' },
      { label: 'Material', key: 'material_name' },
      { label: 'Quantity', align: 'right', render: r => `${fmtNum(r.qty)} ${r.unit}`, total: t => fmtNum(t.qty) },
      { label: 'Credit', sort: 'amount', align: 'right', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Stock', render: r => (r.restock ? <Badge tone="green">Returned to stock</Badge> : <Badge>Not restocked</Badge>) },
      { label: 'Reason', key: 'reason', wrap: true },
    ],
    filters: L => [{ key: 'party_id', label: 'Customer', options: customers(L) }],
    defaults: () => ({ date: today(), restock: true }),
    fields: () => [
      { key: 'sale_id', label: 'Against bill', type: 'readonly', display: v => v.bill_no || `#${v.sale_id}` },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'qty', label: 'Quantity returned', type: 'number', required: true },
      { key: 'rate', label: 'Rate (leave blank for billed rate)', type: 'number', hint: 'Lower it for a rate correction' },
      { key: 'restock', label: 'Back to stock', type: 'checkbox', checkLabel: 'Material came back into stock' },
      { key: 'reason', label: 'Reason', max: 300, full: true },
    ],
    rowActions: [{ label: 'Print credit note', icon: 'printer', onClick: r => window.open(`/print/credit/${r.id}`, '_blank', 'noopener') }],
  },

  weighments: {
    title: 'Weighbridge', singular: 'weighment', plural: 'weighments', dated: true,
    description: 'Weighbridge register: every vehicle weighed, with printable slips. Bill a loaded slip with one click.',
    searchPlaceholder: 'Slip no., vehicle, driver, customer…',
    columns: [
      { label: 'Date', sort: 'date', render: r => <>{fmtDate(r.date)} <span className="muted">{r.time || ''}</span></> },
      { label: 'Slip no.', sort: 'slip_no', render: r => <span className="mono">{r.slip_no}</span> },
      { label: 'Vehicle', sort: 'vehicle', render: r => <span className="mono">{r.vehicle_no}</span> },
      { label: 'Type', render: r => <Badge tone={r.type === 'Loaded' ? 'blue' : 'gray'}>{r.type}</Badge> },
      { label: 'Customer', key: 'party_name' },
      { label: 'Material', key: 'material_name' },
      { label: 'Gross kg', align: 'right', render: r => (r.gross_weight != null ? fmtNum(r.gross_weight, 0) : '—') },
      { label: 'Tare kg', align: 'right', render: r => fmtNum(r.tare_weight, 0) },
      { label: 'Net', sort: 'net', align: 'right', render: r => (r.net_weight != null ? <b>{fmtNum(r.net_weight / 1000, 3)} t</b> : '—'), total: t => `${fmtNum(t.net_weight / 1000, 3)} t` },
      { label: 'Amount', align: 'right', perm: 'finance', render: r => (r.amount != null ? fmtMoney(r.amount) : '—') },
      { label: 'Billed', render: r => (r.type === 'Empty' ? <span className="muted">—</span> : r.bill_no ? <span className="mono">{r.bill_no}</span> : <Badge tone="amber">Not billed</Badge>) },
    ],
    filters: L => [
      { key: 'type', label: 'Type', options: opts(L.enums.weighmentTypes || []) },
      { key: 'party_id', label: 'Customer', options: customers(L) },
    ],
    defaults: () => ({ date: today(), type: 'Loaded', rate: 0 }),
    fields: (L, v) => [
      { key: 'type', label: 'Weighment', type: 'select', required: true, options: [['Loaded', 'Loaded vehicle'], ['Empty', 'Empty vehicle (record tare)'], ['Re-weighment', 'Re-weighment']], section: 'Vehicle' },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'time', label: 'Time', type: 'time', hint: 'Leave blank for now' },
      { key: 'vehicle_no', label: 'Vehicle no.', required: true, max: 30, list: vehicleList },
      { key: 'driver', label: 'Driver', max: 100 },
      ...(v?.type === 'Empty' ? [
        { key: 'tare_weight', label: 'Empty vehicle weight (kg)', type: 'number', required: true, section: 'Weight', hint: 'Saved as this vehicle\u2019s tare for later slips' },
      ] : [
        { key: 'gross_weight', label: 'Gross weight (kg)', type: 'number', required: true, section: 'Weight' },
        { key: 'tare_weight', label: 'Tare weight (kg)', type: 'number', required: true, hint: 'Filled from the vehicle if saved' },
        { key: 'party_id', label: 'Customer', type: 'select', options: customers, placeholder: 'Not yet known', section: 'Load' },
        { key: 'material_id', label: 'Material', type: 'select', options: products, placeholder: 'Not yet known' },
        { key: 'rate', label: 'Rate per unit', type: 'number' },
      ]),
      { key: 'notes', label: 'Notes', max: 300, full: true },
    ],
    onChange: (key, v, L) => {
      const out = {};
      if (key === 'vehicle_no') { const veh = vehicleBy(L, v.vehicle_no); if (veh?.tare_weight && v.type !== 'Empty') out.tare_weight = veh.tare_weight; }
      if (key === 'material_id' && mat(L, v.material_id) && !Number(v.rate)) out.rate = mat(L, v.material_id).rate;
      return out;
    },
    summary: v => {
      const g = num(v.gross_weight), t = num(v.tare_weight);
      return v.type !== 'Empty' && g != null && t != null && g > t ? <>Net <b>{fmtNum(g - t, 0)} kg</b> · {fmtNum((g - t) / 1000, 3)} t</> : null;
    },
    rowActions: [
      { label: 'Print slip', icon: 'printer', onClick: r => window.open(`/print/weighment/${r.id}`, '_blank', 'noopener') },
      { label: 'Create bill from this slip', icon: 'receipt', perm: ['sales', 'write'], show: r => r.type !== 'Empty' && !r.sale_id,
        onClick: (r, { navigate, L }) => {
          const m = mat(L, r.material_id);
          const p = new URLSearchParams({ new: '1', weighment_id: r.id, slip_no: r.slip_no, vehicle_no: r.vehicle_no, gross_weight: r.gross_weight, tare_weight: r.tare_weight });
          if (r.party_id) p.set('party_id', r.party_id);
          if (r.material_id) p.set('material_id', r.material_id);
          if (r.rate || m?.rate) p.set('rate', r.rate || m.rate);
          if (r.driver) p.set('driver', r.driver);
          if (m?.unit === 'Ton') p.set('qty', String(r.net_weight / 1000));
          navigate(`/sales?${p}`);
        } },
    ],
  },

  purchases: {
    title: 'Purchases', singular: 'purchase', plural: 'purchases', dated: true,
    description: 'Boulders and other material bought from suppliers.',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Supplier', sort: 'party', key: 'party_name' },
      { label: 'Bill no.', render: r => <span className="mono">{r.bill_no}</span> },
      { label: 'Material', sort: 'material', key: 'material_name' },
      { label: 'Vehicle', key: 'vehicle_no' },
      { label: 'Quantity', sort: 'qty', align: 'right', render: r => `${fmtNum(r.qty)} ${r.unit}`, total: t => fmtNum(t.qty) },
      { label: 'Rate', sort: 'rate', align: 'right', render: r => fmtMoney(r.rate) },
      { label: 'Amount', sort: 'amount', align: 'right', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Paid', sort: 'paid', align: 'right', render: r => fmtMoney(r.paid), total: t => fmtMoney(t.paid) },
      { label: 'Status', render: payStatus },
    ],
    filters: L => [
      { key: 'party_id', label: 'Supplier', options: suppliers(L) },
      { key: 'material_id', label: 'Material', options: allMats(L) },
    ],
    defaults: L => ({ date: today(), mode: 'Cash', transport: 0, paid: 0, gst_pct: 0, material_id: L.materials.find(m => m.is_raw)?.id, rate: L.materials.find(m => m.is_raw)?.rate }),
    fields: L => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'party_id', label: 'Supplier', type: 'select', required: true, options: suppliers },
      { key: 'bill_no', label: 'Supplier bill no.', max: 40 },
      { key: 'material_id', label: 'Material', type: 'select', required: true, options: allMats },
      { key: 'vehicle_no', label: 'Vehicle no.', max: 30, list: vehicleList },
      { key: 'qty', label: 'Quantity', type: 'number', required: true },
      { key: 'rate', label: 'Rate per unit', type: 'number', required: true },
      { key: 'gst_pct', label: 'GST % on the bill', type: 'number', hint: 'Claimed back as input tax' },
      { key: 'transport', label: 'Transport / other', type: 'number' },
      { key: 'paid', label: 'Amount paid now', type: 'number' },
      { key: 'mode', label: 'Payment mode', type: 'select', required: true, options: opts(L.enums.payModes) },
      { key: 'notes', label: 'Notes', max: 500 },
    ],
    onChange: (key, v, L) => (key === 'material_id' && mat(L, v.material_id) ? { rate: mat(L, v.material_id).rate } : null),
    summary: v => {
      const sub = (Number(v.qty) || 0) * (Number(v.rate) || 0);
      return <>Total <b>{fmtMoney(r2(sub + (sub * (Number(v.gst_pct) || 0)) / 100 + (Number(v.transport) || 0)))}</b></>;
    },
  },

  production: {
    title: 'Production', singular: 'production entry', plural: 'production entries', dated: true,
    description: 'Daily crusher output, boulders consumed and running hours.',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Shift', key: 'shift' },
      { label: 'Material', sort: 'material', key: 'material_name' },
      { label: 'Output', sort: 'qty', align: 'right', render: r => `${fmtNum(r.qty)} ${r.unit}`, total: t => fmtNum(t.qty) },
      { label: 'Raw used', align: 'right', render: r => (r.raw_qty ? `${fmtNum(r.raw_qty)} ${r.raw_unit}` : '—'), total: t => fmtNum(t.raw_qty) },
      { label: 'Hours', sort: 'run_hours', align: 'right', render: r => fmtNum(r.run_hours, 1), total: t => fmtNum(t.run_hours, 1) },
      { label: 'Operator', key: 'operator_name' },
      { label: 'Downtime', sort: 'downtime', align: 'right', render: r => (r.downtime_hours ? <span title={r.downtime_reason}>{fmtNum(r.downtime_hours, 1)} h</span> : '—'), total: t => `${fmtNum(t.downtime_hours, 1)} h` },
      { label: 'Notes', key: 'notes', wrap: true },
    ],
    filters: L => [
      { key: 'material_id', label: 'Material', options: products(L) },
      { key: 'shift', label: 'Shift', options: opts(L.enums.shifts) },
    ],
    defaults: L => ({ date: today(), shift: 'Day', raw_qty: 0, run_hours: 0, downtime_hours: 0, raw_material_id: L.materials.find(m => m.is_raw)?.id }),
    fields: L => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'shift', label: 'Shift', type: 'select', required: true, options: opts(L.enums.shifts) },
      { key: 'material_id', label: 'Output material', type: 'select', required: true, options: products },
      { key: 'qty', label: 'Output quantity', type: 'number', required: true },
      { key: 'raw_material_id', label: 'Raw material used', type: 'select', options: rawMats, placeholder: 'None' },
      { key: 'raw_qty', label: 'Raw quantity used', type: 'number' },
      { key: 'run_hours', label: 'Plant running hours', type: 'number' },
      { key: 'downtime_hours', label: 'Stopped (hours)', type: 'number' },
      { key: 'downtime_reason', label: 'Why it stopped', type: 'select', options: x => opts(x.enums.downtimeReasons || []), placeholder: 'No stoppage' },
      { key: 'operator_id', label: 'Operator', type: 'select', options: x => x.employees.filter(e => e.active).map(e => [e.id, e.name]), placeholder: 'Not recorded' },
      { key: 'notes', label: 'Notes', max: 500, full: true },
    ],
  },

  expenses: {
    title: 'Expenses', singular: 'expense', plural: 'expenses', dated: true,
    description: 'Diesel, electricity, wages, repairs and other running costs.',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Category', sort: 'category', key: 'category' },
      { label: 'Description', key: 'description', wrap: true },
      { label: 'Paid to', render: r => r.paid_to || r.employee_name || '' },
      { label: 'Vehicle', key: 'vehicle_no' },
      { label: 'Mode', key: 'mode' },
      { label: 'Amount', sort: 'amount', align: 'right', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
    ],
    filters: L => [{ key: 'category', label: 'Category', options: opts(L.enums.expenseCategories) }],
    defaults: () => ({ date: today(), mode: 'Cash' }),
    fields: L => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'category', label: 'Category', type: 'select', required: true, options: opts(L.enums.expenseCategories) },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'mode', label: 'Payment mode', type: 'select', required: true, options: opts(L.enums.payModes) },
      { key: 'paid_to', label: 'Paid to / vendor', max: 120 },
      { key: 'vehicle_no', label: 'Vehicle (optional)', max: 30, list: vehicleList },
      { key: 'employee_id', label: 'Employee (for wages)', type: 'select', options: x => x.employees.map(e => [e.id, e.name]), placeholder: 'None' },
      { key: 'description', label: 'Description', max: 300, full: true },
    ],
  },

  diesel_logs: {
    title: 'Diesel Log', singular: 'diesel entry', plural: 'diesel entries', dated: true,
    description: 'Diesel issued to each machine and vehicle, with meter readings for fuel efficiency.',
    searchPlaceholder: 'Vehicle, notes…',
    header: 'diesel',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Vehicle / machine', sort: 'vehicle', render: r => <span className="mono">{r.vehicle_no}</span> },
      { label: 'Litres', sort: 'litres', align: 'right', render: r => fmtNum(r.litres), total: t => fmtNum(t.litres) },
      { label: 'Meter', align: 'right', render: r => (r.meter != null ? `${fmtNum(r.meter, 1)} ${r.meter_type === 'hours' ? 'hr' : 'km'}` : '—') },
      { label: 'Rate', align: 'right', perm: 'finance', render: r => fmtMoney(r.rate) },
      { label: 'Amount', align: 'right', perm: 'finance', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Notes', key: 'notes', wrap: true },
    ],
    filters: L => [{ key: 'vehicle_id', label: 'Vehicle', options: vehicleOpts(L) }],
    defaults: L => ({ date: today(), mode: 'Cash', rate: L.settings?.diesel_rate || '' }),
    fields: (L, v, can) => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'vehicle_id', label: 'Vehicle / machine', type: 'select', required: true, options: vehicleOpts },
      { key: 'litres', label: 'Litres', type: 'number', required: true },
      { key: 'meter', label: meterLabel(L, v.vehicle_id), type: 'number', hint: 'Needed for efficiency' },
      ...(can?.('finance') ? [
        { key: 'rate', label: 'Rate per litre', type: 'number' },
        { key: 'mode', label: 'Payment mode', type: 'select', required: true, options: opts(L.enums.payModes) },
      ] : []),
      { key: 'notes', label: 'Notes', max: 300, full: true },
    ],
    summary: (v, L, can) => (can?.('finance') && v.litres && v.rate ? <>Cost <b>{fmtMoney(r2(Number(v.litres) * Number(v.rate)))}</b></> : null),
  },

  maintenance: {
    title: 'Maintenance', singular: 'maintenance entry', plural: 'maintenance entries', dated: true,
    description: 'Services, repairs and breakdowns, with the next service due.',
    searchPlaceholder: 'Vehicle, description…',
    header: 'maintenance',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Vehicle / machine', sort: 'vehicle', render: r => <span className="mono">{r.vehicle_no}</span> },
      { label: 'Type', render: r => <Badge tone={r.kind === 'Breakdown' ? 'red' : r.kind === 'Service' ? 'blue' : 'gray'}>{r.kind}</Badge> },
      { label: 'Description', key: 'description', wrap: true },
      { label: 'Downtime', sort: 'downtime', align: 'right', render: r => (r.downtime_hours ? `${fmtNum(r.downtime_hours, 1)} h` : '—'), total: t => `${fmtNum(t.downtime_hours, 1)} h` },
      { label: 'Cost', align: 'right', perm: 'finance', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Next due', render: r => [r.next_due_date && fmtDate(r.next_due_date), r.next_due_meter != null && `${fmtNum(r.next_due_meter, 1)} ${r.meter_type === 'hours' ? 'hr' : 'km'}`].filter(Boolean).join(' / ') || '—' },
    ],
    filters: L => [
      { key: 'vehicle_id', label: 'Vehicle', options: vehicleOpts(L) },
      { key: 'kind', label: 'Type', options: opts(L.enums.maintenanceKinds || []) },
    ],
    defaults: () => ({ date: today(), kind: 'Service', mode: 'Cash', parts_cost: 0, labour_cost: 0, downtime_hours: 0 }),
    fields: (L, v, can) => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'vehicle_id', label: 'Vehicle / machine', type: 'select', required: true, options: vehicleOpts },
      { key: 'kind', label: 'Type', type: 'select', required: true, options: opts(L.enums.maintenanceKinds || []) },
      { key: 'meter', label: meterLabel(L, v.vehicle_id), type: 'number' },
      { key: 'description', label: 'Work done / problem', required: true, max: 300, full: true },
      { key: 'downtime_hours', label: 'Machine stopped (hours)', type: 'number' },
      ...(can?.('finance') ? [
        { key: 'parts_cost', label: 'Spare parts cost', type: 'number' },
        { key: 'labour_cost', label: 'Labour / mechanic cost', type: 'number' },
        { key: 'mode', label: 'Payment mode', type: 'select', required: true, options: opts(L.enums.payModes) },
      ] : []),
      { key: 'next_due_date', label: 'Next service date', type: 'date' },
      { key: 'next_due_meter', label: `Next service at (${meterLabel(L, v.vehicle_id).includes('Hour') ? 'hours' : 'km'})`, type: 'number' },
    ],
    summary: (v, L, can) => (can?.('finance') ? <>Total <b>{fmtMoney(r2((Number(v.parts_cost) || 0) + (Number(v.labour_cost) || 0)))}</b></> : null),
  },

  payroll_adjustments: {
    title: 'Bonuses & Deductions', singular: 'bonus or deduction', plural: 'adjustments',
    columns: [],
    defaults: () => ({ kind: 'bonus', month: today().slice(0, 7) }),
    fields: L => [
      { key: 'employee_id', label: 'Employee', type: 'select', required: true, options: x => x.employees.map(e => [e.id, e.name]) },
      { key: 'month', label: 'Month', type: 'month', required: true },
      { key: 'kind', label: 'Type', type: 'select', required: true, options: [['bonus', 'Bonus / incentive'], ['deduction', 'Deduction (fine, damage, etc.)']] },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'note', label: 'Note', max: 200, full: true },
    ],
  },

  royalty_permits: {
    title: 'Royalty & Permits', singular: 'royalty permit', plural: 'royalty permits', dated: true,
    description: 'Royalty / transit passes bought, and how many tons they still cover.',
    searchPlaceholder: 'Permit no., notes…',
    header: 'royalty',
    columns: [
      { label: 'Date', render: r => fmtDate(r.date) },
      { label: 'Permit no.', render: r => <span className="mono">{r.permit_no}</span> },
      { label: 'Quarry / source', key: 'quarry' },
      { label: 'Tons', align: 'right', render: r => fmtNum(r.qty, 3), total: t => fmtNum(t.qty, 3) },
      { label: 'Amount', align: 'right', render: r => fmtMoney(r.amount), total: t => fmtMoney(t.amount) },
      { label: 'Valid until', render: r => (r.valid_until ? fmtDate(r.valid_until) : '—') },
      { label: 'Notes', key: 'notes', wrap: true },
    ],
    defaults: () => ({ date: today() }),
    fields: () => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'permit_no', label: 'Permit / challan no.', required: true, max: 40 },
      { key: 'qty', label: 'Tons covered', type: 'number', required: true },
      { key: 'amount', label: 'Amount paid', type: 'number' },
      { key: 'valid_until', label: 'Valid until', type: 'date' },
      { key: 'quarry', label: 'Quarry / source', max: 120 },
      { key: 'mineral', label: 'Mineral', max: 60, list: () => ['Stone', 'Boulder', 'Gitti', 'Murrum', 'Sand'] },
      { key: 'payment_ref', label: 'Payment reference / UTR', max: 60 },
      { key: 'notes', label: 'Notes', max: 300, full: true },
    ],
  },

  payments: {
    title: 'Payments', singular: 'payment', plural: 'payments', dated: true,
    description: 'Money received from customers and paid to suppliers.',
    columns: [
      { label: 'Date', sort: 'date', render: r => fmtDate(r.date) },
      { label: 'Type', render: r => (r.direction === 'in' ? <Badge tone="green">Received</Badge> : <Badge tone="gray">Paid</Badge>) },
      { label: 'Party', sort: 'party', key: 'party_name' },
      { label: 'Mode', key: 'mode' },
      { label: 'Reference', key: 'reference' },
      { label: 'Amount', sort: 'amount', align: 'right', render: r => fmtMoney(r.amount) },
    ],
    filters: L => [
      { key: 'direction', label: 'Type', options: [['in', 'Received'], ['out', 'Paid']] },
      { key: 'party_id', label: 'Party', options: allParties(L) },
    ],
    defaults: () => ({ date: today(), direction: 'in', mode: 'Cash' }),
    fields: L => [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'direction', label: 'Type', type: 'select', required: true, options: [['in', 'Received from party'], ['out', 'Paid to party']] },
      { key: 'party_id', label: 'Party', type: 'select', required: true, options: allParties },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'mode', label: 'Mode', type: 'select', required: true, options: opts(L.enums.payModes.filter(m => m !== 'Credit')) },
      { key: 'reference', label: 'Reference / cheque no.', max: 60 },
      { key: 'notes', label: 'Notes', max: 500, full: true },
    ],
  },

  parties: {
    title: 'Customers & Suppliers', singular: 'party', plural: 'parties', refreshLookups: true,
    description: 'Everyone you sell to or buy from, with their running balance.',
    searchPlaceholder: 'Name, phone, address…',
    columns: [
      { label: 'Name', sort: 'name', render: (r, { can, navigate }) => (can('ledger')
        ? <a href={`/parties/${r.id}`} onClick={e => { e.preventDefault(); navigate(`/parties/${r.id}`); }}>{r.name}</a>
        : r.name) },
      { label: 'Type', sort: 'type', render: r => PARTY_TYPES.find(t => t[0] === r.type)?.[1] },
      { label: 'Phone', key: 'phone' },
      { label: 'Address', key: 'address', wrap: true },
      { label: 'Balance', align: 'right', render: r => balanceBadge(r.balance) },
    ],
    filters: () => [{ key: 'type', label: 'Type', options: PARTY_TYPES }],
    defaults: () => ({ type: 'customer', opening: 0 }),
    fields: () => [
      { key: 'name', label: 'Name', required: true, max: 120 },
      { key: 'type', label: 'Type', type: 'select', required: true, options: PARTY_TYPES },
      { key: 'phone', label: 'Phone', max: 30 },
      { key: 'email', label: 'Email', max: 254, type: 'email' },
      { key: 'gstin', label: 'GSTIN', max: 20, hint: 'Decides CGST+SGST or IGST on bills' },
      { key: 'state', label: 'State', type: 'select', options: x => x.enums.states.map(s => [s, s]), placeholder: 'Same as business' },
      { key: 'address', label: 'Address / site', max: 300, full: true },
      { key: 'opening', label: 'Opening balance', type: 'number', hint: 'Positive if they owe you, negative if you owe them' },
      { key: 'credit_limit', label: 'Credit limit', type: 'number', hint: '0 = no limit. Bills that go over it need a manager' },
    ],
    rowActions: [{ label: 'Ledger', icon: 'book', perm: ['ledger'], onClick: (r, { navigate }) => navigate(`/parties/${r.id}`) }],
  },

  materials: {
    title: 'Materials & Rates', singular: 'material', plural: 'materials', refreshLookups: true,
    description: 'Products and raw materials, their units, default rates and stock alerts.',
    columns: [
      { label: 'Material', sort: 'name', key: 'name' },
      { label: 'Type', render: r => (r.is_raw ? <Badge>Raw material</Badge> : <Badge tone="blue">Product</Badge>) },
      { label: 'Unit', key: 'unit' },
      { label: 'HSN', render: r => <span className="mono">{r.hsn}</span> },
      { label: 'Default rate', sort: 'rate', align: 'right', render: r => fmtMoney(r.rate) },
      { label: 'Opening stock', align: 'right', render: r => fmtNum(r.opening) },
      { label: 'Alert below', align: 'right', render: r => fmtNum(r.reorder_level) },
    ],
    defaults: () => ({ unit: 'Ton', is_raw: false, opening: 0, reorder_level: 50, hsn: '2517' }),
    fields: L => [
      { key: 'name', label: 'Name', required: true, max: 100 },
      { key: 'unit', label: 'Unit', type: 'select', required: true, options: opts(L.enums.units) },
      { key: 'rate', label: 'Default rate', type: 'number', required: true },
      { key: 'hsn', label: 'HSN code', max: 8, hint: 'Aggregates and dust: 2517' },
      { key: 'opening', label: 'Opening stock', type: 'number' },
      { key: 'reorder_level', label: 'Low-stock alert level', type: 'number' },
      { key: 'is_raw', label: 'Raw material', type: 'checkbox', checkLabel: 'Raw material (input to the crusher)' },
    ],
  },

  vehicles: {
    title: 'Vehicles & Machines', singular: 'vehicle', plural: 'vehicles', refreshLookups: true,
    description: 'Tippers, trucks, loaders and other equipment.',
    columns: [
      { label: 'Number', sort: 'number', render: r => <span className="mono">{r.number}</span> },
      { label: 'Kind', key: 'kind' },
      { label: 'Ownership', render: r => (r.ownership === 'hired' ? <Badge>Hired</Badge> : <Badge tone="blue">Own</Badge>) },
      { label: 'Owner', key: 'owner_name' },
      { label: 'Tare (kg)', align: 'right', render: r => (r.tare_weight ? fmtNum(r.tare_weight, 1) : '—') },
      { label: 'Driver / operator', key: 'driver' },
      { label: 'Phone', key: 'phone' },
      { label: 'Notes', key: 'notes', wrap: true },
    ],
    filters: () => [{ key: 'ownership', label: 'Ownership', options: [['own', 'Own'], ['hired', 'Hired']] }],
    defaults: () => ({ ownership: 'own', meter_type: 'km' }),
    fields: (L, values) => [
      { key: 'number', label: 'Vehicle / machine no.', required: true, max: 30 },
      { key: 'kind', label: 'Kind', type: 'select', options: opts(L.enums.vehicleKinds) },
      { key: 'ownership', label: 'Ownership', type: 'select', required: true, options: [['own', 'Own'], ['hired', 'Hired / rented']] },
      { key: 'tare_weight', label: 'Empty (tare) weight, kg', type: 'number', hint: 'Pre-fills weighbridge entries' },
      { key: 'meter_type', label: 'Meter', type: 'select', required: true, options: [['km', 'Odometer (km)'], ['hours', 'Hour meter']] },
      ...(values?.ownership === 'hired' ? [
        { key: 'owner_party_id', label: 'Owner (to pay freight)', type: 'select', options: suppliers, placeholder: 'Not set', hint: 'Add the owner as a supplier first' },
        { key: 'freight_rate', label: 'Freight per trip', type: 'number' },
      ] : []),
      { key: 'driver', label: 'Driver / operator', max: 100 },
      { key: 'phone', label: 'Phone', max: 30 },
      { key: 'notes', label: 'Notes', max: 500, hint: 'Insurance, fitness due dates…' },
    ],
  },

  employees: {
    title: 'Employees', singular: 'employee', plural: 'employees', refreshLookups: true,
    description: 'Staff, their roles and wages.',
    columns: [
      { label: 'Name', sort: 'name', key: 'name' },
      { label: 'Role', key: 'role' },
      { label: 'Phone', key: 'phone' },
      { label: 'Wage', sort: 'wage', align: 'right', render: r => `${fmtMoney(r.wage)} / ${r.wage_type === 'monthly' ? 'month' : 'day'}` },
      { label: 'Joined', render: r => fmtDate(r.joined_on) },
      { label: 'Status', render: r => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Left</Badge>) },
    ],
    filters: () => [{ key: 'active', label: 'Status', options: [['true', 'Active'], ['false', 'Left']] }],
    defaults: () => ({ wage_type: 'daily', active: true, joined_on: today() }),
    fields: () => [
      { key: 'name', label: 'Name', required: true, max: 100 },
      { key: 'role', label: 'Role', max: 60, list: () => ['Plant Operator', 'Loader Operator', 'Driver', 'Helper', 'Supervisor', 'Mechanic', 'Electrician', 'Weighbridge Operator', 'Accountant', 'Watchman'] },
      { key: 'phone', label: 'Phone', max: 30 },
      { key: 'joined_on', label: 'Joining date', type: 'date' },
      { key: 'wage_type', label: 'Wage type', type: 'select', required: true, options: [['daily', 'Daily wage'], ['monthly', 'Monthly salary']] },
      { key: 'wage', label: 'Wage amount', type: 'number', required: true },
      { key: 'ot_rate', label: 'Overtime rate per hour', type: 'number', hint: 'Leave 0 to use wage ÷ 8 hours' },
      { key: 'active', label: 'Active', type: 'checkbox', checkLabel: 'Currently working' },
    ],
  },
};
