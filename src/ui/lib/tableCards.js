/**
 * Phones show tables with class "table-cards" as stacked cards; each cell needs a data-label
 * (its column name) for that. This fills in missing labels from the table's header row,
 * taking colSpan into account, and keeps doing so as pages re-render.
 */
function labelTable(table) {
  const heads = [...(table.tHead?.rows[0]?.cells || [])].flatMap(th => Array(th.colSpan || 1).fill(th.textContent.trim()));
  if (!heads.length) return;
  for (const body of [...table.tBodies, ...(table.tFoot ? [table.tFoot] : [])]) {
    for (const row of body.rows) {
      let col = 0;
      for (const cell of row.cells) {
        if (!cell.hasAttribute('data-label') && heads[col]) cell.setAttribute('data-label', heads[col]);
        col += cell.colSpan || 1;
      }
    }
  }
}

export function watchTableCards(root) {
  const run = () => root.querySelectorAll('table.table-cards').forEach(labelTable);
  run();
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(); });
  });
  obs.observe(root, { childList: true, subtree: true });
  return () => obs.disconnect();
}
