// Layer 1. Fetching and indexing the data files. No DOM, no three.
import { app } from './kernel.js';

/** Fetch drugs.json and hansch.json, fill the app state and the lookup tables. Rejects with a readable Error on a bad response. */
export async function loadData() {
  const [dj, hj] = await Promise.all(['data/drugs.json', 'data/hansch.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })));
  app.meta = dj.meta;
  app.drugs = dj.drugs;
  app.hansch = hj;
  for (const d of app.drugs) { d._jit = (Math.imul(d.cid, 2654435761) >>> 0) / 2 ** 32 * 2 - 1; app.byCid.set(d.cid, d); }
  for (const g of hj.groups) app.groups.set(g.id, { fit: g, cids: new Set(g.points.map(p => p.cid)) });
  // the tour's one-target example: glucocorticoid receptor if it is there and fits at all, otherwise the best q² with n >= 8
  const cands = hj.groups.filter(g => g.id !== 'ALL');
  const gr = cands.find(g => g.id === 'CHEMBL2034' && g.q2 >= 0.3);
  app.seriesId = (gr || [...cands].filter(g => g.n >= 8).sort((a, b) => b.q2 - a.q2)[0] || cands[0])?.id ?? 'ALL';
}

/**
 * The conformer file, fetched once. A failed fetch (network error, non-2xx) rejects but is not remembered, so the
 * next call retries instead of replaying the failure.
 * @returns {Promise<Record<string, any>>}
 */
export function loadMolecules() {
  if (!app.molsPromise) {
    const p = fetch('data/molecules.json')
      .then(r => { if (!r.ok) throw new Error(`data/molecules.json: ${r.status}`); return r.json(); })
      .then(m => (app.mols = m));
    app.molsPromise = p;
    p.catch(() => { if (app.molsPromise === p) app.molsPromise = null; });
  }
  return app.molsPromise;
}
