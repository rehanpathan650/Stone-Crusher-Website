const NUMERIC = new Set([
  'rate', 'opening', 'reorder_level', 'qty', 'transport', 'gst_pct', 'subtotal', 'gst_amount', 'amount', 'paid',
  'raw_qty', 'run_hours', 'wage', 'count', 'balance', 'failed_attempts', 'locked_until', 'last_login_at', 'created_at_ms',
  'cgst', 'sgst', 'igst', 'seq', 'gross_weight', 'tare_weight', 'net_weight', 'freight_cost', 'freight_rate',
  'litres', 'meter', 'parts_cost', 'labour_cost', 'downtime_hours', 'next_due_meter', 'expense_id', 'ot_hours', 'ot_rate', 'credit_limit', 'sale_id',
]);
const BOOLEAN = new Set(['is_raw', 'active', 'restock', 'must_change_password']);

/** Normalise DB rows: PostgreSQL returns decimals as strings and SQLite returns booleans as 0/1. */
export function norm(row) {
  if (!row) return row;
  const o = { ...row };
  for (const k of Object.keys(o)) {
    if (o[k] === null || o[k] === undefined) continue;
    if (NUMERIC.has(k)) o[k] = Number(o[k]);
    else if (BOOLEAN.has(k)) o[k] = o[k] === true || o[k] === 1 || o[k] === '1' || o[k] === 't';
  }
  return o;
}

export const n = v => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const r2 = v => Math.round(n(v) * 100) / 100;
export const r3 = v => Math.round(n(v) * 1000) / 1000;

export function isoDate(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
export const today = () => isoDate();
/** Current local time as HH:MM. */
export const isoTime = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const monthStart = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};
export const daysAgo = k => {
  const d = new Date();
  d.setDate(d.getDate() - k);
  return isoDate(d);
};
export const insertedId = r => (r && typeof r === 'object' ? r.id : r);

export const log = {
  info: (msg, extra = {}) => console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...extra })),
  warn: (msg, extra = {}) => console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), msg, ...extra })),
  error: (msg, extra = {}) => console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg, ...extra })),
};
