// Layer 1. Fetching and indexing the data files. No DOM, no three.
import { app } from './kernel.js';

/** GET a JSON file of this site. `no-cache` = always revalidate (a cheap 304 when unchanged): GitHub Pages sends max-age=600, and
 * a redeploy must not leave this page with new code and old data for ten minutes. Throws an Error naming the file and status. */
async function getJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

/** Fetch drugs.json and hansch.json, fill the app state and the lookup tables. Rejects with a readable Error on a bad response. */
export async function loadData() {
  const [dj, hj] = await Promise.all(['data/drugs.json', 'data/hansch.json'].map(getJson));
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

// ---------------------------------------------------------------- conformer shards
/** Number of conformer shards: data/mol/<cid % MOL_SHARDS>.json (tools/shard_molecules.py writes them; tools/check_site.py checks the two agree). */
export const MOL_SHARDS = 32;
/** @param {number} cid dataset CID @returns {number} shard number */
export const molShardOf = cid => ((Number(cid) % MOL_SHARDS) + MOL_SHARDS) % MOL_SHARDS;

/** shard number -> Promise of its {cid: conformer} object. Only successful loads stay in here. */
const shards = new Map();

function loadShard(n) {
  let p = shards.get(n);
  if (!p) {
    p = getJson(`data/mol/${n}.json`);
    shards.set(n, p);
    // a failed fetch (network error, non-2xx, bad JSON) must not be replayed to every later caller: forget it, so the next call retries
    p.catch(() => { if (shards.get(n) === p) shards.delete(n); });
  }
  return p;
}

/**
 * The 3D conformer of one drug, from its shard only (about 10 to 17 KB gzip), fetched at most once per shard. Resolves to
 * undefined for a drug that has none. A drug the data says has no conformer (`conf` empty) costs no request at all. Rejects
 * on a failed fetch; the failure is not remembered, so calling again retries.
 * @param {number} cid dataset CID of the drug
 * @returns {Promise<{ z: number[], xyz: number[], b: number[], src: string } | undefined>}
 */
export async function loadMolecule(cid) {
  const d = app.byCid.get(cid);
  if (d && !d.conf) return undefined;
  const shard = await loadShard(molShardOf(cid));
  return shard[String(cid)];
}

/** Forget every loaded shard (tests; a long-lived tab that wants fresh data). */
export function clearMoleculeCache() { shards.clear(); }
