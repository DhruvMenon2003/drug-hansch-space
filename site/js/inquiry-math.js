// Display-space calculations only. Never fit a model or alter scientific records.
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function nearestInMap(rows, anchor, axes, count = 5) {
  if (!anchor || !axes.length || axes.some(get => !finite(get(anchor)))) return [];
  const complete = rows.filter(d => axes.every(get => finite(get(d))));
  const ranges = axes.map(get => {
    const values = complete.map(get);
    return Math.max(...values) - Math.min(...values) || 1;
  });
  return complete.filter(d => d.cid !== anchor.cid).map(d => ({ d, distance: axes.reduce((sum, get, i) => sum + ((get(d) - get(anchor)) / ranges[i]) ** 2, 0) }))
    .sort((a, b) => a.distance - b.distance || a.d.cid - b.d.cid).slice(0, count).map(o => o.d);
}
export function sliceSummary(rows, threshold) {
  const out = { below: 0, above: 0, missing: 0, oralBelow: 0, knownRouteBelow: 0, total: rows.length };
  for (const d of rows) {
    if (!finite(d.d?.tpsa)) { out.missing++; continue; }
    if (d.d.tpsa > threshold) { out.above++; continue; }
    out.below++;
    if (d.routes?.length) out.knownRouteBelow++;
    if (d.routes?.includes('ORAL')) out.oralBelow++;
  }
  return out;
}
