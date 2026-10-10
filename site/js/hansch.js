// Layer 3. The Hansch fits panel (equation, statistics, observed-vs-predicted plot) and the copy of the page that is
// derived from the data, so the numbers in the text always match the figures. Works with WebGL absent.
import { app, bus, ORDER, narrow, $, cap, esc, fin, fx, neg, sig, median, quant, pearson, fmtConc } from './kernel.js';
import { selectDrug, setView } from './view.js';
import { afterPaint, runSliced } from './idle.js';
import { revealStage } from './layout.js';

// ---------------------------------------------------------------- formatting of a fit
const TERM = { logP: 'log P', 'logP²': '(log P)²', MR: 'MR', TPSA: 'TPSA' };
function equation(g, withSe = true) {
  let s = `pChEMBL = ${neg(sig(g.coef.const))}`;
  if (withSe && g.se.const != null) s += ` (±${sig(g.se.const)})`;
  for (const t of g.terms) {
    const c = g.coef[t];
    s += ` ${c < 0 ? '−' : '+'} ${sig(Math.abs(c))}${withSe && g.se[t] != null ? ` (±${sig(g.se[t])})` : ''} ${TERM[t]}`;
  }
  return s;
}
function verdict(g) {
  if (g.q2 >= 0.5 && g.yrand_beats === 0)
    return ['Predictive within this set', `Leave-one-out q² is ${fx(g.q2)} and none of 100 shuffled activity vectors reached r² = ${fx(g.r2)}.`];
  if (g.q2 >= 0.2)
    return ['Weak', `q² is ${fx(g.q2)}: better than the mean, but below the usual 0.5 bar${g.yrand_beats ? `, and ${g.yrand_beats} of 100 shuffled fits matched its r²` : ''}.`];
  return ['Not predictive', g.q2 < 0 ? `q² is ${fx(g.q2)}: predicting every drug with the group mean does better.` : `q² is ${fx(g.q2)}, close to zero.`];
}
function statsTable(g) {
  return `<table class="stats"><tbody>
    <tr><th scope="row">Drugs</th><td>${g.n}</td><th scope="row">Model</th><td>${esc(g.terms.map(t => TERM[t]).join(' + '))}</td></tr>
    <tr><th scope="row">r²</th><td>${fx(g.r2, 3)}</td><th scope="row">q² (LOO)</th><td>${fx(g.q2, 3)}</td></tr>
    <tr><th scope="row">s</th><td>${fx(g.s, 3)}</td><th scope="row">F</th><td>${fx(g.F, 1)}</td></tr>
    <tr><th scope="row">Shuffled r²</th><td colspan="3">mean ${fx(g.yrand_r2_mean, 3)}, max ${fx(g.yrand_r2_max, 3)} (100 runs)</td></tr>
  </tbody></table>`;
}

// ---------------------------------------------------------------- Hansch panel
/** Fill the target-group select, bind the panel and draw the first fit. */
export function initHansch() {
  const sel = $('#h-group');
  sel.innerHTML = app.hansch.groups.map(g => `<option value="${esc(g.id)}">${g.id === 'ALL' ? 'All drugs with an activity value' : esc(cap(g.label))} (n = ${g.n}, q² = ${fx(g.q2)})</option>`).join('');
  sel.value = app.seriesId || app.hansch.groups[0].id;
  sel.addEventListener('change', renderHansch);
  // The view can change the group without the user touching the select (tour steps, "Show this fit"); the panel must then follow
  // the select, after controls.syncControls has written it (UX-18: the select used to say 'All drugs' above a CHEMBL233 fit).
  bus.on('view:patched', () => { if (sel.value !== shown) renderHansch(); }, ORDER.LATE);
  $('#h-show').addEventListener('click', () => {
    setView({ x: 'logp', y: 'act', z: 'mr', color: 'single', group: sel.value, l1: '', l2: '', l3: '', route: '', small: true, veber: false });
    bus.emit('cmd:camera', { preset: 'series' });
    if (narrow.matches) revealStage();               // the stage is a thin strip while the Hansch panel is being read: bring the plot up
  });
  $('#h-plot').addEventListener('click', e => { const c = e.target.closest('circle[data-cid]'); if (c) selectDrug(+c.dataset.cid); });
  bus.on('theme', () => { if ($('#h-group').value) renderHansch(); });
  // the plot is drawn at its CSS size where that is narrow (so its text stays 12 px): redraw when the column's width changes
  const svg = $('#h-plot');
  if (svg && typeof ResizeObserver === 'function') new ResizeObserver(() => { if (lastFit && plotNeedsRedraw(svg.clientWidth)) drawObsPred(lastFit); }).observe(svg);
  renderHansch();
}
let shown = null;                                 // the target group the panel currently describes
/** Redraw the equation, statistics, candidate table and plot for the selected target group. */
export function renderHansch() {
  shown = $('#h-group').value;
  const g = app.groups.get(shown).fit, [word, why] = verdict(g);
  const head = g.id === 'ALL' ? '' : `<p class="lede">First mechanism target <a href="https://www.ebi.ac.uk/chembl/target_report_card/${esc(g.id)}/" target="_blank" rel="noopener noreferrer">${esc(g.id)}</a>, ${esc(g.label)}.</p>`;
  $('#h-out').innerHTML = `${head}<p class="fig eq-block">${esc(equation(g))}</p>${statsTable(g)}<p class="verdict"><b>${word}.</b> ${esc(why)}</p>`;
  $('#h-cands').innerHTML = `<table class="stats"><thead><tr><th>Model</th><th>r²</th><th>q²</th></tr></thead><tbody>${g.candidates.map(c => `<tr><td>${esc(c.terms.map(t => TERM[t]).join(' + '))}</td><td>${fx(c.r2, 3)}</td><td>${fx(c.q2, 3)}</td></tr>`).join('')}</tbody></table>`;
  drawObsPred(g);
}
// The observed-against-predicted plot. Its 10-unit text scales with the SVG: in a column narrower than 384 CSS px that is under
// 12 px on screen, so there the plot is drawn in CSS pixels (viewBox = its width, 12 px text); wider, the original 320 x 260 box.
let lastFit = null, lastW = 320, lastFitMode = false;
const plotWidthFor = cw => (cw > 0 && cw < 384 ? Math.max(220, Math.round(cw)) : 320);
const plotNeedsRedraw = cw => { const w = plotWidthFor(cw), fit = cw > 0 && cw < 384; return fit !== lastFitMode || (fit && Math.abs(w - lastW) >= 4); };
function drawObsPred(g) {
  const svg = $('#h-plot'), cw = svg.clientWidth, fitMode = cw > 0 && cw < 384, W = plotWidthFor(cw), H = Math.round(W * 260 / 320), m = { l: 40, r: 12, t: 12, b: 34 };
  lastFit = g; lastW = W; lastFitMode = fitMode;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (fitMode) svg.dataset.fit = ''; else delete svg.dataset.fit;
  const vals = g.points.flatMap(p => [p.obs, p.loo]).filter(fin);
  let lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals));
  if (lo === hi) hi = lo + 1;
  const X = v => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r), Y = v => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  const T = app.tokens;
  let h = '';
  for (let v = lo; v <= hi; v++) {
    h += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${T.grid}"/><line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${T.grid}"/>`;
    h += `<text x="${X(v)}" y="${H - m.b + 14}" text-anchor="middle">${v}</text><text x="${m.l - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  }
  h += `<line x1="${X(lo)}" y1="${Y(lo)}" x2="${X(hi)}" y2="${Y(hi)}" stroke="${T['ink-2']}" stroke-dasharray="4 4"/>`;
  h += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">Predicted pChEMBL (leave-one-out)</text>`;
  h += `<text transform="translate(11 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">Observed pChEMBL</text>`;
  for (const p of g.points) {
    if (!fin(p.loo)) continue;
    const d = app.byCid.get(p.cid);
    h += `<circle cx="${X(p.loo)}" cy="${Y(p.obs)}" r="5" fill="${T.s1}" stroke="${T.panel || 'transparent'}" stroke-width="1.5" data-cid="${p.cid}" style="cursor:pointer"><title>${esc(cap(d?.name))}: observed ${fx(p.obs)}, predicted ${fx(p.loo)}</title></circle>`;
  }
  svg.innerHTML = h;
}

// ---------------------------------------------------------------- tour text from the data (so the numbers always match)
/** Fill the numeric paragraphs of the eight tour steps from the loaded data. */
export function fillTourText() {
  const D = app.drugs, M = app.meta;
  const pcaNames = { logp: 'log P', mr: 'MR', tpsa: 'TPSA', mw: 'weight', hbd: 'donors', hba: 'acceptors', rotb: 'rotatable bonds', arom: 'aromatic rings', fsp3: 'Fsp3' };
  const ex = M.pca.explained.map(v => (v * 100).toFixed(0) + '%');
  const top = k => Object.entries(M.pca.loadings).sort((a, b) => Math.abs(b[1][k]) - Math.abs(a[1][k])).slice(0, 2).map(e => pcaNames[e[0]] || e[0]).join(' and ');
  $('#t-pca').textContent = `PC1, PC2 and PC3 explain ${ex[0]}, ${ex[1]} and ${ex[2]} of the variance across ${D.filter(d => d.pc).length} drugs. PC1 is driven mostly by ${top(0)}, PC2 by ${top(1)}, PC3 by ${top(2)}. Colours mark the three largest ATC groups.`;
  // three O(n²) passes over the 759 drugs: computed in slices from idle callbacks after the first paint, the paragraph is filled when done
  afterPaint().then(() => runSliced(() => structureMapSteps(D)).done).then(text => { $('#t-ts').textContent = text; }, err => console.error('structure map text failed', err));
  const lp = D.filter(d => fin(d.d.logp) && d.d.mw <= app.hansch.max_mw), lpv = lp.map(d => d.d.logp), nBig = D.length - lp.length;
  const lo = lp.reduce((a, b) => (b.d.logp < a.d.logp ? b : a)), hi = lp.reduce((a, b) => (b.d.logp > a.d.logp ? b : a));
  const over5 = lpv.filter(v => v > 5).length;
  $('#t-logp').textContent = `Among the ${lp.length} drugs up to ${app.hansch.max_mw} Da, log P runs from ${fx(lo.d.logp, 1)} (${cap(lo.name)}) to ${fx(hi.d.logp, 1)} (${cap(hi.name)}); the median is ${fx(median(lpv), 1)}. ${over5} (${(100 * over5 / lp.length).toFixed(0)}%) are above 5, Lipinski's limit. The ${nBig} larger drugs, mostly peptides, are left out from here on: Crippen log P falls as low as ${fx(Math.min(...D.map(d => d.d.logp)), 0)} for them, and Hansch analysis is about small molecules. Depth is random spread so the points do not overlap.`;
  const both = D.filter(d => fin(d.d.logp) && fin(d.d.mr));
  const small = both.filter(d => d.d.mw <= 500), r = a => fx(pearson(a.map(d => d.d.logp), a.map(d => d.d.mr)), 2);
  $('#t-mr').textContent = `Among the ${small.length} drugs up to 500 Da, Pearson r between log P and MR is ${r(small)}: larger small molecules tend to be greasier. Across all ${both.length} it is ${r(both)}, because peptides and other large polar drugs have a high MR and a very low log P.`;
  const tp = lp.filter(d => fin(d.d.tpsa) && d.routes.length), oral = tp.filter(d => d.routes.includes('ORAL')), non = tp.filter(d => !d.routes.includes('ORAL'));
  const share = a => (100 * a.filter(d => d.d.tpsa <= 140).length / Math.max(1, a.length)).toFixed(0);
  $('#t-tpsa').textContent = `${share(oral)}% of the ${oral.length} drugs with an oral route sit at or below 140 Å², against ${share(non)}% of the ${non.length} drugs given only by other routes.`;
  const ac = D.filter(d => d.act).map(d => d.act.p);
  $('#t-act').textContent = `${ac.length} of ${D.length} drugs have a value. Median pChEMBL ${fx(median(ac), 1)} (interquartile range ${fx(quant(ac, 0.25), 1)} to ${fx(quant(ac, 0.75), 1)}), about ${fmtConc(median(ac))}.`;
  const sg = app.groups.get(app.seriesId)?.fit;
  if (sg) {
    const [word, why] = verdict(sg);
    $('#t-series-h').textContent = `${cap(sg.label)}: ${sg.n} drugs`;
    $('#t-series').textContent = `These ${sg.n} drugs share ${sg.id} (${sg.label}) as their first mechanism target. Of the ${sg.candidates.length} models allowed at this size (one descriptor per five drugs), ${sg.terms.map(t => TERM[t]).join(' + ')} gave the best leave-one-out q².`;
    $('#t-series-eq').innerHTML = `${esc(equation(sg))}<br>r² ${fx(sg.r2)} · q² ${fx(sg.q2)} · s ${fx(sg.s)} · n ${sg.n}<br><b>${word}.</b> ${esc(why)}`;
    const sticks = document.querySelector('[data-step="series"] p:last-of-type');
    if (sg.terms.includes('TPSA')) sticks.textContent = 'The surface is the fitted equation with TPSA held at the group mean. Each thin line joins a drug to its own fitted value, so its length is the residual.';
  }
  const all = app.groups.get('ALL').fit;
  $('#t-all').textContent = `Pool all ${all.n} drugs with an activity value, whatever their target, and the best model is ${all.terms.map(t => TERM[t]).join(' + ')} with r² = ${fx(all.r2)} and q² = ${fx(all.q2)}.`;
  $('#t-all-eq').innerHTML = `${esc(equation(all))}<br><b>${verdict(all)[0]}.</b> ${esc(verdict(all)[1])}`;
}

// How often a drug's nearest neighbour shares its ATC anatomical group: in the fingerprint map, in descriptor (PCA) space,
// and by chance. Fingerprints see scaffolds; bulk descriptors do not, which is why Hansch analysis needs a congeneric series.
// A generator so that runSliced() can stop between rows (it yields every ROWS rows, a millisecond or two of work); the
// arithmetic and its order are those of the original single function, so the numbers are identical.
const ROWS = 16;
function* structureMapSteps(D) {
  const pts = D.filter(d => d.ts && d.pc), n = pts.length;
  // each drug's set of ATC level-1 letters as a bit mask: "shares a group" is one AND
  const bit = new Map(), mask = new Int32Array(n), L1 = pts.map(d => new Set(d.atc.map(e => e.code[0])));
  L1.forEach((set, i) => { for (const c of set) { if (!bit.has(c)) bit.set(c, bit.size); mask[i] |= 1 << bit.get(c); } });
  const wide = bit.size > 31;                    // cannot happen with the 14 ATC groups; keep the exact (slow) test as the fallback
  const share = (i, j) => (wide ? [...L1[i]].some(c => L1[j].has(c)) : (mask[i] & mask[j]) !== 0);
  const nnShare = function* (key) {
    const K = pts.map(key), dim = n ? K[0].length : 0;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      let best = -1, bd = Infinity;
      const a = K[i];
      for (let j = 0; j < n; j++) {
        if (j === i || pts[j].smiles === pts[i].smiles) continue;
        const b = K[j];
        let s = 0;
        for (let k = 0; k < dim; k++) { const t = a[k] - b[k]; s += t * t; }
        if (s < bd) { bd = s; best = j; }
      }
      if (best >= 0 && share(i, best)) hit++;
      if (i % ROWS === ROWS - 1) yield;
    }
    return hit / n;
  };
  let chance = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let j = 0; j < n; j++) if (j !== i && share(i, j)) c++;
    chance += c / (n - 1);
    if (i % (ROWS * 4) === ROWS * 4 - 1) yield;
  }
  chance /= n;
  const ts = yield* nnShare(d => d.ts), pc = yield* nnShare(d => d.pc);
  const pct = v => (100 * v).toFixed(0) + '%';
  return `In this map ${pct(ts)} of ${n} drugs have a nearest neighbour from the same ATC anatomical group, against ${pct(pc)} in the descriptor space of step 1 and ${pct(chance)} by chance.`;
}
/** The sentence for step 2, computed in one go (tests; the page uses structureMapSteps through runSliced). */
export function structureMapText(D) {
  const g = structureMapSteps(D);
  for (let r = g.next(); ; r = g.next()) if (r.done) return r.value;
}

/** Fill the "Method and checks" counts. */
export function fillMethod() {
  const D = app.drugs, M = app.meta, ms = D.filter(d => d.conf);
  const pcs = ms.filter(d => d.conf.startsWith('PubChem')).length;
  $('#m-count').textContent = D.length;
  $('#m-checks').textContent = `${D.length} drugs, all described by RDKit; ${D.filter(d => fin(d.d.xlogp)).length} with a PubChem XLogP3; ${pcs} PubChem 3D conformers and ${ms.length - pcs} RDKit conformers; ` +
    `${D.filter(d => d.act).length} with an activity value; ${app.hansch.groups.length - 1} target groups with at least ${app.hansch.min_group} drugs. Data built ${M.generated_utc.slice(0, 10)}.`;
}
