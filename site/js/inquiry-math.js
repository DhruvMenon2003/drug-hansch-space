// Display-space calculations only. Never fit a model or alter scientific records.
const finite = v => typeof v === 'number' && Number.isFinite(v);
// Verified upstream name–structure mismatch; source bytes remain untouched.
export const identityWarning = d => d?.cid === 6918250 ? 'Identity mapping needs review: the stored name links to an antibody in ChEMBL, while this map uses a small-molecule PubChem structure. Its position and neighbours do not describe validated ofatumumab chemistry.' : '';
export function focusExtent(rows, get) {
  const values = rows.map(get).filter(finite);
  if (!values.length) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const padding = (hi - lo) * 0.15 || Math.max(Math.abs(lo) * 0.05, 0.5);
  return { lo: lo - padding, hi: hi + padding };
}
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
