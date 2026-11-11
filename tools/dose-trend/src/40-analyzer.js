// ---------- figure 7: the analyzer (table in, tests out) ----------
const tool = {
  groups: [], rows: [], sel: 0, scoreType: 'dose', alt: 'two', includeRef: true, result: null,
  isStudy: true, // the grid still holds the study's own table, so its design notes apply
  fig: { journal: 'nature', column: 'double', panelA: 'schematic', style: 'bars', palette: 'soft', pA: 'asym', pB: 'holm', border: true, xTitle: '', yTitle: '', population: '', design: '', duration: '' },
  image: null, built: null, custom: false
};
const inClaude = !!(window.claude && typeof window.claude.use === 'function');
const pickP = (o) => (tool.alt === 'two' ? o.pTwo : tool.alt === 'inc' ? o.pInc : o.pDec);
const sided = () => (tool.alt === 'two' ? 'two-sided' : 'one-sided');
const pct = (v, d = 1) => (100 * v).toFixed(d);
let studio = { render() {} }; // set by the figure studio below

function setMsg(text, bad, list) {
  const m = $('parse-msg');
  clear(m); m.className = 'msg' + (bad ? ' bad' : '');
  if (!text) return;
  m.append(text);
  if (list && list.length) m.append(el('ul', null, ...list.map((t) => el('li', { text: t }))));
}

// ----- loading a table -----
let studyImage = null; // the trial's own panel-a illustration, once read
STUDY.panelAReady.then((img) => { studyImage = img; });
function loadParsed(parsed, message, prefer, fromStudy) {
  tool.groups = parsed.groups.map((g) => ({ label: g.label, n: g.n, role: g.role, score: g.score }));
  tool.rows = parsed.rows.map((r) => ({ label: r.label, counts: r.counts.slice() }));
  let sel = prefer ? tool.rows.findIndex((r) => prefer.test(r.label)) : -1;
  if (sel < 0) sel = tool.rows.findIndex((r) => !/^(all|any|total|overall)\b/i.test(r.label));
  tool.sel = Math.max(0, sel);
  tool.isStudy = !!fromStudy;
  tool.custom = false;
  // Design notes and the illustration describe one particular trial; they do not carry over to another table.
  tool.image = fromStudy && studyImage ? studyImage : null;
  if (fromStudy && !studyImage) STUDY.panelAReady.then((img) => { if (img && tool.isStudy && !tool.image) { tool.image = img; if (tool.fig.panelA === 'image') studio.render(); } });
  Object.assign(tool.fig, fromStudy ? { xTitle: STUDY.xTitle, population: STUDY.population, design: STUDY.design, duration: STUDY.duration } : { xTitle: '', population: '', design: '', duration: '' });
  if (!tool.image && tool.fig.panelA === 'image') tool.fig.panelA = 'schematic';
  ['xt', 'pop', 'design', 'dur'].forEach((k, i) => { $('fig-' + k).value = [tool.fig.xTitle, tool.fig.population, tool.fig.design, tool.fig.duration][i]; });
  $('fig-panel-a').value = tool.fig.panelA;
  renderGrid(); recompute();
  const used = tool.groups.filter((g) => g.role !== 'skip').length;
  setMsg(message + ' ' + tool.rows.length + (tool.rows.length === 1 ? ' event row' : ' event rows') + ' and ' + used + ' groups are in the grid.', false, parsed.notes);
}
function parsePasted() {
  const parsed = C.parseTable($('paste-box').value);
  if (parsed.error) { setMsg(parsed.error, true); return; }
  loadParsed(parsed, 'Table read from the pasted text.', null, $('paste-box').value.trim() === STUDY.tableText.trim());
}
function loadExample() {
  $('paste-box').value = STUDY.tableText;
  loadParsed(C.parseTable(STUDY.tableText), 'Example loaded: the ' + lc(STUDY.drug) + ' table from the top of the page.', STUDY.focus, true);
}

// ----- editable grid -----
const intOrNull = (v) => (/^\d+$/.test(String(v).trim()) ? parseInt(v, 10) : null);
const numOrNull = (v) => { v = String(v).trim().replace(',', '.'); return v !== '' && isFinite(+v) ? +v : null; };
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(recompute, 140); };

function renderGrid() {
  const t = $('grid'); clear(t);
  const rows = ['Group', 'Use as', 'Dose score', 'Patients (n)'].map((h) => el('tr', null, el('th', { class: 'rowhead', scope: 'row', text: h })));
  tool.groups.forEach((g, j) => {
    const cls = g.role === 'skip' ? 'skip' : '';
    const name = el('input', { type: 'text', class: 'gname', id: 'g-name-' + j, 'aria-label': 'Group ' + (j + 1) + ' name' });
    name.value = g.label; name.oninput = () => { g.label = name.value; soon(); };
    const rm = el('button', { type: 'button', class: 'x', 'aria-label': 'Remove group ' + g.label, title: 'Remove this group' }, '×');
    rm.onclick = () => { tool.groups.splice(j, 1); tool.rows.forEach((r) => r.counts.splice(j, 1)); renderGrid(); recompute(); };
    rows[0].append(el('th', { class: cls }, el('div', { class: 'colhead' }, name, rm)));
    const role = el('select', { id: 'g-role-' + j, 'aria-label': 'How to use ' + g.label }, ...[['ref', 'Reference'], ['dose', 'Dose group'], ['skip', 'Leave out']].map(([v, text]) => el('option', { value: v, text })));
    role.value = g.role;
    role.onchange = () => {
      if (role.value === 'ref') { tool.groups.forEach((h) => { if (h !== g && h.role === 'ref') h.role = 'dose'; }); if (g.score === null) g.score = 0; }
      g.role = role.value; renderGrid(); recompute();
    };
    rows[1].append(el('td', { class: cls }, role));
    const sc = el('input', { type: 'text', inputmode: 'decimal', class: 'n', id: 'g-score-' + j, 'aria-label': 'Dose score for ' + g.label });
    sc.value = g.score === null ? '' : C.fmtScore(g.score); sc.oninput = () => { g.score = numOrNull(sc.value); soon(); };
    rows[2].append(el('td', { class: cls }, sc));
    const n = el('input', { type: 'text', inputmode: 'numeric', class: 'n', id: 'g-n-' + j, 'aria-label': 'Number of patients in ' + g.label });
    n.value = g.n === null ? '' : String(g.n); n.oninput = () => { g.n = intOrNull(n.value); soon(); };
    rows[3].append(el('td', { class: cls }, n));
  });
  const tbody = el('tbody');
  tool.rows.forEach((r, i) => {
    const radio = el('input', { type: 'radio', name: 'ev', id: 'ev-radio-' + i, 'aria-label': 'Analyse ' + r.label });
    radio.checked = i === tool.sel; radio.onchange = () => selectRow(i);
    const name = el('input', { type: 'text', id: 'ev-name-' + i, 'aria-label': 'Event name, row ' + (i + 1) });
    name.value = r.label; name.oninput = () => { r.label = name.value; fillEventSelect(); soon(); };
    const tr = el('tr', { class: i === tool.sel ? 'sel' : '' }, el('th', { scope: 'row' }, el('div', { class: 'ev' }, radio, name)));
    tool.groups.forEach((g, j) => {
      const c = el('input', { type: 'text', inputmode: 'numeric', id: 'c-' + i + '-' + j, 'aria-label': r.label + ', ' + g.label });
      c.value = r.counts[j] === null || r.counts[j] === undefined ? '' : String(r.counts[j]); c.oninput = () => { r.counts[j] = intOrNull(c.value); soon(); };
      tr.append(el('td', { class: g.role === 'skip' ? 'skip' : '' }, c));
    });
    const rm = el('button', { type: 'button', class: 'x', 'aria-label': 'Remove row ' + r.label, title: 'Remove this row' }, '×');
    rm.onclick = () => { tool.rows.splice(i, 1); if (tool.sel >= tool.rows.length) tool.sel = Math.max(0, tool.rows.length - 1); else if (tool.sel > i) tool.sel--; renderGrid(); recompute(); };
    tr.append(el('td', null, rm)); tbody.append(tr);
  });
  t.append(el('thead', null, ...rows), tbody);
  fillEventSelect();
}
function fillEventSelect() {
  const s = $('sel-event');
  s.replaceChildren(...tool.rows.map((r, i) => el('option', { value: String(i), text: r.label || 'Row ' + (i + 1) })));
  s.value = String(tool.sel);
}
function selectRow(i) {
  tool.sel = i;
  [...$('grid').tBodies[0].rows].forEach((tr, k) => { tr.className = k === i ? 'sel' : ''; const rd = $('ev-radio-' + k); if (rd) rd.checked = k === i; });
  $('sel-event').value = String(i);
  recompute();
}
function markCells() {
  tool.groups.forEach((g, j) => {
    const used = g.role !== 'skip', nIn = $('g-n-' + j);
    if (nIn) nIn.classList.toggle('invalid', used && !(Number.isInteger(g.n) && g.n > 0));
    tool.rows.forEach((r, i) => {
      const c = $('c-' + i + '-' + j); if (!c) return;
      const v = r.counts[j];
      c.classList.toggle('invalid', !!(used && ((i === tool.sel && !Number.isInteger(v)) || (Number.isInteger(v) && Number.isInteger(g.n) && v > g.n))));
    });
  });
}

// ----- analysis and its write-up -----
function recompute() {
  const row = tool.rows[tool.sel];
  tool.result = row ? C.analyze({ groups: tool.groups, counts: row.counts, event: row.label || 'the event', scoreType: tool.scoreType, includeRef: tool.includeRef }) : null;
  tool.custom = false;
  markCells(); renderResults(); studio.render();
}
function tile(k, v, s, flag, sig) {
  return el('div', { class: 'tile' }, el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v }), s ? el('span', { class: 's', text: s }) : null, flag ? el('span', { class: 'flag' + (sig ? ' sig' : ''), text: flag }) : null);
}
const exactName = (ex) => (ex.method === 'mc' ? 'Permutation test, ' + ex.B.toLocaleString('en-US') + ' Monte Carlo samples' : 'Exact conditional test');

function renderResults() {
  const errBox = $('errors'), box = $('results'), res = tool.result;
  clear(errBox);
  if (!res || !res.ok) {
    box.style.display = 'none';
    errBox.append('The tests cannot run yet.', el('ul', null, ...(res ? res.errors : ['Add at least one event row to the table.']).slice(0, 6).map((t) => el('li', { text: t }))));
    return;
  }
  box.style.display = 'grid';
  const tr = res.trend, ev = res.event, ref = res.ref, tiles = $('tiles'), warn = $('warnings'), parts = [];
  clear(tiles); clear(warn);
  const first = res.groups[0], last = res.groups[res.groups.length - 1];
  if (tr.computable) {
    const pa = pickP(tr), pe = pickP(tr.exact);
    tiles.append(tile('Trend across dose', 'P ' + C.fmtPeq(pa), 'Cochran–Armitage, ' + sided() + ' · z = ' + C.fmtNum(tr.z, 2), pa < 0.05 ? 'Below 0.05' : 'Not below 0.05', pa < 0.05),
      tile('Same test, exact', 'P ' + C.fmtPeq(pe), exactName(tr.exact) + ', ' + sided(), pe < 0.05 ? 'Below 0.05' : 'Not below 0.05', pe < 0.05));
  } else tiles.append(tile('Trend across dose', 'Not testable', tr.reason));
  tiles.append(tile('Lowest to highest group', pct(first.p) + '% → ' + pct(last.p) + '%', first.label + ' → ' + last.label));
  const top = res.pairs.reduce((a, d) => (!a || Math.abs(d.rd) > Math.abs(a.rd) ? d : a), null);
  if (top) tiles.append(tile('Largest difference from ' + lc(ref.label), C.fmtSigned(100 * top.rd, 1) + ' pp', top.label + ' · Fisher P ' + C.fmtPeq(top.p) + ', Holm ' + C.fmtP(top.pHolm), top.pHolm < 0.05 ? 'Below 0.05 after Holm' : 'Not below 0.05', top.pHolm < 0.05));
  else tiles.append(tile('Pairwise comparisons', 'No reference', 'Set one column to Reference in the grid to compare each dose against it.'));

  if (tr.computable) {
    const pA = pickP(tr), pE = pickP(tr.exact), dirWord = tr.direction === 'up' ? 'rose' : tr.direction === 'down' ? 'fell' : 'did not change';
    const agrees = tool.alt === 'two' || (tool.alt === 'inc' && tr.z > 0) || (tool.alt === 'dec' && tr.z < 0);
    if (pA < 0.05 && agrees) parts.push('There is a dose-related ' + (tr.direction === 'down' ? 'decrease' : 'increase') + ' in ' + lc(ev) + ' (' + sided() + ' P ' + C.fmtPeq(pA) + '; exact P ' + C.fmtPeq(pE) + ').');
    else parts.push(cap(ev) + ' ' + dirWord + ' with dose in this sample, but the ' + sided() + ' trend test does not reach the 0.05 level (P ' + C.fmtPeq(pA) + '; exact P ' + C.fmtPeq(pE) + ').');
    if ((pA < 0.05) !== (pE < 0.05)) parts.push('The asymptotic and exact P values fall on opposite sides of 0.05; with groups this small the exact value is the safer one to report.');
    else if (tr.smallSample) parts.push('The groups are small, so the exact P value is the safer one to report.');
    if (tr.departure && tr.departure.p < 0.05) parts.push('The group percentages depart from a straight line (P ' + C.fmtPeq(tr.departure.p) + '), so a linear trend describes them poorly.');
  } else parts.push(tr.reason);
  if (res.pairs.length) {
    const hits = res.pairs.filter((d) => d.pHolm < 0.05);
    if (hits.length) parts.push(listJoin(hits.map((d) => d.label)) + (hits.length === 1 ? ' differs' : ' differ') + ' from ' + lc(ref.label) + ' after Holm adjustment.');
    else parts.push('No single dose group differs from ' + lc(ref.label) + ' (smallest Holm-adjusted P ' + C.fmtPeq(Math.min(...res.pairs.map((d) => d.pHolm))) + ').');
  }
  $('verdict').textContent = parts.join(' ');
  const notes = res.warnings.slice();
  if (tool.alt !== 'two') notes.push('A one-sided P value is appropriate only if the direction was fixed before the data were seen.');
  if (notes.length) warn.append(el('ul', null, ...notes.map((t) => el('li', { text: t }))));

  const row = (cells, tag = 'td') => el('tr', null, ...cells.map((c) => el(tag, { text: c })));
  $('tbl-groups').replaceChildren(el('thead', null, row(['Group', 'Score', 'Events / n', '%', '95% CI (Wilson)'], 'th')),
    el('tbody', null, ...res.groups.map((g) => row([g.label, g.inTrend ? C.fmtScore(g.used) : 'not in trend', g.r + ' / ' + g.n, pct(g.p), pct(g.lo) + ' to ' + pct(g.hi)]))));
  const tp = $('tbl-pairs'), note = $('pairs-note');
  clear(tp);
  $('pairs-title').textContent = ref ? 'Each dose against ' + lc(ref.label) : 'Each dose against the reference';
  if (res.pairs.length) {
    tp.append(el('thead', null, row(['Comparison', 'Difference, pp', '95% CI (Newcombe)', 'Fisher P', 'Holm P'], 'th')),
      el('tbody', null, ...res.pairs.map((d) => row([d.label + ' vs ' + lc(ref.label), C.fmtSigned(100 * d.rd, 1), C.fmtNum(100 * d.lo, 1) + ' to ' + C.fmtNum(100 * d.hi, 1), C.fmtP(d.p), C.fmtP(d.pHolm)]))));
    note.textContent = 'Fisher’s exact test is used because each group is a different set of patients. McNemar’s test is for paired data, where the same patients are measured twice, and cannot be worked out from a table of separate groups.';
  } else note.textContent = 'Set one column to Reference in the grid to compare each dose group against it.';
  if (tr.computable && tr.departure) note.textContent += ' Departure from a linear trend: χ² = ' + C.fmtNum(tr.departure.chi2, 2) + ', df = ' + tr.departure.df + ', P ' + C.fmtPeq(tr.departure.p) + '.';
  $('txt-methods').textContent = methodsText(res);
  $('txt-results').textContent = resultsText(res);
}
function scoreSentence(res) {
  const tr = res.trend;
  return res.scoreType === 'rank' ? 'equally spaced scores (1 to ' + tr.scores.length + ') for the ' + listJoin(tr.labels.map(lc)) + ' groups' : 'scores of ' + listJoin(tr.scores.map(C.fmtScore)) + ' for the ' + listJoin(tr.labels.map(lc)) + ' groups';
}
function methodsText(res) {
  const tr = res.trend, ev = lc(res.event), s = [];
  if (tr.computable) {
    const side = tool.alt === 'two' ? 'two-sided' : 'one-sided, for ' + (tool.alt === 'inc' ? 'an increase' : 'a decrease') + ' with dose';
    s.push('A dose-related trend in the proportion of patients with ' + ev + ' was tested with the Cochran–Armitage test for trend (' + side + '), using ' + scoreSentence(res) + '.');
    s.push(tr.exact.method === 'mc' ? 'A permutation P value based on ' + tr.exact.B.toLocaleString('en-US') + ' Monte Carlo samples is also given.' : 'Because the groups are small, an exact conditional (permutation) P value is also given.');
  }
  if (res.pairs.length) {
    s.push('Each dose group was compared with ' + lc(res.ref.label) + ' by two-sided Fisher’s exact test' + (res.pairs.length > 1 ? ', and P values were adjusted for the ' + res.pairs.length + ' comparisons by the Holm method.' : '.'));
    s.push('Proportions are reported with Wilson 95% confidence intervals and differences in proportions with Newcombe hybrid-score 95% confidence intervals.');
  } else s.push('Proportions are reported with Wilson 95% confidence intervals.');
  return s.join(' ');
}
function resultsText(res) {
  const tr = res.trend, s = [];
  s.push(cap(res.event) + ' was reported by ' + listJoin(res.groups.map((g) => g.r + '/' + g.n + ' (' + pct(g.p) + '%) in the ' + lc(g.label) + ' group')) + '.');
  if (tr.computable) s.push('The Cochran–Armitage test for trend gave z = ' + C.fmtNum(tr.z, 2) + ', ' + sided() + ' P ' + C.fmtPeq(pickP(tr)) + ' (' + (tr.exact.method === 'mc' ? 'permutation' : 'exact') + ' P ' + C.fmtPeq(pickP(tr.exact)) + ').');
  const top = res.pairs.reduce((a, d) => (!a || Math.abs(d.rd) > Math.abs(a.rd) ? d : a), null);
  if (top) s.push('The difference from ' + lc(res.ref.label) + ' was largest for ' + top.label + ' (' + C.fmtSigned(100 * top.rd, 1) + ' percentage points, 95% CI ' + C.fmtNum(100 * top.lo, 1) + ' to ' + C.fmtNum(100 * top.hi, 1) + '; Fisher’s exact P ' + C.fmtPeq(top.p) + (res.pairs.length > 1 ? ', Holm-adjusted P ' + C.fmtPeq(top.pHolm) : '') + ').');
  return s.join(' ');
}

// ----- screenshot reading (asks Claude, with the viewer's consent) -----
let sampler = null, shotCtl = null, thumbUrl = null;
const PROMPT = 'The image shows a table from a clinical study: adverse events (rows) by treatment or dose group (columns). Transcribe it exactly.\n' +
  'Reply with only JSON in this shape:\n{"groups":[{"label":"Placebo","n":13},{"label":"400 mg","n":11}],"rows":[{"label":"Headache","counts":[4,3]}]}\nRules:\n' +
  '- groups: one entry per data column, left to right, including any Total column. label is the column name without the group size. n is the group size from the header, such as (n = 13), or null if it is not shown.\n' +
  '- rows: one entry per event row. counts has one number per column in the same order as groups: the number of patients, not the percentage. Use null for a cell that is empty or that you cannot read with confidence.\n' +
  '- When rows sit under a sub-heading such as "Increases in", put the sub-heading in front of each of those labels, for example "Increased alanine aminotransferase", and do not add the sub-heading as a row.\n' +
  '- Do not guess or fill in values. If the image has no such table, reply {"error":"no table"}.';
const shotHint = (t) => { $('shot-hint').textContent = t; };
function setShot(on) { $('drop').classList.toggle('off', !on); $('file-in').disabled = !on; if (on) shotHint('Claude reads the numbers from the image. You then check them in the grid.'); }
const busy = (on) => { $('shot-busy').hidden = !on; };
function readImage(file) {
  if (!sampler) { setMsg('Screenshot reading is not available in this view. Paste the table as text instead.', true); return; }
  if (!file || !/^image\//.test(file.type)) { setMsg('That file is not an image. Use a PNG or JPEG screenshot of the table.', true); return; }
  if (shotCtl) shotCtl.abort();
  const ctl = (shotCtl = new AbortController());
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(file);
  $('shot-thumb').src = thumbUrl; $('shot-thumb').hidden = false;
  busy(true);
  sampler.json(PROMPT, { images: [file], signal: ctl.signal }).then((data) => {
    busy(false);
    const parsed = C.fromExtraction(data);
    if (parsed.error) { setMsg(parsed.error + ' Try a sharper image, or paste the table as text.', true); return; }
    const blanks = parsed.rows.reduce((a, r) => a + r.counts.filter((v) => v === null).length, 0);
    if (blanks) parsed.notes.push(blanks + (blanks === 1 ? ' cell was' : ' cells were') + ' left blank because the image was unclear there.');
    loadParsed(parsed, 'Table read from the screenshot. Check every number against the image before you use the results.', null, false);
  }, (e) => {
    busy(false);
    const code = e && e.code;
    if (code === 'cancelled') return;
    if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable'].includes(code)) {
      sampler = null; setShot(false); shotHint('Screenshot reading is not available in this view. Paste the table as text instead.');
      setMsg('Claude was not allowed to read the image here. Paste the table as text instead.', true);
    } else if (code === 'rate_limited') setMsg('Too many requests just now. Wait a minute, then try the screenshot again.', true);
    else if (code === 'image_rejected') setMsg('That image could not be used (wrong type or too large). Try a PNG or JPEG screenshot.', true);
    else if (code === 'session_expired') setMsg('Your Claude session has expired. Sign in again, then retry the screenshot.', true);
    else setMsg('The image could not be read into a table. Try again, or paste the table as text.', true);
  });
}

// ----- wiring -----
$('btn-parse').onclick = parsePasted;
$('btn-example').onclick = loadExample;
$('btn-add-row').onclick = () => { tool.rows.push({ label: 'New event', counts: tool.groups.map(() => null) }); tool.sel = tool.rows.length - 1; renderGrid(); recompute(); const n = $('ev-name-' + tool.sel); if (n) { n.focus(); n.select(); } };
$('btn-add-col').onclick = () => { tool.groups.push({ label: 'New group', n: null, role: 'dose', score: null }); tool.rows.forEach((r) => r.counts.push(null)); renderGrid(); recompute(); const n = $('g-name-' + (tool.groups.length - 1)); if (n) { n.focus(); n.select(); } };
$('sel-event').onchange = () => selectRow(parseInt($('sel-event').value, 10) || 0);
$('sel-scores').onchange = () => { tool.scoreType = $('sel-scores').value; recompute(); };
$('sel-alt').onchange = () => { tool.alt = $('sel-alt').value; recompute(); };
$('chk-ref').onchange = () => { tool.includeRef = $('chk-ref').checked; recompute(); };
function copyText(text, done) {
  const fail = () => done(false);
  try { navigator.clipboard.writeText(text).then(() => done(true), fail); } catch { fail(); }
}
document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText($(b.dataset.copy).textContent, (ok) => { const old = b.textContent; b.textContent = ok ? 'Copied' : 'Copy blocked'; setTimeout(() => { b.textContent = old; }, 1500); })));
{
  const drop = $('drop');
  $('file-in').onchange = function () { if (this.files && this.files[0]) readImage(this.files[0]); this.value = ''; };
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); if (sampler) drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readImage(f); });
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData ? [...e.clipboardData.items] : [], img = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
    const tag = e.target && e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (img && !typing) { e.preventDefault(); readImage(img.getAsFile()); return; }
    if (typing) return;
    const txt = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (txt && txt.trim() && C.parseTable(txt).rows) { e.preventDefault(); $('paste-box').value = txt; parsePasted(); $('analyzer').scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth' }); }
  });
  $('btn-stop').onclick = () => { if (shotCtl) shotCtl.abort(); busy(false); };
  if (inClaude) {
    window.claude.use('sample').then((s) => (s ? s.limits().then((lim) => { if (lim && lim.images) { sampler = s; setShot(true); return true; } return false; }, () => false) : false))
      .then((ok) => { if (!ok) shotHint('Screenshot reading is not available in this view. Paste the table as text instead.'); });
  } else shotHint('Screenshot reading works when this page is open in Claude. Paste the table as text instead.');
}
