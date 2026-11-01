// Layer 3. One persistent identity across the existing maps; all filters remain owned by Explore.
import { app, bus, $, cap, esc, fx, ORDER } from './kernel.js';
import { AX } from './model.js';
import { isSheetMode } from './layout.js';
import { setView, selectDrug } from './view.js';
import { nearestInMap, sliceSummary, identityWarning } from './inquiry-math.js';
import { renderProjection } from './inquiry-projection.js';
import { initPair } from './inquiry-pair.js';
import { loadSmilesDrawer } from './detail.js';

const outwardArrow = '<svg class="inquiry-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 15 15 5M5 5h10v10"/></svg>';
const forwardArrow = '<svg class="inquiry-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10h14m-6-6 6 6-6 6"/></svg>';

const MAPS = {
  properties: { axes: ['logp', 'tpsa', 'mr'], camera: 'tpsa', label: 'Physicochemical properties', note: 'Neighbours in logP, TPSA and molar refractivity. Similar properties need not mean similar structures or biological effects.' },
  structure: { axes: ['ts1', 'none', 'ts2'], camera: 'structure', label: 'Fingerprint map', note: 'Local neighbours in the frozen t-SNE map of Morgan fingerprints. Map distance is not fingerprint similarity; distant clusters cannot be compared quantitatively.' },
  pca: { axes: ['pc1', 'pc2', 'pc3'], camera: 'space', label: 'Descriptor overview', note: 'Neighbours in the first three frozen principal components. These summarise descriptor variation, not binding geometry.' },
};
const recordLinks = d => `<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${d.pcid || d.cid}" target="_blank" rel="noopener noreferrer">PubChem structure ${d.pcid || d.cid} ${outwardArrow}</a>${d.chembl ? `<a href="https://www.ebi.ac.uk/chembl/compound_report_card/${esc(d.chembl)}/" target="_blank" rel="noopener noreferrer">${esc(d.chembl)} ${outwardArrow}</a>` : ''}`;
function batchEvidence(d) {
  const t = d.ti;
  return t ? `<p class="inquiry-footnote">Separate frozen target–hERG batch: target pChEMBL ${fx(t.act, 3)} (${t.asrc === 'measured' ? 'measured aggregate' : 'prediction'}) at ${esc(t.tid)}; ${t.tsrc === 'chembl_mechanism' ? 'recorded mechanism target' : 'target inferred by structure router'}. Its curation differs from this explorer aggregate. Structure &amp; sources retains that batch’s full row, domain flag, hERG value and its source.</p>` : '';
}
function endpointEvidence(d) {
  const a = d.act;
  return `<section><h5>${esc(cap(d.name))}</h5>${a ? `<p><strong>Stored median pChEMBL ${fx(a.p, 2)}</strong><br>${esc(a.types || 'Endpoint types not retained')} · ${a.ndoc ?? 'Unknown number of'} ChEMBL documents</p><p>Target: <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(a.target)}/" target="_blank" rel="noopener noreferrer">${esc(a.tname || a.target)} (${esc(a.target)}) ${outwardArrow}</a></p>` : `<p>${esc(cap(d.name))} has no activity aggregate in this snapshot. Missing does not mean inactive.</p>`}<p class="inquiry-source-links">${recordLinks(d)}</p><p class="inquiry-footnote">Dataset CID ${d.cid}${d.pcid && d.pcid !== d.cid ? ` · structure parent CID ${d.pcid}` : ''}</p>${batchEvidence(d)}${identityWarning(d) ? `<p class="inquiry-identity-warning">${identityWarning(d)}</p>` : ''}</section>`;
}
export function initInquiry(caps, updateSheet) {
  const disclosure = $('#inquiry-disclosure');
  disclosure.hidden = false; disclosure.open = true;
  $('#inquiry-resume').textContent = 'Resume inquiry';
  $('#inquiry-mount').innerHTML = `        <section class="inquiry" aria-labelledby="inquiry-title">
          <a class="inquiry-return" href="#explore">Back to Explore controls</a>
          <p class="eyebrow">01 / Follow an identity</p>
          <h3 id="inquiry-title">Same molecule. Different neighbours.</h3>
          <div class="inquiry-anchor"><span class="inquiry-orbit" aria-hidden="true">◎</span><div><strong id="inquiry-name"></strong><small id="inquiry-identity"></small></div></div>
          <div class="inquiry-actions"><button type="button" id="inquiry-pin" class="primary">Start with caffeine</button><button type="button" id="inquiry-evidence" class="ghost">Structure &amp; sources</button><button type="button" id="inquiry-focus" class="ghost" aria-pressed="true">Whole population</button></div>
          <div class="inquiry-maps" role="group" aria-label="Molecular representations">
            <button type="button" data-inquiry-map="properties" aria-pressed="false"><span aria-hidden="true">◈</span>Properties</button>
            <button type="button" data-inquiry-map="structure" aria-pressed="false"><span aria-hidden="true">⬡</span>Structure map</button>
            <button type="button" data-inquiry-map="pca" aria-pressed="false"><span aria-hidden="true">✣</span>PCA overview</button>
          </div>
          <h4 id="inquiry-map-title"></h4><p id="inquiry-map-context">Neighbours are close in the displayed coordinates after scaling each axis to the current filtered cohort’s range. This is not chemical similarity, shared pharmacology or an applicability-domain result.</p>
          <p class="inquiry-identity-warning" id="inquiry-identity-warning" hidden></p>
          <details class="inquiry-method"><summary>What does this map mean?</summary><p class="small" id="inquiry-map-note"></p></details>
          <figure id="inquiry-projection" hidden><button type="button" id="inquiry-projection-zoom" class="ghost" aria-pressed="false">Zoom to pin &amp; neighbours</button><div class="projection-legend" role="group" aria-label="Colour legend"></div><svg viewBox="0 0 640 400" role="img" aria-labelledby="projection-title"></svg><figcaption></figcaption></figure>
          <div class="inquiry-near-head"><strong>Nearest in this map</strong><span id="inquiry-count"></span></div>
          <ol id="inquiry-neighbours" class="inquiry-neighbours"></ol><div id="inquiry-pair"></div><p class="inquiry-footnote">The dashed scene link follows two records; it is not a chemical bond. An axis bracket shows the selected descriptor only when that axis is present.</p><details id="inquiry-compare" class="inquiry-compare"><summary id="inquiry-compare-title">Compare coordinates</summary><div id="inquiry-comparison"></div></details>
          <details class="inquiry-method"><summary>Distance &amp; animation method</summary><p class="inquiry-footnote">Distances use each displayed axis scaled to its range in the current filtered view. Changing axes or filters can change neighbours. Numbers match this list; point size is visual emphasis, not a measurement. Rings follow identities; transition trails are visual interpolation, not chemical transformations.</p></details>
          <div class="inquiry-slice-box">
            <p class="eyebrow">02 / Ask a population question</p>
            <label class="inquiry-toggle"><input type="checkbox" id="inquiry-slice-enable">Sweep a TPSA plane</label>
            <div class="inquiry-range"><label for="inquiry-slice">Polar surface area</label><output id="inquiry-slice-value" for="inquiry-slice">140 Å²</output></div>
            <p id="inquiry-slice-live" class="inquiry-slice-live" role="status"></p><input type="range" id="inquiry-slice" min="0" max="400" step="5" value="140" aria-describedby="inquiry-slice-help inquiry-slice-result">
            <p id="inquiry-slice-help" class="small"></p><p id="inquiry-slice-result" class="inquiry-result" role="status"></p>
            <p class="inquiry-footnote">An exploratory threshold, not an absorption or safety prediction. Recorded administration route is not measured bioavailability. No compounds or source values are changed.</p>
          </div>
          <p class="inquiry-next">03 / Challenge the equation <a href="#hansch">Inspect fits and frozen validation ${forwardArrow}</a><a class="inquiry-return" href="#explore">Back to Explore controls</a></p>
        </section>`;
  for (const file of ['inquiry.css', 'inquiry-pair.css', 'inquiry-tags.css']) { const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `css/${file}`; document.head.append(css); }
  app.inquiry = { active: true, focused: true, projectionZoom: false, comparisonCid: null, descriptor: 'tpsa', cid: null, neighbours: [], slice: null };
  const state = app.inquiry;
  const pair = initPair($('#inquiry-pair'), { loadSmilesDrawer, onDescriptor: key => { state.descriptor = key; render(); } });
  $('#inquiry-focus').disabled = !caps?.webgl;
  function render() {
    const d = app.byCid.get(state.cid), v = app.view;
    $('#inquiry-focus').disabled = !caps?.webgl || document.documentElement.classList.contains('no-webgl');
    const entry = Object.entries(MAPS).find(([, m]) => m.axes.every((k, i) => k === v[['x', 'y', 'z'][i]]));
    const active = entry?.[0], map = entry?.[1];
    const visible = d && app.visible.includes(d);
    state.neighbours = visible ? nearestInMap(app.visible, d, ['x', 'y', 'z'].map(a => AX[v[a]]).filter(a => !a.pseudo).map(a => a.get)) : [];
    for (const b of document.querySelectorAll('[data-inquiry-map]')) b.setAttribute('aria-pressed', String(b.dataset.inquiryMap === active));
    $('#inquiry-name').textContent = d ? cap(d.name) : 'Choose a molecule to follow';
    $('#inquiry-identity').textContent = d ? `Dataset CID ${d.cid} · following the same stored record` : 'Select any sphere or search below, then pin it here.';
    $('#inquiry-pin').disabled = app.drugs[app.selected]?.cid === state.cid;
    $('#inquiry-pin').textContent = app.drugs[app.selected]?.cid === state.cid ? 'Pinned' : app.selected >= 0 ? `Pin ${cap(app.drugs[app.selected].name)}` : 'Start with caffeine';
    $('#inquiry-map-note').textContent = map?.note || 'Your custom axes are active. Neighbours are distances in this displayed coordinate system, not evidence of biological similarity.';
    const warned = [d, app.drugs[app.selected], ...state.neighbours].find(identityWarning);
    $('#inquiry-identity-warning').hidden = !warned;
    $('#inquiry-identity-warning').textContent = warned ? identityWarning(warned) : '';
    const selected = app.drugs[app.selected];
    if (selected && selected.cid !== state.cid) state.comparisonCid = selected.cid;
    const other = app.byCid.get(state.comparisonCid) || state.neighbours[0];
    state.comparisonCid = other?.cid ?? null;
    $('#inquiry-neighbours').innerHTML = !d ? '<li>Pin a molecule to reveal its map neighbours.</li>' : !visible ? '<li>The pinned molecule is outside this view’s filters or lacks an axis value. Your pin is kept; use Explore controls to bring it back.</li>' : state.neighbours.length ? state.neighbours.map((n, i) => `<li><button type="button" data-neighbour="${n.cid}" aria-pressed="${n.cid === state.comparisonCid}"><span class="inquiry-rank">0${i + 1}</span><span>${esc(cap(n.name))}${identityWarning(n) ? `<small class="inquiry-identity-flag">Identity mapping needs review</small>` : ''}</span><span class="inquiry-compare-action">${n.cid === state.comparisonCid ? 'Comparing' : 'Compare'}</span></button></li>`).join('') : '<li>No other complete compound in this view.</li>';
    pair.render({anchor: d, other, descriptor: state.descriptor || 'tpsa'});
    $('#inquiry-compare').hidden = !d || !other;
    if (d && other) {
      $('#inquiry-compare-title').textContent = `Sources & activity evidence: ${cap(d.name)} / ${cap(other.name)}`;
      const rows = [['logp','RDKit log P',''],['tpsa','TPSA','Å²'],['mr','Molar refractivity','cm³/mol']];
      $('#inquiry-comparison').innerHTML = `<table><caption>Stored whole-molecule descriptors, independent of the current map representation.</caption><thead><tr><th scope="col">Property</th><th scope="col">${esc(cap(d.name))}</th><th scope="col">${esc(cap(other.name))}</th><th scope="col">Difference*</th></tr></thead><tbody>${rows.map(([key,label,unit])=>{const a=d.d[key],b=other.d[key],ok=Number.isFinite(a)&&Number.isFinite(b);return `<tr><th scope="row">${label}${unit ? `<small>${unit}</small>` : ''}</th><td>${fx(a,2)}</td><td>${fx(b,2)}</td><td>${ok ? fx(b-a,2) : 'missing'}</td></tr>`;}).join('')}</tbody></table><p class="inquiry-footnote">*${esc(cap(other.name))} minus ${esc(cap(d.name))}. RDKit-derived properties, not experimental endpoints. The original export does not record a toolkit version for every descriptor.</p><h4>Activity evidence</h4><div class="inquiry-endpoints">${endpointEvidence(d)}${endpointEvidence(other)}</div><p class="inquiry-footnote">Stored pChEMBL values are aggregates of reported experimental endpoints, not single assay results or model predictions. Individual assay and document IDs are not retained here. These records do not support a potency difference between this pair.</p><p class="inquiry-source-links"><a href="data/provenance.csv">Provenance ledger</a><a href="data/validation.md">Dataset methods &amp; limitations</a></p>`;
    }
    $('#inquiry-count').textContent = `${app.visible.length} compounds in this view`;
    $('#inquiry-map-title').textContent = map?.label || 'Your coordinate system';
    const canSlice = ['x', 'y', 'z'].some(a => v[a] === 'tpsa');
    $('#inquiry-slice').disabled = !canSlice;
    $('#inquiry-slice-enable').disabled = !canSlice;
    $('#inquiry-slice-help').textContent = canSlice ? 'Move the plane. Smaller points lie above your threshold; colours still mean what the legend says.' : 'Choose Properties, or put TPSA on any axis, to sweep this plane.';
    const summary = sliceSummary(app.visible, Number($('#inquiry-slice').value));
    $('#inquiry-slice-value').textContent = `${$('#inquiry-slice').value} Å²`;
    $('#inquiry-slice-live').textContent = `${summary.below} below · ${summary.above} above · ${summary.missing} missing`;
    $('#inquiry-slice-result').textContent =  `Across all ${summary.total} filtered records: ${summary.below} at or below · ${summary.above} above · ${summary.missing} missing TPSA. Of ${summary.knownRouteBelow} below with a recorded route, ${summary.oralBelow} include oral administration.`;
    $('#inquiry-beacon').hidden = !d || !state.active;
    $('#inquiry-focus').textContent = state.focused ? 'Whole population' : 'Focus neighbours';
    $('#inquiry-focus').setAttribute('aria-pressed', String(state.focused));
    $('#inquiry-beacon').textContent = d ? `${visible ? '◎' : '◌'} Following ${cap(d.name)} · ${visible ? (state.focused ? 'neighbourhood camera · axes unchanged' : 'whole population') : 'outside this view'}` : '';
    renderProjection(state);
    bus.emit('inquiry:changed');
  }
  function pin() {
    const d = app.drugs[app.selected] || app.drugs.find(d => d.name.toLowerCase() === 'caffeine') || app.visible[0];
    if (!d) return;
    if (state.cid !== d.cid) state.comparisonCid = null;
    state.cid = d.cid;
    selectDrug(d.cid, { reveal: false });
    render();
    if (state.focused) bus.emit('inquiry:focus');
  }
  $('#inquiry-pin').addEventListener('click', pin);
  $('#btn-reset').addEventListener('click', () => { state.focused = false; render(); });
  $('#inquiry-focus').addEventListener('click', () => { state.focused = !state.focused; $('#inquiry-focus').textContent = state.focused ? 'Whole population' : 'Focus neighbours'; $('#inquiry-focus').setAttribute('aria-pressed', String(state.focused)); if (state.focused) bus.emit('inquiry:focus'); else bus.emit('cmd:camera', { preset: app.view.y === 'none' ? 'structure' : 'space' }); render(); });
  $('#inquiry-evidence').addEventListener('click', () => { if (state.cid != null) { selectDrug(state.cid); if (isSheetMode()) updateSheet?.('full'); } });
  const start = () => {
    state.active = true;
    disclosure.open = true;
    $('#inquiry-mount').scrollIntoView({ block: 'start', behavior: 'instant' });
    // Let the scroll-tour settle first; then the instrument owns the explicit choice.
    requestAnimationFrame(() => requestAnimationFrame(() => { choose('properties'); pin(); if (isSheetMode()) updateSheet?.('closed'); $('#inquiry-pin').focus({ preventScroll: true }); }));
  };
  $('#inquiry-start').addEventListener('click', start);
  $('#inquiry-resume').addEventListener('click', () => {
    state.active = true;
    disclosure.open = true;
    render();
    requestAnimationFrame(() => { $('#inquiry-mount').scrollIntoView({ block: 'start', behavior: 'instant' }); $('#inquiry-pin').focus({ preventScroll: true }); });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('a[href="#explore"]')) return;
    disclosure.open = false;
    if (isSheetMode()) updateSheet?.('closed');
    requestAnimationFrame(() => $('#search').focus({ preventScroll: true }));
  });
  document.addEventListener('click', e => { if (e.target.closest('a[href="#tour"], a[href="#hansch"]')) { state.active = false; render(); } });
  function choose(key) {
    state.active = true;
    const m = MAPS[key];
    setView({ x: m.axes[0], y: m.axes[1], z: m.axes[2], veber: false });
    if (state.focused) bus.emit('inquiry:focus'); else bus.emit('cmd:camera', { preset: m.camera });
  }
  for (const b of document.querySelectorAll('[data-inquiry-map]')) b.addEventListener('click', () => choose(b.dataset.inquiryMap));
  $('#inquiry-neighbours').addEventListener('click', e => { const b = e.target.closest('[data-neighbour]'); if (b) { selectDrug(Number(b.dataset.neighbour), { reveal: false }); if (isSheetMode()) updateSheet?.('closed'); $('#inquiry-pair').scrollIntoView({block:'start',behavior:'instant'}); } });
  const updateSlice = () => { state.slice = $('#inquiry-slice-enable').checked ? Number($('#inquiry-slice').value) : null; render(); bus.emit('inquiry:slice'); };
  $('#inquiry-slice').addEventListener('input', updateSlice);
  $('#inquiry-slice-enable').addEventListener('change', updateSlice);
  $('#inquiry-projection-zoom').addEventListener('click', () => { if ($('#inquiry-projection').hidden) return; state.projectionZoom = !state.projectionZoom; render(); });
  $('#inquiry-projection').addEventListener('click', e => { const point = e.target.closest('[data-projection-cid]'); if (point) selectDrug(Number(point.dataset.projectionCid), { reveal: false }); });
  bus.on('recolor', render, ORDER.LATE);
  bus.on('theme', render, ORDER.LATE);
  bus.on('ti:ready', render, ORDER.LATE);
  bus.on('layout', render, ORDER.LATE);
  bus.on('selection', render, ORDER.LATE);
  render();
  bus.emit('inquiry:init');
  start();
}
