/** Light / dark / follow-the-system theme, remembered per browser. */
const KEY = 'scm.theme';
export const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}
export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  else root.removeAttribute('data-theme');
  const dark = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#11100e' : '#f6f5f2');
}
export function setTheme(t) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  applyTheme(t);
}
