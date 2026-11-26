'use client';
import { m } from 'framer-motion';
import Icon from './Icon.jsx';
import { ease, spring } from '../lib/motion.js';

/** KPI cards fade up one after another when their parent uses <StatGrid>. */
const statVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease } } };
export const StatGrid = ({ children, className = '' }) => (
  <m.div className={`stats ${className}`} initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>{children}</m.div>
);

export function PageHeader({ title, description, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="actions no-print">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <m.div className="card stat" variants={statVariants}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </m.div>
  );
}

export const Badge = ({ tone = 'gray', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function Empty({ title = 'Nothing here yet', icon = 'inbox', children }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <h4>{title}</h4>
      {children && <div>{children}</div>}
    </div>
  );
}

export function NoAccess() {
  return (
    <div className="card"><Empty title="You don't have access to this page">Ask an administrator if you need it.</Empty></div>
  );
}

/** Tab bar with an underline that slides to the active tab. `id` keeps separate tab bars from sharing the animation. */
export function Tabs({ id, tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>
          {label}
          {value === k && <m.span layoutId={`tab-line-${id}`} className="tab-line" transition={spring} />}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, error, hint, required, full, children, htmlFor }) {
  return (
    <div className={`field ${full ? 'full' : ''} ${error ? 'invalid' : ''}`}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="muted"> *</span>}</label>}
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label="Search" />
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span>{from}–{to} of {total.toLocaleString('en-IN')}</span>
      <span className="spacer" />
      <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))} aria-label="Rows per page">
        {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
      </select>
      <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><Icon name="chevronLeft" /></button>
      <span>{page} / {pages}</span>
      <button className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><Icon name="chevronRight" /></button>
    </div>
  );
}
