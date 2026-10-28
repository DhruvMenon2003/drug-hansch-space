// Layer 3. The data table: the accessible, non-pointer view of the scatter (the drugs in the current view with their axis values).
import { app, bus, ORDER, $, cap, esc, fx, getSide } from './kernel.js';
import { AX } from './model.js';
import { selectDrug } from './view.js';


// ---- The side data the table and the QED panel load on first use (data/props.json, data/cohort_A02BA.json). ----
// None of it is fetched on the first load.
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


/**
 * The columns behind "Extra columns": QED for every drug (data/props.json) and, for the drugs the H2-antagonist cohort
 * covers, a therapeutic index and a free concentration for each administration mode (data/cohort_A02BA.json). Both files
 * load on the first tick of the box, so neither is in the first load. A drug a file does not cover shows a dash.
 */
const EXTRA = [
  { key: 'qed', label: 'QED', dec: 2, get: d => side.qed.get(d.cid), note: () => side.defs.get('qed')?.long },
  { key: 'ti', label: 'Therapeutic index', dec: 2, get: (d, mode) => sideRow(d.cid, mode)?.ti, note: () => side.formulas.therapeutic_index },
  { key: 'fc', label: 'Free drug', dec: 1, get: (d, mode) => sideRow(d.cid, mode)?.free_conc, note: () => side.formulas.free_concentration },
];
/** The sort the reader chose. The default is the name, ascending, which is the order the table has always had. */
let sort = { key: 'name', dir: 1 };

/** The columns of the table as it is configured now: the axes always, the mode when the rows are split, the extras on request. */
function columns({ permode, extra }) {
  const v = app.view, ax = ['x', 'y', 'z'].filter(a => !AX[v[a]].pseudo);
  return [
    { key: 'name', label: 'Drug', text: e => esc(cap(e.d.name)) },
    ...(permode ? [{ key: 'mode', label: 'Mode', text: e => esc(cap(e.mode)) || '–' }] : []),
    { key: 'atc', label: 'ATC', text: e => esc(e.d.atc[0]?.code || '') },
    ...ax.map(a => ({ key: a, label: AX[v[a]].label, note: AX[v[a]].long, num: e => AX[v[a]].get(e.d), dec: AX[v[a]].dec })),
    { key: 'act', label: 'pChEMBL', note: AX.act.long, num: e => e.d.act?.p, dec: 1 },
    ...(extra ? EXTRA.map(c => ({ key: c.key, label: c.label, note: c.note(), num: e => c.get(e.d, e.mode), dec: c.dec })) : []),
  ];
}

/** One entry per row: a drug, and the administration mode the row stands for (empty when the rows are not split). */
function entries({ permode, mode }) {
  const out = [];
  for (const d of app.visible) {
    if (!permode) { if (!mode || d.routes.includes(mode)) out.push({ d, mode: '' }); continue; }
    for (const m of modesOf(d)) if (!mode || m === mode) out.push({ d, mode: m });
  }
  return out;
}

/** Rebuild the table from app.visible and the current axes. */
export function renderTable() {
  const extra = !!$('#t-extra')?.checked && side.ready, permode = !!$('#t-permode')?.checked, mode = $('#t-mode')?.value || '';
  const cols = columns({ permode, extra }), rows = entries({ permode, mode });
  const by = cols.find(c => c.key === sort.key) || cols[0];
  rows.sort((a, b) => sort.dir * (by.num
    ? ((x, y) => (Number.isFinite(x) ? (Number.isFinite(y) ? x - y : -1) : Number.isFinite(y) ? 1 : 0))(by.num(a), by.num(b))
    : by.text(a).localeCompare(by.text(b))) || a.d.name.localeCompare(b.d.name));
  $('#table thead').innerHTML = `<tr>${cols.map(c => `<th scope="col" data-sort="${c.key}" tabindex="0" aria-sort="${c.key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"${c.note ? ` title="${esc(c.note)}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>`;
  $('#table tbody').innerHTML = rows.map(e => `<tr data-cid="${e.d.cid}"${e.mode ? ` data-mode="${esc(e.mode)}"` : ''} tabindex="0" aria-current="${app.drugs[app.selected]?.cid === e.d.cid}">${cols.map(c => `<td>${c.num ? fx(c.num(e), c.dec) : c.text(e)}</td>`).join('')}</tr>`).join('');
  tableNote(extra, rows.length);
}

/** The line above the table: what the extra columns came from, and what is missing. */
function tableNote(extra, n) {
  const el = $('#t-note');
  if (!el) return;
  if (!extra) { el.textContent = ''; el.hidden = true; return; }
  const miss = side.missing.length ? ` Not loaded: ${side.missing.join(', ')}.` : '';
  el.hidden = false;
  el.textContent = `${n} rows. QED from data/props.json; the therapeutic index and the free concentration come from the H2-antagonist cohort (data/cohort_A02BA.json), so every other drug shows a dash.${miss}`;
}

/** Bind the table's listeners and keep it in step with layout and selection. Runs last on `layout`, as it always did. */
export function initTable() {
  $('#table').addEventListener('click', e => { const tr = e.target.closest('tr[data-cid]'); if (tr) selectDrug(+tr.dataset.cid); });
  $('#table').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-cid]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectDrug(+tr.dataset.cid); } });
  $('#table-details').addEventListener('toggle', () => { if ($('#table-details').open) renderTable(); });
  bus.on('layout', () => { if ($('#table-details').open) renderTable(); }, ORDER.LATE);
  bus.on('selection', ({ cid }) => document.querySelectorAll('#table tbody tr').forEach(tr => tr.setAttribute('aria-current', +tr.dataset.cid === cid)));
  // sorting: a heading is its own control, so it answers the pointer and the keyboard alike
  const resort = th => { const k = th.dataset.sort; if (!k) return; sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; renderTable(); };
  $('#table').addEventListener('click', e => { const th = e.target.closest('th[data-sort]'); if (th) resort(th); });
  $('#table').addEventListener('keydown', e => { const th = e.target.closest('th[data-sort]'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); resort(th); } });
  // the extra columns and the per-mode rows: both default to off, so the table opens exactly as it did
  const modes = [...new Set(app.drugs.flatMap(d => d.routes))].sort();
  $('#t-mode').innerHTML = '<option value="">All modes</option>' + modes.map(m => `<option value="${esc(m)}">${esc(cap(m))}</option>`).join('');
  $('#t-mode').addEventListener('change', renderTable);
  $('#t-permode').addEventListener('change', () => { if ($('#t-permode').checked) loadSide().then(renderTable); else renderTable(); });
  $('#t-extra').addEventListener('change', () => {
    if (!$('#t-extra').checked) { renderTable(); return; }
    $('#t-note').hidden = false;
    $('#t-note').textContent = 'Loading the extra columns…';
    loadSide().then(renderTable);
  });
}

// ---- The two panels that are not part of the first load: the QED distributions and the ligand-binding overlay. ----
// Their modules are imported on first use. The specifiers are assembled rather than written as literals so they stay
// outside the module graph the build preloads (tools/check_site.py reads the literals).
const QED_MOD = 'qed.js', BIND_MOD = 'binding.js', SCAF_MOD = 'clusters.js';
let qed = null, binding = null, clusters = null;

/** Import and start the QED panel on first use. Later calls hand back the same module. */
export function openQed() {
  qed ||= import(`./${QED_MOD}`).then(m => { m.initQed(); return m; });
  return qed;
}

/** Import and start the scaffold cluster panel on first use. Later calls hand back the same module. */
export function openClusters() {
  clusters ||= import(`./${SCAF_MOD}`).then(m => { m.initClusters(); return m; });
  return clusters;
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
  const scaf = $('#scaf-details');
  scaf?.addEventListener('toggle', () => { if (scaf.open) openClusters(); });
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
