import { insertedId } from '../lib/util.js';

/**
 * Keeps one expense row in sync with a diesel or maintenance entry, so every cost
 * appears once in expenses, profit & loss and the cash book. Returns the expense id (or null).
 */
export async function syncExpense(trx, existingId, { date, category, amount, mode, vehicle_no, description, source, created_by }) {
  if (!(amount > 0)) {
    if (existingId) await trx('expenses').where({ id: existingId }).del();
    return null;
  }
  const row = { date, category, amount, mode: mode || 'Cash', vehicle_no: vehicle_no || null, description, source, employee_id: null };
  if (existingId && (await trx('expenses').where({ id: existingId }).first())) {
    await trx('expenses').where({ id: existingId }).update({ ...row, updated_at: trx.fn.now() });
    return existingId;
  }
  const [ins] = await trx('expenses').insert({ ...row, created_by: created_by ?? null }).returning('id');
  return insertedId(ins);
}
