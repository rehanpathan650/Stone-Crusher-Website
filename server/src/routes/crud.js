import express from 'express';
import { db, likeOp } from '../db.js';
import { requirePerm } from '../auth/session.js';
import { audit, diff } from '../lib/audit.js';
import { notFound, badRequest } from '../lib/errors.js';
import { norm, insertedId } from '../lib/util.js';
import { toCsv } from '../lib/csv.js';
import { sendXlsx } from '../lib/xlsx.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Columns only: keys starting with "_" are helper values passed from prepare() to afterSave(). */
const dbRow = row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));

function parseId(v) {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

function listParams(query) {
  const int = (v, d, min, max) => {
    const x = parseInt(v, 10);
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d;
  };
  const str = v => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const date = v => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
  return {
    page: int(query.page, 1, 1, 1_000_000),
    pageSize: int(query.pageSize, 25, 1, 500),
    q: str(query.q),
    from: date(query.from),
    to: date(query.to),
    sort: str(query.sort),
    dir: query.dir === 'asc' ? 'asc' : 'desc',
  };
}

/** Builds list/get/create/update/delete/export routes for one resource definition. */
export function crudRouter(name, cfg) {
  const r = express.Router();
  const T = cfg.table;

  const baseQuery = (p, query) => {
    const q = db(T);
    cfg.joins?.(q);
    if (cfg.dated) {
      if (p.from) q.where(`${T}.date`, '>=', p.from);
      if (p.to) q.where(`${T}.date`, '<=', p.to);
    }
    for (const [key, col] of Object.entries(cfg.filters || {})) {
      const v = query[key];
      if (typeof v !== 'string' || v === '' || v.length > 60) continue;
      if (v === 'true' || v === 'false') q.where(col, v === 'true');
      else q.where(col, v);
    }
    if (p.q && cfg.search?.length) {
      const term = `%${p.q}%`;
      q.where(b => cfg.search.forEach(col => b.orWhere(col, likeOp, term)));
    }
    return q;
  };
  /** Sorting only by whitelisted keys (cfg.sortable maps a public key to a column); default order otherwise. */
  const ordered = (q, p = {}) => {
    const col = p.sort && cfg.sortable?.[p.sort];
    if (col) q.orderBy(col, p.dir).orderBy(`${T}.id`, p.dir);
    else (cfg.order || [[`${T}.date`, 'desc'], [`${T}.id`, 'desc']]).forEach(([c, d]) => q.orderBy(c, d));
    return q;
  };
  const selectCols = cfg.select || [`${T}.*`];
  const fetchOne = async (id, trx = db) => {
    const q = trx(T);
    cfg.joins?.(q);
    return norm(await q.where(`${T}.id`, id).first(selectCols));
  };

  r.get('/', requirePerm(name, 'read'), async (req, res) => {
    const p = listParams(req.query);
    const base = baseQuery(p, req.query);
    const agg = base.clone().count({ count: `${T}.id` });
    (cfg.sums || []).forEach(c => agg.sum({ [c]: `${T}.${c}` }));
    const [totalsRow, rows] = await Promise.all([
      agg.first(),
      ordered(base.clone().select(selectCols), p).limit(p.pageSize).offset((p.page - 1) * p.pageSize),
    ]);
    const items = rows.map(norm);
    const totals = {};
    (cfg.sums || []).forEach(c => { totals[c] = Number(totalsRow?.[c] || 0); });
    if (cfg.decorate) await cfg.decorate(items, req, totals);
    res.json({ rows: items, total: Number(totalsRow?.count || 0), totals, page: p.page, pageSize: p.pageSize });
  });

  r.get('/export', requirePerm(name, 'read'), async (req, res) => {
    const p = listParams(req.query);
    const rows = (await ordered(baseQuery(p, req.query).select(selectCols), p).limit(50_000)).map(norm);
    if (cfg.decorate) await cfg.decorate(rows, req);
    const cols = cfg.csv || Object.keys(rows[0] || {}).map(k => [k, k]);
    const xlsx = req.query.format === 'xlsx';
    await audit(req, 'export', name, null, { count: rows.length, format: xlsx ? 'xlsx' : 'csv' });
    if (xlsx) {
      const val = (r, k) => { const v = typeof k === 'function' ? k(r) : r[k]; return v === undefined ? null : v; };
      return sendXlsx(res, `${name}-${new Date().toISOString().slice(0, 10)}`, [{ name: cfg.label || name, rows: [cols.map(([h]) => h), ...rows.map(r => cols.map(([, k]) => val(r, k)))] }]);
    }
    const csv = toCsv(cols, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  r.get('/:id', requirePerm(name, 'read'), async (req, res) => {
    const row = await fetchOne(parseId(req.params.id));
    if (!row) throw notFound(`${cfg.label} not found`);
    if (cfg.decorate) await cfg.decorate([row], req);
    res.json(row);
  });

  r.post('/', requirePerm(name, 'write'), async (req, res) => {
    const data = cfg.schema.parse(req.body ?? {});
    const created = await db.transaction(async trx => {
      const row = cfg.prepare ? await cfg.prepare(data, trx, null, req) : data;
      if (cfg.createdBy) row.created_by = req.user.id;
      const [ins] = await trx(T).insert(dbRow(row)).returning('id');
      const newId = insertedId(ins);
      if (cfg.afterInsert) await cfg.afterInsert(newId, row, trx);
      if (cfg.afterSave) await cfg.afterSave(newId, row, trx, req, null);
      const saved = await fetchOne(newId, trx);
      await audit(req, 'create', name, newId, saved, trx);
      return saved;
    });
    if (cfg.decorate) await cfg.decorate([created], req);
    res.status(201).json(created);
  });

  r.put('/:id', requirePerm(name, 'write'), async (req, res) => {
    const id = parseId(req.params.id);
    const data = cfg.schema.parse(req.body ?? {});
    const updated = await db.transaction(async trx => {
      const existing = norm(await trx(T).where({ id }).first());
      if (!existing) throw notFound(`${cfg.label} not found`);
      const row = cfg.prepare ? await cfg.prepare(data, trx, existing, req) : data;
      row.updated_at = trx.fn.now();
      await trx(T).where({ id }).update(dbRow(row));
      if (cfg.afterSave) await cfg.afterSave(id, row, trx, req, existing);
      const saved = await fetchOne(id, trx);
      await audit(req, 'update', name, id, diff(existing, norm(dbRow(row))), trx);
      return saved;
    });
    if (cfg.decorate) await cfg.decorate([updated], req);
    res.json(updated);
  });

  r.delete('/:id', requirePerm(name, 'remove'), async (req, res) => {
    const id = parseId(req.params.id);
    await db.transaction(async trx => {
      const existing = norm(await trx(T).where({ id }).first());
      if (!existing) throw notFound(`${cfg.label} not found`);
      if (cfg.beforeDelete) await cfg.beforeDelete(existing, trx);
      await trx(T).where({ id }).del();
      if (cfg.afterDelete) await cfg.afterDelete(existing, trx);
      await audit(req, 'delete', name, id, existing, trx);
    });
    res.status(204).end();
  });

  return r;
}

export { badRequest };
