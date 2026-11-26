'use client';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from '../router.jsx';
import Icon from './Icon.jsx';
import RecordForm from './RecordForm.jsx';
import { PageHeader, SearchInput, Pager, Empty, Field, NoAccess } from './ui.jsx';
import { api, exportUrl } from '../lib/api.js';
import { monthStart } from '../lib/format.js';
import { useAuth, useConfirm, useLookups, useToast } from '../context.jsx';
import { RESOURCES } from '../resources.jsx';
import { PAGE_HEADERS } from './PageHeaders.jsx';
import { quickRange, QUICK_RANGES } from '../lib/dates.js';

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Generic list page: search, date range, filters, totals, pagination, CSV export, add/edit/delete. */
export default function DataPage({ name }) {
  const cfg = RESOURCES[name];
  const { can } = useAuth();
  const L = useLookups();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [range, setRange] = useState({ from: cfg.dated ? monthStart() : '', to: '' });
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState({ key: '', dir: 'desc' });
  const [showFilters, setShowFilters] = useState(false); // phones: filters fold away behind a button
  const [data, setData] = useState({ rows: [], total: 0, totals: {} });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [params, setParams] = useSearchParams();

  // Deep link "?new=1&field=value" opens the create form with those values (e.g. a return from a sale).
  useEffect(() => {
    if (params.get('new') !== '1') return;
    const preset = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'new'));
    setForm({ preset });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const query = { q, ...range, ...filters, page, pageSize, ...(sort.key ? { sort: sort.key, dir: sort.dir } : {}) };
  const queryKey = JSON.stringify(query);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/${name}`, { query: JSON.parse(queryKey) }));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [name, queryKey, toast]);

  const allowed = can(name, 'read');
  useEffect(() => { if (allowed) load(); }, [load, allowed]);
  useEffect(() => { setPage(1); }, [q, range.from, range.to, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed) return <NoAccess />;
  const canWrite = can(name, 'write');
  const canRemove = can(name, 'remove');

  const remove = async row => {
    const ok = await confirm({ title: `Delete ${cfg.singular}?`, message: 'This permanently removes the record. It is kept in the audit log.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api(`/${name}/${row.id}`, { method: 'DELETE' });
      toast(`${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} deleted`);
      if (cfg.refreshLookups) L.reload();
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const filterDefs = cfg.filters?.(L) || [];
  const activeFilters = Object.values(filters).filter(Boolean).length + (range.to ? 1 : 0);
  const columns = cfg.columns.filter(c => !c.perm || can(c.perm));
  const hasTotals = columns.some(c => c.total);
  const ctx = { can, navigate, L };

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description}>
        <span className="btn-group">
          <a className="btn" href={exportUrl(`/${name}/export`, { q, ...range, ...filters, format: 'xlsx' })} download title="Download as Excel">
            <Icon name="download" size={16} /> Excel
          </a>
          <a className="btn" href={exportUrl(`/${name}/export`, { q, ...range, ...filters })} download title="Download as CSV">CSV</a>
        </span>
        {canWrite && !cfg.noCreate && (
          <button className="btn btn-primary" onClick={() => setForm({})}>
            <Icon name="plus" size={16} /> New {cfg.singular}
          </button>
        )}
      </PageHeader>

      {cfg.header && PAGE_HEADERS[cfg.header] && (() => { const H = PAGE_HEADERS[cfg.header]; return <H version={data} />; })()}

      <div className="card">
        <div className="toolbar">
          <div className="grow"><Field label="Search"><SearchInput value={search} onChange={setSearch} placeholder={cfg.searchPlaceholder} /></Field></div>
          {(cfg.dated || filterDefs.length > 0) && (
            <button type="button" className={`btn filter-toggle ${showFilters ? 'on' : ''}`} onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}>
              <Icon name="sliders" size={16} /> Filters{activeFilters ? <span className="filter-count">{activeFilters}</span> : null}
            </button>
          )}
          <div className={`filter-extra ${showFilters ? 'open' : ''}`}>
          {cfg.dated && (
            <>
              <Field label="From"><input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} /></Field>
              <Field label="To"><input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} /></Field>
              <Field label="Period">
                <select value="" onChange={e => e.target.value && setRange(quickRange(e.target.value))} aria-label="Quick date range">
                  <option value="">Choose…</option>
                  {QUICK_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </>
          )}
          {filterDefs.map(f => (
            <Field key={f.key} label={f.label}>
              <select value={filters[f.key] ?? ''} onChange={e => setFilters(x => ({ ...x, [f.key]: e.target.value }))}>
                <option value="">All</option>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          ))}
          {cfg.dated && (range.from || range.to) && (
            <button className="btn btn-ghost" onClick={() => setRange({ from: '', to: '' })}>All dates</button>
          )}
          </div>
        </div>
        {loading && <div className="loading-bar" />}
        {loading && data.rows.length === 0 ? (
          <div className="skeleton-rows" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}</div>
        ) : !loading && data.rows.length === 0 ? (
          <Empty title={`No ${cfg.plural || cfg.title.toLowerCase()} found`}>
            {canWrite && !q && !cfg.noCreate && <button className="btn btn-primary mt" onClick={() => setForm({})}><Icon name="plus" size={16} /> New {cfg.singular}</button>}
          </Empty>
        ) : (
          <div className={`table-wrap sticky-head ${loading ? 'is-loading' : ''}`}>
            <table className="table-cards">
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c.label} className={c.align === 'right' ? 'num' : ''} aria-sort={sort.key && sort.key === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sort ? (
                        <button type="button" className={`th-sort ${sort.key === c.sort ? 'on' : ''}`}
                          onClick={() => { setSort(s => ({ key: c.sort, dir: s.key === c.sort && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(1); }}>
                          {c.label}<Icon name={sort.key === c.sort ? (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} size={12} />
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th className="actions"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id}>
                    {columns.map(c => (
                      <td key={c.label} data-label={c.label} className={`${c.align === 'right' ? 'num' : ''} ${c.wrap ? 'wrap' : ''}`}>
                        {c.render ? c.render(r, ctx) : r[c.key] ?? ''}
                      </td>
                    ))}
                    <td className="actions">
                      <span className="row-actions">
                        {(cfg.rowActions || []).filter(a => (!a.perm || can(...a.perm)) && (!a.show || a.show(r))).map(a => (
                          <button key={a.label} className="icon-btn" title={a.label} aria-label={a.label} onClick={() => a.onClick(r, ctx)}>
                            <Icon name={a.icon} size={16} />
                          </button>
                        ))}
                        {canWrite && <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setForm({ record: r })}><Icon name="edit" size={16} /></button>}
                        {canRemove && <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => remove(r)}><Icon name="trash" size={16} /></button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {hasTotals && data.rows.length > 0 && (
                <tfoot>
                  <tr>
                    {columns.map((c, i) => (
                      <td key={c.label} data-label={c.label} className={`${c.align === 'right' ? 'num' : ''} ${i > 0 && !c.total ? 'empty-cell' : ''}`}>
                        {i === 0 ? 'Total' : c.total ? c.total(data.totals) : ''}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        {data.total > 0 && <Pager page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />}
      </div>

      {form && <RecordForm name={name} record={form.record} preset={form.preset} onClose={() => setForm(null)} onSaved={load} />}
    </>
  );
}
