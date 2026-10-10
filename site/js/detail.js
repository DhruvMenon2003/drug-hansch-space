// Layer 2. The drug detail panel (identifiers, descriptors, activity, ATC) and the 2D depiction. The 3D conformer is
// drawn by the GL layer, which listens to the same `selection` event.
import { app, bus, ORDER, $, cap, esc, fin, fx, fmtConc, isDark } from './kernel.js';
import { announce } from './announce.js';

/** SmilesDrawer depiction of `d` into #d-2d; a no-op when the vendored library is missing. */
export function drawDepiction(d) {
  const host = $('#d-2d');
  host.innerHTML = '';
  if (!window.SmilesDrawer || !d.smiles) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `2D structure of ${d.name}`);
  host.appendChild(svg);
  const drawer = new SmilesDrawer.SvgDrawer({ width: 360, height: 240, bondThickness: 1.1, padding: 12, compactDrawing: false });
  SmilesDrawer.parse(d.smiles, tree => {
    try { drawer.draw(tree, svg, isDark() ? 'dark' : 'light'); svg.removeAttribute('style'); }
    catch { host.textContent = '2D depiction not available for this structure.'; }
  }, () => { host.textContent = '2D depiction not available for this structure.'; });
}

// The selected drug may be filtered out of the current view (the ring then disappears from the plot): say so in the panel
// and to screen readers, once per change of state.
let outAnnounced = null;
function noteEl() {
  let el = $('#d-note');
  if (!el) {
    el = document.createElement('p');
    el.id = 'd-note';
    el.className = 'flags';
    el.setAttribute('role', 'note');
    $('#detail-body .drug-head')?.after(el);
  }
  return el;
}
function updateViewNote() {
  if (app.selected < 0 || $('#detail-body').hidden) return;
  const d = app.drugs[app.selected], out = !app.visible.includes(d);
  noteEl().textContent = out ? `${cap(d.name)} is not in the current view: the filters or the chosen axes leave it out.` : '';
  if (out && outAnnounced !== d) announce(`${cap(d.name)} is not in the current view.`);
  outAnnounced = out ? d : null;
}

function showDetail({ index }) {
  const d = app.drugs[index];
  $('#detail-empty').hidden = true;
  $('#detail-body').hidden = false;
  $('#d-name').textContent = d.name;
  const pc = `https://pubchem.ncbi.nlm.nih.gov/compound/${d.pcid}`;
  $('#d-ids').innerHTML = `<a href="${pc}" target="_blank" rel="noopener">PubChem CID ${d.pcid}</a>` +
    (d.pcid !== d.cid ? ` (dataset CID ${d.cid})` : '') +
    (d.chembl ? ` · <a href="https://www.ebi.ac.uk/chembl/compound_report_card/${esc(d.chembl)}/" target="_blank" rel="noopener">${esc(d.chembl)}</a>` : '') +
    `<br>${esc(d.ik || '')}${d.d.formula ? ' · ' + esc(d.d.formula) : ''}`;
  const D = d.d, kv = (k, v, small = '') => `<div><dt>${k}</dt><dd>${v}${small ? ` <small>${small}</small>` : ''}</dd></div>`;
  $('#d-desc').innerHTML = [
    kv('log P', fx(D.logp, 2), fin(D.xlogp) ? `Crippen; XLogP3 ${fx(D.xlogp, 2)}` : 'Crippen'),
    kv('MR', fx(D.mr, 1), 'cm³/mol'), kv('TPSA', fx(D.tpsa, 1), 'Å²'), kv('MW', fx(D.mw, 1), 'Da'),
    kv('H-bond donors', D.hbd ?? '–'), kv('H-bond acceptors', D.hba ?? '–'), kv('Rotatable bonds', D.rotb ?? '–'),
    kv('Aromatic rings', D.arom ?? '–'), kv('Fsp3', fx(D.fsp3, 2)), kv('Complexity', fx(D.cx, 0), 'PubChem'),
    kv('Rule-of-five violations', D.ro5 ?? '–'), kv('Formal charge', D.charge ?? '–'),
  ].join('');
  const a = d.act;
  $('#d-act').innerHTML = a
    ? `<div class="act-box"><span class="big">${fx(a.p, 2)}</span> pChEMBL <small>(about ${fmtConc(a.p)})</small><br>` +
      `at <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(a.target)}/" target="_blank" rel="noopener">${esc(a.target)}</a> ${esc(a.tname || '')}` +
      `<br><small>Median of ${esc(a.types || 'IC50/Ki/EC50/Kd')} values from ${a.ndoc ?? '≥2'} ChEMBL documents.</small></div>`
    : `<div class="act-box">No activity value: fewer than two ChEMBL documents agreed on a pChEMBL at the mechanism target.</div>`;
  const names = app.meta.atc_names;
  $('#d-atc').innerHTML = d.atc.map(e => {
    const path = [e.code[0], e.code.slice(0, 3), e.code.slice(0, 4), e.code.slice(0, 5)].filter(c => names[c]).map(c => cap(names[c])).join(' › ');
    return `<li><span class="atc-code">${esc(e.code)}</span> <span class="atc-path">${esc(path)}</span><br>${e.routes.length ? e.routes.map(r => `<span class="route">${esc(cap(r))}</span>`).join('') : '<span class="route">No route listed</span>'}</li>`;
  }).join('');
  $('#d-flags').textContent = d.flags.length ? 'Curation notes: ' + d.flags.join('; ') + '.' : '';
  $('#d-src').textContent = d.conf ? d.conf : 'No 3D conformer';
  drawDepiction(d);
  outAnnounced = null;
  updateViewNote();
}

/** Show the panel on `selection`; redraw the depiction when the theme changes. */
export function initDetail() {
  bus.on('selection', showDetail);
  bus.on('layout', updateViewNote, ORDER.UI);
  bus.on('theme', () => { if (app.selected >= 0) drawDepiction(app.drugs[app.selected]); });
}
