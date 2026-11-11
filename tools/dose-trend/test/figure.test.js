/* Builds the headache figure in every layout, validates the JSON, and writes SVG/PDF/JSON files to out/. */
const fs = require('fs'), path = require('path');
const C = require('../src/core.js'), F = require('../src/figure.js');
const out = path.join(__dirname, '..', 'out'); fs.mkdirSync(out, { recursive: true });
const fonts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pdf_fonts.json'), 'utf8'));
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// Layout measures text with Helvetica's widths; the embedded face has to agree or centred labels drift.
for (let c = 32; c < 127; c++) {
  ok(fonts.fonts.regular.widths[c] === F.HELV[c - 32], 'regular width of ' + JSON.stringify(String.fromCharCode(c)) + ': ' + fonts.fonts.regular.widths[c] + ' vs ' + F.HELV[c - 32]);
  ok(fonts.fonts.bold.widths[c] === F.HELV_B[c - 32], 'bold width of ' + JSON.stringify(String.fromCharCode(c)) + ': ' + fonts.fonts.bold.widths[c] + ' vs ' + F.HELV_B[c - 32]);
}

ok(F.HELV.length === 95 && F.HELV_B.length === 95, 'metric tables cover 32..126');
ok(Math.abs(F.textW('Placebo', 1000) - (667 + 222 + 556 + 500 + 556 + 556 + 556)) < 1e-9, 'Helvetica width of "Placebo"');

const groups = [
  { label: 'Placebo', n: 13, role: 'ref', score: 0 }, { label: '400 mg', n: 11, role: 'dose', score: 400 },
  { label: '800 mg', n: 12, role: 'dose', score: 800 }, { label: '1200 mg', n: 14, role: 'dose', score: 1200 },
  { label: '1600 mg', n: 13, role: 'dose', score: 1600 }];
const res = C.analyze({ groups, counts: [4, 3, 4, 6, 8], event: 'Headache', scoreType: 'dose', includeRef: true });
const img = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'assets', 'biorender-panel-a.jpg')).toString('base64');
const study = { population: 'Antiretroviral-naive adults with HIV-1 infection', design: 'Randomized, double-blind', duration: '10 days of oral dosing', outcome: 'Adverse events recorded', groupLabel: 'Apricitabine dose groups' };
const base = { journal: 'nature', column: 'double', panelA: 'schematic', style: 'bars', palette: 'soft', pA: 'asym', pB: 'holm', alt: 'two', xTitle: 'Apricitabine dose (mg per day)', study, image: { href: img, width: 1600, height: 742 } };
const variants = {
  'nature-double-schematic': {}, 'nature-double-biorender': { panelA: 'image' }, 'nature-double-none': { panelA: 'none' },
  'nature-single-schematic': { column: 'single' }, 'nature-single-biorender': { column: 'single', panelA: 'image' }, 'nature-onehalf-points-grey': { column: 'onehalf', style: 'points', palette: 'grey', pA: 'exact' },
  'lancet-double': { journal: 'lancet' }, 'science-single': { journal: 'science', column: 'single', panelA: 'none' }
};
for (const [name, v] of Object.entries(variants)) {
  const o = Object.assign({}, base, v), { figure, style } = F.buildFigure(res, o);
  const problems = F.validate(figure, style);
  ok(problems.length === 0, name + ' validation: ' + problems.join(' | '));
  const svg = F.renderSVG(figure, style), pdf = F.renderPDF(figure, style, { fonts }), pdfBase = F.renderPDF(figure, style);
  const text = Buffer.from(pdf).toString('latin1');
  ok(/\/Subtype \/TrueType/.test(text) && /\/FontFile2 \d+ 0 R/.test(text) && !/\/Subtype \/Type1/.test(text) && !/\/Type3/.test(text), name + ' pdf embeds TrueType and names no unembedded font');
  ok(/\/Subtype \/Type1 \/BaseFont \/Helvetica/.test(Buffer.from(pdfBase).toString('latin1')), name + ' pdf without font data falls back to standard Helvetica');
  ok(svg.startsWith('<svg') && svg.includes('<!-- Target: ') && svg.includes('<title>'), name + ' svg header');
  ok(Buffer.from(pdf.slice(0, 8)).toString('latin1').startsWith('%PDF-1.4'), name + ' pdf header');
  // every text item sits inside the canvas, and texts in the same panel row do not overlap horizontally
  const L = F.displayList(figure).filter(q => q.op === 'text' && !q.rotate);
  for (const t of L) {
    const w = F.textW(t.runs.map(r => r.t).join(''), t.size, t.bold), x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
    ok(x0 >= -0.5 && x0 + w <= figure.canvas.width + 0.5, name + ' text outside canvas: ' + t.runs.map(r => r.t).join('') + ' [' + x0.toFixed(0) + ',' + (x0 + w).toFixed(0) + '] of ' + figure.canvas.width);
    t._x0 = x0; t._x1 = x0 + w;
  }
  let clashes = 0;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (Math.abs(a.y - b.y) < Math.min(a.size, b.size) * 0.8 && a._x0 < b._x1 - 1 && b._x0 < a._x1 - 1) { clashes++; if (clashes < 4) console.log('  overlap in', name, ':', JSON.stringify(a.runs.map(r => r.t).join('')), 'and', JSON.stringify(b.runs.map(r => r.t).join(''))); }
  }
  ok(clashes === 0, name + ' has ' + clashes + ' overlapping text pairs');
  fs.writeFileSync(path.join(out, name + '.svg'), svg); fs.writeFileSync(path.join(out, name + '.pdf'), pdf); fs.writeFileSync(path.join(out, name + '.base14.pdf'), pdfBase);
  fs.writeFileSync(path.join(out, name + '.json'), JSON.stringify(figure, (k, val) => k === 'image_href' ? '(image data)' : val, 1));
  console.log(name.padEnd(30), figure.canvas.width_mm + ' x ' + figure.canvas.height_mm + ' mm', '| elements', figure.elements.length, 'annotations', figure.annotations.length, 'connectors', figure.connectors.length, '| svg', svg.length, 'pdf', pdf.length);
}
// the branching node follows the stated design
for (const [design, want] of [['Randomized, double-blind', true], ['randomised, open-label', true], ['Observational, not randomized', false], ['Non-randomised cohort', false], ['unrandomized', false], ['', false], ['Prospective cohort', false]]) {
  ok(F.isRandomized(design) === want, 'isRandomized(' + JSON.stringify(design) + ') should be ' + want);
  const fig = F.buildFigure(res, Object.assign({}, base, { study: Object.assign({}, study, { design }) })).figure, node = fig.elements.find(e => e.id === 'node_allocation');
  ok(node && (want ? node.type === 'diamond' && node.label === 'R' : node.type === 'circle' && !node.label), 'allocation node for ' + JSON.stringify(design) + ': ' + (node && node.type));
  ok(/were (randomized|allocated) to/.test(fig.figure_meta.caption) && (fig.figure_meta.caption.includes('randomized to') === want), 'caption wording for ' + JSON.stringify(design));
}
// path parser
ok(JSON.stringify(F.parsePath('M1 2 H5 V7 l1 1 Z')) === JSON.stringify([['m', 1, 2], ['l', 5, 2], ['l', 5, 7], ['l', 6, 8], ['h']]), 'path parser');
// validation catches problems
const broken = JSON.parse(JSON.stringify(F.buildFigure(res, base).figure));
broken.connectors[0].to = 'nowhere'; broken.annotations[3].font_size = 10; broken.annotations[5].id = broken.annotations[4].id;
ok(F.validate(broken, F.makeStyle(base)).length === 3, 'validation finds 3 planted problems: ' + F.validate(broken, F.makeStyle(base)).join(' | '));
console.log(fails ? fails + ' FAILED' : 'FIGURE CHECKS PASSED');
process.exit(fails ? 1 : 0);
