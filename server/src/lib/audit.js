import { db } from '../db.js';
import { log } from './util.js';

/** Append-only audit trail of who changed what. Never throws (an audit failure must not break the request). */
export async function audit(req, action, entity = null, entityId = null, details = null, trx = db) {
  try {
    let text = details == null ? null : JSON.stringify(details);
    if (text && text.length > 20000) text = text.slice(0, 20000) + '…';
    await trx('audit_logs').insert({
      user_id: req?.user?.id ?? null,
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      details: text,
      ip: req?.ip ?? null,
      created_at: Date.now(),
    });
  } catch (e) {
    log.error('audit write failed', { err: e.message });
  }
}

/** Only the fields that changed, for compact update logs. */
export function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (['updated_at', 'created_at'].includes(k)) continue;
    const a = before?.[k], b = after[k];
    if (String(a ?? '') !== String(b ?? '') && !(Number.isFinite(+a) && Number.isFinite(+b) && +a === +b && a !== '' && b !== '')) {
      out[k] = { from: a ?? null, to: b ?? null };
    }
  }
  return out;
}
