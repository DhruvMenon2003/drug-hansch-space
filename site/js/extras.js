// Layer 1. The side data and the two panels that are not part of the first load: the QED distributions and the ligand-binding
// overlay. Their JSON is fetched on first use and their modules are imported on first use, so neither appears in the preload
// block nor in the first-load budget. The specifiers are assembled here rather than written as literals, for the same reason
// js/detail.js loads SmilesDrawer with a script element: these two are deliberately outside the module graph the build
// preloads (tools/check_site.py reads the literals).
import { app, $ } from './kernel.js';

const QED_MOD = 'qed.js', BIND_MOD = 'binding.js';
const json = new Map();                 // url -> Promise of the parsed file, one request per file per page

/** Fetch and parse `url` once; the same promise is handed to every later caller. Rejects like fetch does. */
export function getSide(url) {
  if (!json.has(url)) json.set(url, fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url}: HTTP ${r.status}`)))));
  return json.get(url);
}

/**
 * The derived columns the data table offers on request: QED for every drug (data/props.json) and, for the H2-antagonist
 * cohort, a therapeutic index and a free concentration per administration mode (data/cohort_A02BA.json). Both files are
 * optional: when one is missing its columns stay empty and the table says so.
 */
export const side = { ready: false, qed: new Map(), rows: new Map(), modes: new Map(), defs: new Map(), formulas: {}, missing: [] };
let sidePromise = null;

const modeKey = (cid, route) => `${cid}|${route}`;

/** Load and index the side columns once. Resolves to `side` whether or not every file arrived. */
export function loadSide() {
  if (sidePromise) return sidePromise;
  sidePromise = Promise.all([
    getSide('data/props.json').then(p => {
      for (const d of p.defs) side.defs.set(d.key, d);
      p.cids.forEach((cid, i) => side.qed.set(cid, p.cols.qed[i]));
    }).catch(() => side.missing.push('data/props.json')),
    getSide('data/cohort_A02BA.json').then(c => {
      side.formulas = c.meta.formulas || {};
      for (const r of c.rows) {
        const route = r.route && r.route !== 'NaN' ? r.route : '';
        side.rows.set(modeKey(r.cid, route), r);
        const seen = side.modes.get(r.cid) || [];
        if (!seen.includes(route)) seen.push(route);
        side.modes.set(r.cid, seen);
      }
    }).catch(() => side.missing.push('data/cohort_A02BA.json')),
  ]).then(() => { side.ready = true; return side; });
  return sidePromise;
}

/** The cohort row for one drug and one administration mode, or the drug's only row when the mode is not broken out. */
export function sideRow(cid, route = '') {
  return side.rows.get(modeKey(cid, route)) || (side.modes.get(cid)?.length === 1 ? side.rows.get(modeKey(cid, side.modes.get(cid)[0])) : null);
}

/** The administration modes a drug is listed under: the cohort's own rows when it has them, else its ATC routes. */
export function modesOf(d) {
  const rows = side.modes.get(d.cid);
  return rows && rows.length ? rows : d.routes.length ? d.routes : [''];
}

let qed = null, binding = null;

/** Import and start the QED panel on first use. Later calls hand back the same module. */
export function openQed() {
  qed ||= import(`./${QED_MOD}`).then(m => { m.initQed(); return m; });
  return qed;
}

/** Import and start the binding overlay on first use, then toggle it. Needs WebGL; without it the button says so. */
export function toggleBinding() {
  binding ||= import(`./gl/${BIND_MOD}`).then(m => { m.initBinding(); return m; });
  return binding.then(m => m.toggleOverlay()).catch(err => {
    console.error('the binding overlay did not load', err);
    const note = $('#d-bind-note');
    if (note) note.textContent = 'The binding overlay could not be loaded.';
  });
}

/**
 * Wire the two lazy panels from the first load: opening the QED panel loads it, and the B key and the drug panel's button
 * open the overlay. Everything heavy stays behind these two listeners.
 */
export function initExtras({ gl = true } = {}) {
  const det = $('#qed-details');
  det?.addEventListener('toggle', () => { if (det.open) openQed(); });
  const btn = $('#d-bind');
  if (!gl) { if (btn) { btn.disabled = true; btn.title = 'The binding overlay needs WebGL.'; } return; }
  btn?.addEventListener('click', () => toggleBinding());
  document.addEventListener('keydown', e => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;   // typing a b is typing a b
    if (app.selected < 0) return;
    e.preventDefault();
    toggleBinding();
  });
}
