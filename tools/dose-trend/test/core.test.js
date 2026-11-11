/* Checks core.js against scipy/statsmodels reference values and exercises the table parser. */
const fs = require('fs');
const C = require('../src/core.js');
const path = require('path');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ref', 'reference.json'), 'utf8'));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ref', 'cases.json'), 'utf8'));

let fails = 0, checks = 0;
function close(name, got, want, tol) {
  checks++;
  tol = tol || 1e-9;
  const ok = Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)) || (Math.abs(want) < 1e-300 && Math.abs(got) < 1e-300);
  if (!ok) { fails++; if (fails < 40) console.log('FAIL', name, 'got', got, 'want', want); }
}
function relClose(name, got, want, tol) {
  checks++;
  const ok = Math.abs(got - want) <= tol * Math.abs(want) + 1e-300;
  if (!ok) { fails++; if (fails < 40) console.log('FAIL', name, 'got', got, 'want', want); }
}
function eq(name, got, want) {
  checks++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)); }
}

// --- special functions, intervals, tests ---
cases.normsf.forEach(([z, p]) => relClose('normSf(' + z + ')', C.normSf(z), p, 1e-11));
cases.chi2sf.forEach(([x, df, p]) => relClose('chi2Sf(' + x + ',' + df + ')', C.chi2Sf(x, df), p, 1e-10));
cases.wilson.forEach(([r, n, lo, hi]) => { const w = C.wilson(r, n); close('wilson lo ' + r + '/' + n, w[0], lo, 1e-10); close('wilson hi ' + r + '/' + n, w[1], hi, 1e-10); });
cases.newcombe.forEach(([r1, n1, r2, n2, lo, hi]) => { const w = C.newcombe(r1, n1, r2, n2); close('newcombe lo', w[0], lo, 1e-10); close('newcombe hi', w[1], hi, 1e-10); });
cases.fisher.forEach(([a, b, c, d, p]) => close('fisher ' + [a, b, c, d], C.fisherExact(a, b, c, d), p, 1e-9));
cases.holm.forEach(([ps, adj]) => C.holm(ps).forEach((v, i) => close('holm', v, adj[i], 1e-12)));
cases.trend.forEach((t, i) => {
  const ca = C.cochranArmitage(t.x, t.r, t.n);
  close('CA z #' + i, ca.z, t.z, 1e-9);
  relClose('CA p #' + i, ca.pTwo, t.p_two, 1e-9);
  relClose('CA pInc #' + i, ca.pInc, t.p_inc, 1e-9);
  close('overall chi2 #' + i, ca.overall.chi2, t.chi_all, 1e-9);
  const ex = C.exactTrend(t.x, t.r, t.n);
  close('exact two #' + i, ex.pTwo, t.ex_two, 1e-9);
  close('exact inc #' + i, ex.pInc, t.ex_inc, 1e-9);
  close('exact dec #' + i, ex.pDec, t.ex_dec, 1e-9);
  close('exact total #' + i, ex.total, 1, 1e-9);
});

// --- the headache row, end to end ---
const groups = [
  { label: 'Placebo', n: 13, role: 'ref', score: 0 }, { label: '400 mg', n: 11, role: 'dose', score: 400 },
  { label: '800 mg', n: 12, role: 'dose', score: 800 }, { label: '1200 mg', n: 14, role: 'dose', score: 1200 },
  { label: '1600 mg', n: 13, role: 'dose', score: 1600 }, { label: 'Total', n: 50, role: 'skip', score: null }];
const res = C.analyze({ groups, counts: [4, 3, 4, 6, 8, 21], event: 'Headache', scoreType: 'dose', includeRef: true });
const R = ref.ca_actual_doses;
close('headache z', res.trend.z, R.z); close('headache chi2', res.trend.chi2, R.chi2);
close('headache p', res.trend.pTwo, R.p_two); close('headache pInc', res.trend.pInc, R.p_greater);
close('headache exact two', res.trend.exact.pTwo, ref.exact_actual_doses.p_two);
close('headache exact inc', res.trend.exact.pInc, ref.exact_actual_doses.p_greater);
close('departure chi2', res.trend.departure.chi2, ref.departure_from_linearity.chi2, 1e-8);
close('departure p', res.trend.departure.p, ref.departure_from_linearity.p, 1e-8);
close('overall p', res.trend.overall.p, ref.overall_chi2.p, 1e-9);
ref.groups.forEach((g, i) => { close('grp pct', 100 * res.groups[i].p, g.pct); close('grp lo', 100 * res.groups[i].lo, g.wilson_lo); close('grp hi', 100 * res.groups[i].hi, g.wilson_hi); });
ref.pairwise_vs_placebo.forEach((d, i) => {
  const q = res.pairs[i];
  close('pair rd', 100 * q.rd, d.rd); close('pair lo', 100 * q.lo, d.rd_lo); close('pair hi', 100 * q.hi, d.rd_hi);
  close('pair p', q.p, d.p_fisher); close('pair holm', q.pHolm, d.p_holm);
});
// options: equally spaced scores and active doses only
const rank = C.analyze({ groups, counts: [4, 3, 4, 6, 8, 21], scoreType: 'rank', includeRef: true });
close('rank z', rank.trend.z, ref.ca_equal_scores.z);
const act = C.analyze({ groups, counts: [4, 3, 4, 6, 8, 21], scoreType: 'dose', includeRef: false });
close('active-only z', act.trend.z, ref.ca_active_only.z);
close('active-only exact', act.trend.exact.pTwo, ref.exact_active_only.p_two);

// Monte Carlo fallback lands near the exact answer
const mc = C.monteCarloTrend([0, 400, 800, 1200, 1600], [4, 3, 4, 6, 8], [13, 11, 12, 14, 13], 200000);
close('MC two-sided', mc.pTwo, ref.exact_actual_doses.p_two, 5e-3);
close('MC increasing', mc.pInc, ref.exact_actual_doses.p_greater, 5e-3);
// large groups: exact still sums to one and agrees with the asymptotic test
const bigX = [0, 1, 2, 3], bigR = [40, 55, 61, 78], bigN = [300, 310, 295, 305];
const bigE = C.exactTrend(bigX, bigR, bigN), bigA = C.cochranArmitage(bigX, bigR, bigN);
close('big exact total', bigE.total, 1, 1e-8);
checks++; if (Math.abs(Math.log(bigE.pTwo / bigA.pTwo)) > 0.15) { fails++; console.log('FAIL big exact vs asymptotic', bigE.pTwo, bigA.pTwo); }

// --- formatting ---
eq('fmtP', [0.0773, 0.0896, 0.2377, 0.951, 1, 0.0004, 0.0995, 0.012, 0.995].map(C.fmtP), ['0.077', '0.090', '0.24', '0.95', '>0.99', '<0.001', '0.10', '0.012', '>0.99']);
eq('fmtPeq', [0.0773, 0.0004, 1].map(C.fmtPeq), ['= 0.077', '< 0.001', '> 0.99']);
eq('fmtSigned', [0.3077, -0.035, 0].map(v => C.fmtSigned(100 * v, 1)), ['+30.8', '−3.5', '0.0']);

// --- parser ---
const expectGroups = [['Placebo', 13, 'ref', 0], ['400 mg', 11, 'dose', 400], ['800 mg', 12, 'dose', 800], ['1200 mg', 14, 'dose', 1200], ['1600 mg', 13, 'dose', 1600], ['Total', 50, 'skip']];
function checkParse(name, text, wantRows) {
  const p = C.parseTable(text);
  if (p.error) { fails++; console.log('FAIL', name, p.error); return p; }
  eq(name + ' groups', p.groups.map(g => [g.label, g.n, g.role].concat(g.role === 'skip' ? [] : [g.score])), expectGroups);
  eq(name + ' rows', p.rows.map(r => [r.label].concat(r.counts)), wantRows);
  return p;
}
const wantRows = [
  ['All [n (%)]', 9, 9, 8, 11, 11, 39], ['Headache', 4, 3, 4, 6, 8, 21], ['Nasal congestion', 1, 1, 1, 3, 2, 7],
  ['Alanine aminotransferase', 4, 1, 2, 0, 3, 6], ['Aspartate aminotransferase', 5, 0, 3, 1, 3, 7],
  ['Blood amylase', 0, 1, 1, 1, 3, 6], ['Blood creatinine', 5, 3, 2, 2, 3, 10], ['Blood sodium', 3, 2, 1, 1, 2, 6], ['Lipase', 3, 2, 3, 1, 4, 10]];
const pdfText = `Apricitabine dose groups
Event Placebo (n = 13) 400 mg (n = 11) 800 mg (n = 12) 1200 mg (n = 14) 1600 mg (n = 13) Total (n = 50)
All [n (%)] 9 (69.2) 9 8 11 11 39 (78.0)
Headache 4 (30.8) 3 4 6 8 21 (42.0)
Nasal congestion 1 (7.7) 1 1 3 2 7 (14.0)
Increases in
Alanine aminotransferase 4 (30.8) 1 2 0 3 6 (12.0)
Aspartate aminotransferase 5 (38.5) 0 3 1 3 7 (14.0)
Blood amylase 0 (0.0) 1 1 1 3 6 (12.0)
Blood creatinine 5 (38.5) 3 2 2 3 10 (20.0)
Blood sodium 3 (23.1) 2 1 1 2 6 (12.0)
Lipase 3 (23.1) 2 3 1 4 10 (20.0)`;
checkParse('pdf text', pdfText, wantRows);
const tsv = pdfText.split('\n').map((l, i) => {
  if (i === 0) return '\t\tApricitabine dose groups';
  if (i === 1) return ['Event', 'Placebo (n = 13)', '400 mg (n = 11)', '800 mg (n = 12)', '1200 mg (n = 14)', '1600 mg (n = 13)', 'Total (n = 50)'].join('\t');
  const t = C.parseTable('X (n = 1) Y (n = 1) Z (n=1) A (n=1) B (n=1) C (n=1)\n' + l);
  if (t.error) return l;
  const cells = l.match(/\d+(?: \(\d+\.\d\))?/g);
  return [t.rows[0].label].concat(cells).join('\t');
}).join('\n');
checkParse('tab separated', tsv, wantRows);
checkParse('comma separated', tsv.split('\n').slice(1).map(l => l.split('\t').join(',')).join('\n'), wantRows);
checkParse('markdown pipes', tsv.split('\n').slice(1).map((l, i) => '| ' + l.split('\t').join(' | ') + ' |' + (i === 0 ? '\n|---|---|---|---|---|---|---|' : '')).join('\n'), wantRows);
// header split over two rows, with the group sizes on their own row
const twoRow = 'Event\tPlacebo\t400 mg\t800 mg\t1200 mg\t1600 mg\tTotal\n\t(n = 13)\t(n = 11)\t(n = 12)\t(n = 14)\t(n = 13)\t(n = 50)\nHeadache\t4 (30.8)\t3\t4\t6\t8\t21 (42.0)';
checkParse('two-row header', twoRow, [wantRows[1]]);
// "N" row instead of header n, percentages with % sign, n/N cells
const nRow = C.parseTable('Term\tPlacebo\t10 mg\t20 mg\nN\t20\t21\t19\nNausea\t2 (10.0%)\t5/21 (23.8%)\t7 (36.8%)');
eq('N row groups', nRow.groups.map(g => [g.label, g.n, g.role, g.score]), [['Placebo', 20, 'ref', 0], ['10 mg', 21, 'dose', 10], ['20 mg', 19, 'dose', 20]]);
eq('N row rows', nRow.rows.map(r => [r.label].concat(r.counts)), [['Nausea', 2, 5, 7]]);
// free text without n in the header
const noN = C.parseTable('Event Placebo 5 mg 10 mg 20 mg\nDizziness 1 2 4 6\nGrade 3 rash 0 1 1 3');
eq('no-n groups', noN.groups.map(g => [g.label, g.n, g.role, g.score]), [['Placebo', null, 'ref', 0], ['5 mg', null, 'dose', 5], ['10 mg', null, 'dose', 10], ['20 mg', null, 'dose', 20]]);
eq('no-n rows', noN.rows.map(r => [r.label].concat(r.counts)), [['Dizziness', 1, 2, 4, 6], ['Grade 3 rash', 0, 1, 1, 3]]);
eq('garbage', !!C.parseTable('hello world').error, true);
eq('empty', !!C.parseTable('').error, true);
// screenshot JSON
const fx = C.fromExtraction({ groups: [{ label: 'Placebo', n: 13 }, { label: '1,200 mg', n: 14 }, { label: 'Total', n: 50 }], rows: [{ label: 'Headache', counts: [4, 6, 21] }, { label: 'x', counts: [null, null, null] }] });
eq('extraction', [fx.groups.map(g => [g.role, g.score]), fx.rows.length], [[['ref', 0], ['dose', 1200], ['skip', null]], 1]);
eq('extraction error', !!C.fromExtraction({ error: 'no table' }).error, true);

// --- validation messages ---
const bad = C.analyze({ groups: groups.slice(0, 3), counts: [14, 3, null] });
eq('validation', [bad.ok, bad.errors.length], [false, 2]);
const zero = C.analyze({ groups: groups.slice(0, 3), counts: [0, 0, 0] });
eq('no events', [zero.ok, zero.trend.computable], [true, false]);


// --- regressions from review ---
function ok(cond, name) { checks++; if (!cond) { fails++; if (fails < 40) console.log('FAIL', name); } }
// exact test: large groups with few events must not underflow to NaN (two groups: hypergeometric, P(T>=2 | R=3) = 0.5)
{
  const e = C.exactTrend([0, 1], [1, 2], [1100, 1100]);
  ok(e && Number.isFinite(e.pTwo) && Number.isFinite(e.pInc) && Math.abs(e.total - 1) < 1e-9, 'exactTrend 2x1100 normalises');
  ok(e && Math.abs(e.pInc - 0.5) < 1e-9 && Math.abs(e.pTwo - 1) < 1e-9, 'exactTrend 2x1100 equals the hypergeometric tail: pInc=' + (e && e.pInc) + ' pTwo=' + (e && e.pTwo));
  const a = C.analyze({ groups: [{ label: 'A', n: 1100, role: 'ref', score: 0 }, { label: 'B', n: 1100, role: 'dose', score: 1 }], counts: [1, 2], event: 'x', scoreType: 'dose', includeRef: true });
  ok(Number.isFinite(a.trend.exact.pTwo), 'analyze: exact P is a number for 2x1100 (' + a.trend.exact.method + ')');
  const e2 = C.exactTrend([0, 1, 2], [0, 0, 1], [5000, 5000, 5000]);
  ok(e2 && Math.abs(e2.total - 1) < 1e-9 && Math.abs(e2.pInc - 1 / 3) < 1e-9, 'exactTrend 3x5000 with one event: pInc = 1/3');
}
// percentage-only cells are not counts
{
  for (const c of ['10%', '10 %', '30.8%', '<1%']) ok(C.parseCount(c) === null, 'parseCount refuses ' + JSON.stringify(c));
  for (const [c, v] of [['4 (30.8)', 4], ['4 (30.8%)', 4], ['4/13', 4], ['0', 0], ['12', 12], ['4 [30.8]', 4]]) ok(C.parseCount(c) === v, 'parseCount accepts ' + JSON.stringify(c));
  const t = C.parseTable('Event\tA (n = 200)\tB (n = 200)\tC (n = 200)\nRash\t10%\t20%\t30%\nNausea\t3 (1.5%)\t5\t7 (3.5)\n');
  ok(t.rows.length === 1 && t.rows[0].label === 'Nausea' && t.notes.some(n => /percentage/.test(n)), 'tab table: the percentage row is left out with a note');
  const u = C.parseTable('Event\tA (n = 200)\tB (n = 200)\tC (n = 200)\nRash\t10%\t20%\t30%\n');
  ok(u.error && /percentages but no counts/.test(u.error), 'a table of only percentages is refused with a specific message');
  const f = C.parseTable('Event A (n = 200) B (n = 200) C (n = 200)\nRash 10% 20% 30%\nNausea 3 (1.5%) 5 7 (3.5)\n');
  ok(f.rows.length === 1 && f.notes.some(n => /percentages/.test(n)), 'free-text table: the percentage line is left out with a note');
}
console.log(fails === 0 ? 'ALL ' + checks + ' CHECKS PASSED' : fails + ' of ' + checks + ' checks FAILED');
process.exit(fails ? 1 : 0);
