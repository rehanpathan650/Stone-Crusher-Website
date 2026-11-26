let currency = '₹';
export const setCurrency = c => { currency = c || '₹'; };

export const fmtMoney = v => {
  const x = Number(v) || 0;
  return (x < 0 ? '−' : '') + currency + Math.abs(x).toLocaleString('en-IN', { maximumFractionDigits: 2 });
};
export const fmtNum = (v, d = 2) => (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: d });
export const fmtDate = d => {
  if (!d) return '';
  const x = typeof d === 'string' && d.length === 10 ? new Date(d + 'T00:00:00') : new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = d => {
  if (!d) return '';
  const x = new Date(typeof d === 'string' && !d.includes('T') && !d.includes('Z') ? d.replace(' ', 'T') + 'Z' : d);
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const shortMoney = n => {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(1) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(1) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
};

export function isoDate(d = new Date()) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
}
export const today = () => isoDate();
export const monthStart = (d = new Date()) => isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
export const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
export const initials = name => String(name || '?').split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

/* Indian-system amount in words, e.g. 125430.5 → "Rupees One Lakh Twenty Five Thousand Four Hundred Thirty and Fifty Paise Only" */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim());
const three = n => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', two(n % 100)].filter(Boolean).join(' ');
function intWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${intWords(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}
export function amountInWords(v) {
  const x = Math.round(Math.abs(Number(v) || 0) * 100);
  const rupees = Math.floor(x / 100), paise = x % 100;
  return `Rupees ${intWords(rupees)}${paise ? ` and ${two(paise)} Paise` : ''} Only`;
}
