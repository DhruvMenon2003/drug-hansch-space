// ---------- the study ----------
// Everything specific to this table lives in STUDY. To reuse the page for another table, replace this
// block (and the few sentences of prose that describe the drug); every number in the text is computed.
const STUDY = {
  drug: 'Apricitabine',
  formula: 'C8H11N3O3S',
  tableText: [
    'Apricitabine dose groups',
    'Event Placebo (n = 13) 400 mg (n = 11) 800 mg (n = 12) 1200 mg (n = 14) 1600 mg (n = 13) Total (n = 50)',
    'All [n (%)] 9 (69.2) 9 8 11 11 39 (78.0)',
    'Headache 4 (30.8) 3 4 6 8 21 (42.0)',
    'Nasal congestion 1 (7.7) 1 1 3 2 7 (14.0)',
    'Increases in',
    'Alanine aminotransferase 4 (30.8) 1 2 0 3 6 (12.0)',
    'Aspartate aminotransferase 5 (38.5) 0 3 1 3 7 (14.0)',
    'Blood amylase 0 (0.0) 1 1 1 3 6 (12.0)',
    'Blood creatinine 5 (38.5) 3 2 2 3 10 (20.0)',
    'Blood sodium 3 (23.1) 2 1 1 2 6 (12.0)',
    'Lipase 3 (23.1) 2 3 1 4 10 (20.0)'
  ].join('\n'),
  tableCaption: 'Adverse events judged possibly or probably related to treatment, by dose group (source 1). Counts are patients, with percentages in parentheses.',
  focus: /^headache$/i,                 // the row the essay is about
  spanner: 'Apricitabine dose groups',  // heading over the dose columns
  xTitle: 'Apricitabine dose (mg per day)',
  unit: 'mg',                           // unit of the dose scores, for readouts
  population: 'Antiretroviral-naive adults with HIV-1 infection',
  design: 'Randomized, double-blind',
  duration: '10 days of oral dosing',
  outcome: 'Adverse events recorded',
  // Teaching tables for Figure 5, found by search so that the caption's claims hold for these group sizes.
  presets: { stair: [3, 3, 5, 7, 8], spike: [2, 9, 3, 3, 3], flat: [5, 4, 5, 6, 5] },
  // Ball-and-stick coordinates in ångström: [element, x, y, z] and [atom, atom, bond order].
  molecule: /*__MOLECULE__*/null,
  // Trial-design illustration for panel a of the exported figure.
  panelA: { href: '/*__PANEL_A__*/', width: 1600, height: 742, credit: 'Created in BioRender. Journals require a BioRender publication licence.' }
};
// The illustration is embedded as a data URL in the one-file build and sits beside the page otherwise; the figure JSON
// needs the data URL (so an exported SVG is self-contained), so a file is read into one when first wanted.
STUDY.panelAReady = (() => {
  const p = STUDY.panelA;
  if (!p || !p.href) return Promise.resolve(null);
  if (p.href.startsWith('data:')) return Promise.resolve(p);
  return fetch(p.href).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status)))).then((b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(Object.assign({}, p, { href: String(fr.result) })); fr.readAsDataURL(b); })).catch(() => null);
})();

// ---------- numbers derived from the study, used by the prose and the figures ----------
const S = (() => {
  const parsed = C.parseTable(STUDY.tableText);
  const fi = Math.max(0, parsed.rows.findIndex((r) => STUDY.focus.test(r.label)));
  const A = C.analyze({ groups: parsed.groups, counts: parsed.rows[fi].counts, event: parsed.rows[fi].label, scoreType: 'dose', includeRef: true });
  const g = A.groups; // reference first, then doses in ascending order
  const s = { parsed, focusIndex: fi, A, ev: lc(parsed.rows[fi].label), k: g.length,
    x: g.map((q) => q.used), n: g.map((q) => q.n), r: g.map((q) => q.r), labels: g.map((q) => q.label),
    groups: g.map((q) => ({ label: q.label, n: q.n, role: q.role, score: q.used })) };
  s.N = s.n.reduce((a, b) => a + b, 0); s.R = s.r.reduce((a, b) => a + b, 0);
  s.top = s.k - 1; s.gap = s.r[s.top] - s.r[0];
  s.analyze = (r) => C.analyze({ groups: s.groups, counts: r, event: parsed.rows[fi].label, scoreType: 'dose', includeRef: true });
  return s;
})();

// Exact chance that a random deal puts the last group at least `gap` cases ahead of the first.
function gapProbability(n, R, gap) {
  const N = n.reduce((a, b) => a + b, 0), a0 = n[0], b0 = n[n.length - 1], rest = N - a0 - b0, den = C.logChoose(N, R);
  let p = 0;
  for (let a = 0; a <= a0; a++) for (let b = 0; b <= b0; b++) {
    const c = R - a - b;
    if (c < 0 || c > rest || b - a < gap) continue;
    p += Math.exp(C.logChoose(a0, a) + C.logChoose(b0, b) + C.logChoose(rest, c) - den);
  }
  return p;
}

// Fill every [data-b] span in the prose from the model, so the text cannot drift from the figures.
(() => {
  const A = S.A, tr = A.trend, L = C.lean(S.x, S.r, S.n), topPair = A.pairs[A.pairs.length - 1];
  const vary = (i, d) => { const r = S.r.slice(); r[i] += d; return S.analyze(r).trend; };
  const stair = S.analyze(STUDY.presets.stair), spike = S.analyze(STUDY.presets.spike);
  const pairN = A.pairs.map((p) => p.n + A.ref.n);
  const B = {
    ev: S.ev, evCap: cap(S.ev), drug: STUDY.drug, drugL: lc(STUDY.drug), refL: lc(S.labels[0]),
    refPct: pc1(S.r[0] / S.n[0]), topPct: pc1(S.r[S.top] / S.n[S.top]), nTop: S.n[S.top], onePt: (100 / S.n[S.top]).toFixed(1),
    gap: S.gap, gapShare: (100 * gapProbability(S.n, S.R, S.gap)).toFixed(1), R: S.R, N: S.N, k: word(S.k),
    meanEv: fmt(L.meanEvents), meanAll: fmt(L.meanAll), lean: fmt(L.lean),
    pExact: C.fmtP(tr.exact.pTwo), pAsym: C.fmtP(tr.pTwo), z: fmt(tr.z, 2), oneIn: Math.round(1 / tr.exact.pTwo),
    nRange: Math.min(...S.n) + ' to ' + Math.max(...S.n), nPairs: word(A.pairs.length), pairN: Math.min(...pairN) + ' to ' + Math.max(...pairN),
    stairTrend: C.fmtP(stair.trend.pTwo), stairRaw: C.fmtP(Math.min(...stair.pairs.map((p) => p.p))),
    spikeHolm: C.fmtP(Math.min(...spike.pairs.map((p) => p.pHolm))), spikeTrend: C.fmtP(spike.trend.pTwo),
    pRefMinus: C.fmtP(vary(0, -1).pTwo), pTopPlus: C.fmtP(vary(S.top, 1).pTwo),
    pRefMinusX: C.fmtP(vary(0, -1).exact.pTwo), pTopPlusX: C.fmtP(vary(S.top, 1).exact.pTwo),
    topRD: C.fmtSigned(100 * topPair.rd, 1), topCI: C.fmtNum(100 * topPair.lo, 1) + ' to ' + C.fmtNum(100 * topPair.hi, 1),
    nRows: word(S.parsed.rows.length), fwer: (100 * (1 - Math.pow(0.95, S.parsed.rows.length))).toFixed(0)
  };
  // Some tables print a total that leaves the reference group out. The note about it only makes sense for those.
  const skip = S.parsed.groups.findIndex((g) => g.role === 'skip');
  const skipCount = skip >= 0 ? S.parsed.rows[S.focusIndex].counts[skip] : null;
  const totalIsDoseOnly = skip >= 0 && S.r[0] > 0 && skipCount === S.R - S.r[0];
  if (totalIsDoseOnly) Object.assign(B, { skipR: skipCount, skipL: S.parsed.groups[skip].label, nDose: word(S.k - 1) });
  document.querySelectorAll('[data-if="totalIsDoseOnly"]').forEach((node) => { if (!totalIsDoseOnly) node.remove(); });
  window.__bindings = B; // read by the page test
  document.querySelectorAll('[data-b]').forEach((node) => {
    const key = node.dataset.b;
    if (key === 'formula') { // chemical formula with real subscripts
      node.replaceChildren(...STUDY.formula.split(/(\d+)/).filter(Boolean).map((t) => (/\d/.test(t) ? el('sub', { text: t }) : t)));
    } else if (B[key] !== undefined) node.textContent = B[key];
  });
})();

// The table as the paper prints it, with the row under study marked.
(() => {
  const P = S.parsed, wrap = $('specimen-wrap');
  const head = (g) => el('th', { scope: 'col' }, g.label + ' ', el('span', { class: 'dim', text: g.n === null ? '' : '(n = ' + g.n + ')' }));
  const refs = P.groups.filter((g) => g.role === 'ref'), rest = P.groups.filter((g) => g.role !== 'ref');
  const thead = el('thead');
  if (STUDY.spanner && rest.length > 1) {
    const r1 = el('tr', null, el('th', { rowspan: 2, scope: 'col', text: 'Event' }));
    refs.forEach((g) => { const th = head(g); th.setAttribute('rowspan', 2); r1.append(th); });
    r1.append(el('th', { class: 'span', colspan: rest.length, scope: 'colgroup', text: STUDY.spanner }));
    thead.append(r1, el('tr', null, ...rest.map(head)));
  } else thead.append(el('tr', null, el('th', { scope: 'col', text: 'Event' }), ...refs.map(head), ...rest.map(head)));
  const order = refs.concat(rest).map((g) => P.groups.indexOf(g));
  const tbody = el('tbody');
  // Lines of the pasted text without counts are sub-headings; rows after one are indented.
  let sub = false, ri = 0;
  STUDY.tableText.split('\n').forEach((line) => {
    if (/\(\s*n\s*=/.test(line) || line.trim() === STUDY.spanner) return;
    const row = P.rows[ri];
    if (!row || !line.trim().startsWith(row.label)) { tbody.append(el('tr', null, el('td', { colspan: order.length + 1, text: line.trim() }))); sub = true; return; }
    const tr = el('tr', { class: (sub ? 'sub ' : '') + (ri === S.focusIndex ? 'focus' : '') }, el('td', { text: row.label }));
    order.forEach((j) => {
      const c = row.counts[j], n = P.groups[j].n;
      tr.append(el('td', null, c === null ? '' : String(c), c !== null && n ? el('span', { class: 'dim', text: ' (' + (100 * c / n).toFixed(1) + ')' }) : null));
    });
    tbody.append(tr); ri++;
  });
  wrap.append(el('table', { class: 'booktabs' }, el('caption', { text: STUDY.tableCaption }), thead, tbody));
})();
