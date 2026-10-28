// Layer 3. The scaffold cluster panel: the Bemis–Murcko families of the drugs in the current view, each drawn as its own
// framework, with the drugs that share it. Clicking a family colours those drugs in the 3D scatter, so a chemical series
// can be found in Hansch space instead of only in a list. Loaded on first open (js/table.js), so neither this module nor
// data/scaffolds.json is part of the first load.
//
// The families come from tools/build_scaffolds.py: RDKit MurckoScaffold on the standardised structure (Bemis and Murcko,
// J. Med. Chem. 1996, 39, 2887), the same scaffold the QSAR target sets carry, so a drug and its ChEMBL measurements fall
// in the same family. A family of one drug is not a cluster, so the list shows only the shared ones.
import { app, bus, ORDER, $, esc, isDark, getSide } from './kernel.js';
import { announce } from './announce.js';
import { passes } from './model.js';
import { loadSmilesDrawer } from './detail.js';
import { whenIdle } from './idle.js';

/** How many families the list draws at once; the rest are counted in the note under it. */
const SHOWN = 24;
/** Drawing box of one framework depiction, in the SVG's own units. */
const PIC_W = 132, PIC_H = 92;

let data = null, started = false;
/** The highlighted family: `{ i, n, smiles }` of the row that is on, or null. */
let focus = null;
const pics = new Map();           // `${smiles}|${dark}` -> finished <svg>, redrawn when the theme changes
let cancelPics = () => {};

/** cid -> family index, as the data file has it (string keys in JSON). */
const famOf = d => data.by_cid[String(d.cid)];

/** family index -> the drugs in it, over the whole dataset. */
function members() {
  const m = new Map();
  for (const d of app.drugs) {
    const k = famOf(d);
    if (k == null) continue;
    let list = m.get(k);
    if (!list) m.set(k, (list = []));
    list.push(d);
  }
  return m;
}

/**
 * The shared families with at least one drug in view, largest first: `n` is the family over the whole dataset, `k` how
 * many of its drugs the current view shows.
 */
function ranked(list) {
  const seen = new Map();
  for (const d of list) { const k = famOf(d); if (k != null) seen.set(k, (seen.get(k) || 0) + 1); }
  return data.families
    .filter(f => f.smiles && seen.get(f.i))
    .map(f => ({ ...f, k: seen.get(f.i) }))
    .sort((a, b) => b.k - a.k || b.n - a.n);
}

/** One row: the framework's depiction, a bar of its size, and the drugs that share it. */
function row(f, top, mem) {
  const names = (mem.get(f.i) || []).map(d => d.name);
  const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
  const w = Math.max(2, (f.k / top) * 100);
  return `<button type="button" class="scaf-row" data-i="${f.i}" aria-pressed="${focus?.i === f.i}">
      <span class="scaf-pic" data-smiles="${esc(f.smiles)}" aria-hidden="true"></span>
      <span class="scaf-body">
        <span class="scaf-top"><span class="scaf-n">${f.k} in view</span><span class="scaf-all">${f.n} in all</span></span>
        <span class="scaf-bar"><span style="width:${w.toFixed(1)}%"></span></span>
        <span class="scaf-who">${esc(shown)}</span>
      </span>
    </button>`;
}

/** Redraw the list, the note and the Clear button from the current view. */
export function renderClusters() {
  if (!data) return;
  const list = app.drugs.filter(d => passes(d));
  const fams = ranked(list), mem = members(), top = fams[0]?.k || 1;
  const host = $('#scaf-list');
  host.innerHTML = fams.slice(0, SHOWN).map(f => row(f, top, mem)).join('')
    || '<p class="small">No two drugs in this view share a scaffold.</p>';
  $('#scaf-clear').disabled = !focus;
  note(list, fams);
  paintPics();
}

/** The line under the list: what is highlighted, or what the list is showing. */
function note(list, fams) {
  const el = $('#scaf-note');
  if (focus) {
    el.textContent = `Highlighting the ${focus.n} drugs built on this framework. Click the family again to clear the highlight.`;
    return;
  }
  const more = Math.max(0, fams.length - SHOWN);
  const singles = list.length - fams.reduce((s, f) => s + f.k, 0);
  el.textContent = `${fams.length} scaffold${fams.length === 1 ? '' : 's'} shared by two or more of the ${list.length} drugs in view`
    + `${more ? `, the ${SHOWN} largest drawn here` : ''}; ${singles} drug${singles === 1 ? '' : 's'} carry a framework of their own.`
    + ' Click a family to colour its drugs in 3D.';
}

/**
 * Draw the frameworks that are on screen but not yet drawn, one idle callback each (a scaffold is a small molecule: a
 * couple of milliseconds). A newer render, a theme change or a closed panel abandons whatever is still queued.
 */
function paintPics() {
  cancelPics();
  const hosts = [...document.querySelectorAll('.scaf-pic')].filter(h => !h.firstChild);
  if (!hosts.length) return;
  let stop = false;
  cancelPics = () => { stop = true; };
  const dark = isDark() ? 1 : 0;
  for (const host of hosts) {
    const smiles = host.dataset.smiles, key = `${smiles}|${dark}`, hit = pics.get(key);
    if (hit) { host.replaceChildren(hit.cloneNode(true)); continue; }
    whenIdle(async () => {
      if (stop || host.firstChild) return;
      let SD;
      try { SD = await loadSmilesDrawer(); } catch { return; }
      if (stop || host.firstChild) return;
      whenIdle(() => {
        if (stop || host.firstChild) return;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const drawer = new SD.SvgDrawer({ width: PIC_W, height: PIC_H, bondThickness: 1, padding: 6, compactDrawing: false, terminalCarbons: false });
        SD.parse(smiles, tree => {
          try {
            drawer.draw(tree, svg, dark ? 'dark' : 'light');
            svg.removeAttribute('style');
            pics.set(key, svg.cloneNode(true));
            if (!stop && !host.firstChild) host.appendChild(svg);
          } catch { /* a framework SmilesDrawer cannot lay out simply has no picture */ }
        }, () => {});
      }, { timeout: 1500 });
    }, { timeout: 1500 });
  }
}

/** Highlight a family's drugs in the scatter, or clear the highlight when it is already on. */
function pick(i) {
  const f = data.families.find(x => x.i === i);
  if (!f) return;
  if (focus?.i === i) { clearFocus(); return; }
  focus = { i, n: f.n, smiles: f.smiles };
  app.scafFocus = new Set(app.drugs.filter(d => famOf(d) === i).map(d => d.cid));
  bus.emit('recolor');
  renderClusters();
  announce(`${app.scafFocus.size} drugs on this scaffold are highlighted in the 3D view.`);
}

/** Drop the scaffold highlight; every filter and the colour mode stand as they were. */
export function clearFocus() {
  if (!focus) return;
  focus = null;
  app.scafFocus = null;
  bus.emit('recolor');
  renderClusters();
}

/** Build the panel on its first open: load data/scaffolds.json, then bind the rows. */
export function initClusters() {
  if (started) return;
  started = true;
  const host = $('#scaf-list');
  host.innerHTML = '<p class="small">Loading the scaffolds…</p>';
  getSide('data/scaffolds.json').then(j => {
    data = j;
    $('#scaf-cite').textContent = j.method || '';
    renderClusters();
  }).catch(() => { host.innerHTML = '<p class="small">The scaffold file (data/scaffolds.json) could not be loaded, so this panel is empty.</p>'; });

  host.addEventListener('click', e => {
    const b = e.target.closest('.scaf-row');
    if (b && data) pick(+b.dataset.i);
  });
  $('#scaf-clear').addEventListener('click', () => clearFocus());
  bus.on('layout', () => { if ($('#scaf-details')?.open) renderClusters(); }, ORDER.LATE);
  bus.on('theme', () => { if ($('#scaf-details')?.open) { pics.clear(); document.querySelectorAll('.scaf-pic').forEach(h => h.replaceChildren()); paintPics(); } });
}
