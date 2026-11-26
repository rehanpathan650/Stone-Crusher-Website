import { db } from '../db.js';
import { norm, n, r2 } from '../lib/util.js';

const monthDays = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
const monthRange = month => ({ from: `${month}-01`, to: `${month}-${String(monthDays(month)).padStart(2, '0')}` });

/** Overtime rate per hour: the employee's own rate, or wage ÷ 8 hours (daily) / ÷ 26 days ÷ 8 hours (monthly). */
export const otRate = e => (e.ot_rate > 0 ? e.ot_rate : r2(e.wage_type === 'monthly' ? e.wage / 26 / 8 : e.wage / 8));

/** One employee-month: basic pay for paid days + overtime + bonus − deductions. */
function monthNet(e, month, att, adj) {
  const a = att || { P: 0, H: 0, A: 0, ot: 0 };
  const days = a.P + a.H * 0.5;
  const basic = r2(e.wage_type === 'monthly' ? (e.wage / monthDays(month)) * days : e.wage * days);
  const ot_pay = r2(a.ot * otRate(e));
  const bonus = adj?.bonus || 0, deduction = adj?.deduction || 0;
  return { present: a.P, half: a.H, absent: a.A, days, ot_hours: a.ot, basic, ot_pay, bonus, deduction, net: r2(basic + ot_pay + bonus - deduction) };
}

/**
 * Payroll for a month, with balance brought forward from all earlier months.
 * Payments (including advances) are "Wages / Salary" expenses tagged with the employee.
 * brought_forward > 0: still owed from earlier months; < 0: advance not yet recovered.
 */
export async function payrollFor(month, employeeId = null) {
  const { from, to } = monthRange(month);
  const empQ = db('employees').select('id', 'name', 'role', 'phone', 'wage_type', 'wage', 'ot_rate', 'active', 'joined_on').orderBy('name');
  if (employeeId) empQ.where('id', employeeId);
  const scope = q => (employeeId ? q.where('employee_id', employeeId) : q);
  const ym = db.raw('substr(date, 1, 7)');
  const ymAs = db.raw('substr(date, 1, 7) as m');
  const [emps, att, adj, paid] = await Promise.all([
    empQ,
    scope(db('attendance').where('date', '<=', to)).select('employee_id', 'status', ymAs).count({ c: 'id' }).sum({ ot: 'ot_hours' })
      .groupBy('employee_id', 'status', ym),
    scope(db('payroll_adjustments').where('month', '<=', month)).select('employee_id', 'month', 'kind').sum({ a: 'amount' }).groupBy('employee_id', 'month', 'kind'),
    scope(db('expenses').whereNotNull('employee_id').where('date', '<=', to)).select('employee_id', ymAs).sum({ v: 'amount' }).groupBy('employee_id', ym),
  ]);
  // employee → month → aggregates
  const tree = () => new Map();
  const attT = tree(), adjT = tree(), paidT = tree();
  const slot = (t, e, m, init) => {
    if (!t.has(e)) t.set(e, new Map());
    if (!t.get(e).has(m)) t.get(e).set(m, init());
    return t.get(e).get(m);
  };
  att.forEach(r => {
    const s = slot(attT, Number(r.employee_id), r.m, () => ({ P: 0, H: 0, A: 0, ot: 0 }));
    s[r.status] = n(r.c);
    s.ot = r2(s.ot + n(r.ot));
  });
  adj.forEach(r => { slot(adjT, Number(r.employee_id), r.month, () => ({ bonus: 0, deduction: 0 }))[r.kind] = n(r.a); });
  paid.forEach(r => { paidT.set(Number(r.employee_id), (paidT.get(Number(r.employee_id)) || new Map()).set(r.m, n(r.v))); });

  const rows = emps.map(norm).map(e => {
    const months = new Set([...(attT.get(e.id)?.keys() || []), ...(adjT.get(e.id)?.keys() || []), ...(paidT.get(e.id)?.keys() || [])]);
    let prevNet = 0, prevPaid = 0;
    for (const m of months) {
      if (m >= month) continue;
      prevNet += monthNet(e, m, attT.get(e.id)?.get(m), adjT.get(e.id)?.get(m)).net;
      prevPaid += paidT.get(e.id)?.get(m) || 0;
    }
    const cur = monthNet(e, month, attT.get(e.id)?.get(month), adjT.get(e.id)?.get(month));
    const brought_forward = r2(prevNet - prevPaid);
    const paidNow = paidT.get(e.id)?.get(month) || 0;
    return {
      ...e, ot_rate_effective: otRate(e), ...cur,
      earned: cur.net, // kept for older clients
      brought_forward, paid: paidNow, due: r2(brought_forward + cur.net - paidNow),
    };
  }).filter(r => employeeId || r.active || r.days || r.paid || Math.abs(r.brought_forward) > 0.005 || r.bonus || r.deduction);
  return { month, daysInMonth: monthDays(month), from, to, rows };
}

/** Wage slip detail: the payroll row plus the day-by-day attendance, adjustments and payments of the month. */
export async function wageSlip(employeeId, month) {
  const { rows, from, to, daysInMonth } = await payrollFor(month, employeeId);
  if (!rows.length) return null;
  const [days, adjustments, payments] = await Promise.all([
    db('attendance').where({ employee_id: employeeId }).whereBetween('date', [from, to]).select('date', 'status', 'ot_hours').orderBy('date'),
    db('payroll_adjustments').where({ employee_id: employeeId, month }).select('id', 'kind', 'amount', 'note').orderBy('id'),
    db('expenses').where({ employee_id: employeeId }).whereBetween('date', [from, to]).select('id', 'date', 'amount', 'mode', 'description').orderBy('date'),
  ]);
  return { month, daysInMonth, employee: rows[0], days: days.map(norm).map(d => ({ ...d, ot_hours: n(d.ot_hours) })),
    adjustments: adjustments.map(a => ({ ...a, amount: n(a.amount) })), payments: payments.map(norm) };
}
