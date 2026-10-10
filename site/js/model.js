// Layer 1. Pure models over the app state: the axis catalogue, scales, the filter predicate and the colour modes.
// No DOM, no three, so it also runs with WebGL absent.
import { S, app, fin, niceStep } from './kernel.js';

// ---------------------------------------------------------------- axes the viewer can choose
export const AX = {
  pc1: { label: 'PC1', get: d => d.pc?.[0], dec: 1 },
  pc2: { label: 'PC2', get: d => d.pc?.[1], dec: 1 },
  pc3: { label: 'PC3', get: d => d.pc?.[2], dec: 1 },
  logp: { label: 'log P', unit: '', get: d => d.d.logp, dec: 1, long: 'log P (Crippen, RDKit)' },
  xlogp: { label: 'XLogP3', get: d => d.d.xlogp, dec: 1, long: 'XLogP3 (PubChem)' },
  ts1: { label: 'Structure map 1', get: d => d.ts?.[0], dec: 0, arbitrary: true, long: 'Structure map, t-SNE 1 (Morgan count fingerprints)' },
  ts2: { label: 'Structure map 2', get: d => d.ts?.[1], dec: 0, arbitrary: true, long: 'Structure map, t-SNE 2 (Morgan count fingerprints)' },
  mr: { label: 'MR', unit: 'cm³/mol', get: d => d.d.mr, dec: 0, long: 'Molar refractivity (cm³/mol)' },
  tpsa: { label: 'TPSA', unit: 'Å²', get: d => d.d.tpsa, dec: 0, long: 'Topological polar surface area (Å²)' },
  act: { label: 'pChEMBL', get: d => d.act?.p, dec: 1, long: 'Activity at the mechanism target (pChEMBL)' },
  mw: { label: 'MW', unit: 'Da', get: d => d.d.mw, dec: 0, long: 'Molecular weight (Da)' },
  hbd: { label: 'HBD', get: d => d.d.hbd, dec: 0, long: 'Hydrogen-bond donors (NH + OH)' },
  hba: { label: 'HBA', get: d => d.d.hba, dec: 0, long: 'Hydrogen-bond acceptors (N + O)' },
  rotb: { label: 'Rotatable bonds', get: d => d.d.rotb, dec: 0 },
  arom: { label: 'Aromatic rings', get: d => d.d.arom, dec: 0 },
  fsp3: { label: 'Fsp3', get: d => d.d.fsp3, dec: 2, long: 'Fraction of sp3 carbons' },
  cx: { label: 'Complexity', get: d => d.d.cx, dec: 0, long: 'PubChem complexity' },
  none: { label: 'Flat (no axis)', pseudo: true },
  jitter: { label: 'Random spread (no meaning)', pseudo: true, get: d => d._jit },
};
export const axLong = k => AX[k].long || AX[k].label;

// ---------------------------------------------------------------- scales
/** Nice-tick linear scale from the values of `list` on axis `key`, mapped onto [-S, S]. */
export function makeScale(key, list) {
  if (key === 'none') return { pseudo: true, map: () => -S };
  if (key === 'jitter') return { pseudo: true, map: v => v * S * 0.3 };
  const vals = list.map(AX[key].get).filter(fin);
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, 5);
  lo = Math.floor(lo / step + 1e-9) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, step, ticks, map: v => ((v - lo) / (hi - lo)) * 2 * S - S };
}

// ---------------------------------------------------------------- filter
/**
 * Does drug `d` pass the current view's filters? `axes` also requires a value on each chosen axis; `ignoreSize` skips the
 * 1000 Da filter (to count what that filter alone removes, without touching the view).
 */
export function passes(d, axes = true, ignoreSize = false) {
  const v = app.view;
  if (v.l1 && !d.atc.some(a => a.code.startsWith(v.l1))) return false;
  if (v.l2 && !d.atc.some(a => a.code.startsWith(v.l2))) return false;
  if (v.l3 && !d.atc.some(a => a.code.startsWith(v.l3))) return false;
  if (v.route && !d.routes.includes(v.route)) return false;
  if (v.small && !ignoreSize && !(d.d.mw <= app.hansch.max_mw)) return false;
  if (v.group && !app.groups.get(v.group)?.cids.has(d.cid)) return false;
  if (axes) for (const k of [v.x, v.y, v.z]) if (!AX[k].pseudo && !fin(AX[k].get(d))) return false;
  return true;
}

// ---------------------------------------------------------------- colour modes (at most three categorical hues)
export const ACT_EDGES = [6, 7, 8, 9];
export function l1sOf(d) { return [...new Set(d.atc.map(a => a.code[0]))]; }
/** Token colour of drug `d` under the current colour mode. */
export function colorOf(d) {
  const v = app.view, T = app.tokens;
  switch (v.color) {
    case 'atc': {
      const mine = l1sOf(d), slot = v.atc.findIndex(c => c && mine.includes(c));
      return slot >= 0 ? T['s' + (slot + 1)] : T.point;
    }
    case 'oral': return !d.routes.length ? T.point : d.routes.includes('ORAL') ? T.s1 : T.s2;
    case 'act': {
      if (!d.act) return T.point;
      return T['q' + (1 + ACT_EDGES.filter(e => d.act.p >= e).length)];
    }
    case 'ro5': return d.d.ro5 == null ? T.point : T[['q2', 'q4', 'q5'][Math.min(2, d.d.ro5)]];
    default: return T.s1;
  }
}
