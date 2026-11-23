// Dependency-free reader for an unpacked .xlsx (read-only inspection).
import fs from 'node:fs';
const dir = process.argv[2];
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const ss = [];
{
  const x = fs.readFileSync(`${dir}/xl/sharedStrings.xml`, 'utf8');
  for (const m of x.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let t = '';
    for (const n of m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += n[1];
    ss.push(dec(t));
  }
}
function sheet(n) {
  const x = fs.readFileSync(`${dir}/xl/worksheets/sheet${n}.xml`, 'utf8');
  const cells = new Map();
  for (const m of x.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, row, attrs, body] = m;
    if (!body) continue;
    const f = body.match(/<f[^>]*>([\s\S]*?)<\/f>/);
    const v = body.match(/<v>([\s\S]*?)<\/v>/);
    const is = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
    let val = v ? dec(v[1]) : is ? dec(is[1]) : null;
    if (/t="s"/.test(attrs) && v) val = ss[+v[1]];
    if (!cells.has(+row)) cells.set(+row, {});
    cells.get(+row)[col] = { v: val, f: f ? dec(f[1]) : (body.includes('<f') ? '(shared formula)' : null) };
  }
  return cells;
}
const cut = (s, n = 300) => (s == null ? s : String(s).slice(0, n));
const lb = sheet(1);
console.log('--- top block rows 1-23');
for (let r = 1; r <= 23; r++) { const o = lb.get(r); if (!o) continue; for (const [c, x] of Object.entries(o)) console.log(`  ${c}${r}: v=${JSON.stringify(cut(x.v, 160))}${x.f ? ' f=' + cut(x.f, 260) : ''}`); }
const hdr = {}; for (const [c, x] of Object.entries(lb.get(24))) hdr[c] = x.v;
console.log('HEADER', JSON.stringify(hdr));
const show = r => { for (const [c, x] of Object.entries(lb.get(r) || {})) console.log(`    ${c}${r} [${hdr[c] ?? ''}]: ${JSON.stringify(cut(x.v, 300))}${x.f ? '  f=' + cut(x.f, 120) : ''}`); };
for (const r of [25, 26]) { console.log('ROW', r); show(r); }
const rows = [...lb.keys()].filter(r => r >= 25).sort((a, b) => a - b);
console.log('data rows', rows.length, 'last', rows.at(-1));
for (const r of rows) { const n = lb.get(r).Z?.v; if (n && /pricitabine|dOTC|AVX/i.test(n)) { console.log('FOUND', r, n); show(r); } }
for (const c of Object.keys(hdr)) { let k = 0; for (const r of rows) { const x = lb.get(r)[c]; if (x && x.v !== null && x.v !== '' && x.v !== '0') k++; } console.log(`FILL ${c} ${hdr[c]}: ${k}/${rows.length}`); }
const cnt = new Map(); for (const r of rows) { const t = lb.get(r).AC?.v ?? '(blank)'; cnt.set(t, (cnt.get(t) || 0) + 1); }
const top = [...cnt].sort((a, b) => b[1] - a[1]);
console.log('TARGET distinct', top.length); console.log(top.slice(0, 60).map(([k, v]) => `${v}  ${k}`).join('\n'));
console.log('TARGET tail sample'); console.log(top.slice(-40).map(([k, v]) => `${v}  ${k}`).join('\n'));
const multi = top.filter(([k]) => /[;,\/|]| and /.test(k)); console.log('targets with separators', multi.length, multi.slice(0, 15).map(x => x[0]));
// provenance
const dp = sheet(3); const dr = [...dp.keys()].filter(r => r >= 2).sort((a, b) => a - b);
console.log('DP rows', dr.length);
const names = { B: 'Column', F: 'Source', H: 'Rule', I: 'Flags' };
for (const [c, name] of Object.entries(names)) { const m = new Map(); for (const r of dr) { const k = cut(dp.get(r)[c]?.v ?? '(blank)', 120); m.set(k, (m.get(k) || 0) + 1); } const t = [...m].sort((a, b) => b[1] - a[1]); console.log('DP', name, 'distinct', t.length); console.log(t.slice(0, 30).map(([k, v]) => `   ${v}  ${k}`).join('\n')); }
const dshow = r => console.log('DPROW', r, JSON.stringify(Object.fromEntries(Object.entries(dp.get(r) || {}).map(([c, x]) => [c, cut(x.v, 320)]))));
for (const r of [7153, 7154, 7155, 7156, 7157, 7200, 8000, 9000, 10000, 10500, 11000, 11249, 11250]) dshow(r);
let k = 0; for (const r of dr) { if (/pricitabine/i.test(dp.get(r).C?.v || '')) { if (k++ < 40) dshow(r); } } console.log('apricitabine provenance rows', k);
const ds = sheet(4); let n = 0; for (const r of ds.keys()) if (ds.get(r).B) n++; console.log('Dashboard Support col B rows', n);
for (const r of [1, 2, 3, 4, 5]) console.log('DS', r, JSON.stringify(ds.get(r)));
