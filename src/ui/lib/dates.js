import { isoDate, monthStart, today } from './format.js';

/** Start of the Indian financial year (1 April) that contains date d. */
const fyStart = (d = new Date()) => new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);

export function quickRange(v) {
  const d = new Date();
  if (v === 'today') return { from: today(), to: today() };
  if (v === 'month') return { from: monthStart(), to: today() };
  if (v === 'last') return { from: isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: isoDate(new Date(d.getFullYear(), d.getMonth(), 0)) };
  if (v === 'fy') return { from: isoDate(fyStart(d)), to: today() };
  if (v === 'lastfy') {
    const s = fyStart(d);
    return { from: isoDate(new Date(s.getFullYear() - 1, 3, 1)), to: isoDate(new Date(s.getFullYear(), 2, 31)) };
  }
  return { from: '', to: '' };
}

export const QUICK_RANGES = [['today', 'Today'], ['month', 'This month'], ['last', 'Last month'], ['fy', 'This financial year'], ['lastfy', 'Last financial year'], ['all', 'All time']];
