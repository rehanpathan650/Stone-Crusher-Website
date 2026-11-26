/** CSV cell with spreadsheet formula-injection protection (cells starting with = + - @ are prefixed). */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(columns, rows) {
  const head = columns.map(([h]) => cell(h)).join(',');
  const body = rows.map(r => columns.map(([, k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}
