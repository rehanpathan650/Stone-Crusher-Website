import { r2 } from './util.js';

/** Indian states / UTs with GST state codes (for place of supply). */
export const STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
];
export const STATE_NAMES = STATES.map(s => s[1]);
export const stateCode = name => STATES.find(s => s[1] === name)?.[0] || '';

/** Indian financial year (April–March) of a 'YYYY-MM-DD' date, e.g. '2026-27'. */
export function fyOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** First and last date of a financial year label. */
export function fyRange(fy) {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/** Same state (or unknown) = CGST + SGST; different state = IGST. Party GST state wins over the address. */
export function taxType(companyState, partyState, partyGstin) {
  const fromGstin = partyGstin && /^\d{2}/.test(partyGstin) ? STATES.find(s => s[0] === partyGstin.slice(0, 2))?.[1] : null;
  const ps = fromGstin || partyState;
  return companyState && ps && companyState !== ps ? 'inter' : 'intra';
}

export function splitTax(gstAmount, type) {
  if (type === 'inter') return { cgst: 0, sgst: 0, igst: r2(gstAmount) };
  const cgst = r2(gstAmount / 2);
  return { cgst, sgst: r2(gstAmount - cgst), igst: 0 };
}

/** Next document number in a financial year, e.g. INV/2026-27/0007. Runs inside the caller's transaction. */
export async function nextNumber(trx, table, prefix, fy) {
  const row = await trx(table).where({ fy }).max({ m: 'seq' }).first();
  const seq = (Number(row?.m) || 0) + 1;
  const clean = String(prefix || '').trim().replace(/[-/\s]+$/, '');
  return { seq, number: `${clean ? clean + '/' : ''}${fy}/${String(seq).padStart(4, '0')}` };
}
