// Verify each extracted quote against the book PDF and crop a screenshot around it.
// usage: node verify_crop.mjs <extractionDir> <bookPdf> <outDir>
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [exDir, pdf, outDir] = process.argv.slice(2);
const shotDir = `${outDir}/screenshots`;
fs.mkdirSync(shotDir, { recursive: true });
const norm = s => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const pageCache = new Map();
function page(p) {
  if (pageCache.has(p)) return pageCache.get(p);
  const x = execFileSync('pdftotext', ['-bbox', '-f', String(p), '-l', String(p), pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const pg = x.match(/<page width="([\d.]+)" height="([\d.]+)"/);
  const words = [...x.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)].map(m => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: norm(dec(m[5])) })).filter(w => w.t);
  let s = ''; const owner = [];
  words.forEach((w, i) => { for (let k = 0; k < w.t.length; k++) owner.push(i); s += w.t; });
  const r = { w: +pg[1], h: +pg[2], words, s, owner };
  pageCache.set(p, r); return r;
}
function find(p, quote) {
  const pg = page(p); const q = norm(quote);
  if (q.length < 8) return null;
  let i = pg.s.indexOf(q), kind = 'exact';
  if (i < 0) { // try the longest piece between ellipses / brackets
    const pieces = quote.split(/\.\.\.|…|\[[^\]]*\]/).map(norm).filter(x => x.length >= 20).sort((a, b) => b.length - a.length);
    for (const pc of pieces) { i = pg.s.indexOf(pc); if (i >= 0) { kind = 'partial (longest unbroken piece of the quote)'; return box(pg, i, pc.length, kind); } }
    const head = q.slice(0, 40); i = q.length > 60 ? pg.s.indexOf(head) : -1;
    if (i >= 0) return box(pg, i, head.length, 'partial (first 40 characters only)');
    return null;
  }
  return box(pg, i, q.length, kind);
}
function box(pg, i, len, kind) {
  const ws = [...new Set(pg.owner.slice(i, i + len))].map(k => pg.words[k]);
  return { kind, y0: Math.min(...ws.map(w => w.y0)), y1: Math.max(...ws.map(w => w.y1)), x0: Math.min(...ws.map(w => w.x0)), x1: Math.max(...ws.map(w => w.x1)), pw: pg.w, ph: pg.h };
}
const slug = s => (s || 'class').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const out = []; const bad = [];
const DPI = 200, K = DPI / 72, PAD = 36;
for (const f of fs.readdirSync(exDir).filter(f => /^ch\d+\.json$/.test(f)).sort()) {
  let j; try { j = JSON.parse(fs.readFileSync(`${exDir}/${f}`, 'utf8')); } catch (e) { bad.push(f); continue; }
  const shots = new Map(); let n = 0;
  for (const r of j.records || []) {
    n++;
    const rec = { chapter: j.chapter_number, chapter_title: j.chapter_title, record_no: n, ...r };
    let p = r.pdf_page_index, hit = null, where = p;
    for (const cand of [p, p + 1, p - 1]) { if (cand < 1) continue; try { hit = find(cand, r.quote || ''); } catch (e) { hit = null; } if (hit) { where = cand; break; } }
    rec.quote_found_in_pdf = !!hit; rec.quote_match = hit ? hit.kind : 'NOT FOUND on stated page or the pages next to it'; rec.verified_pdf_page = hit ? where : null;
    rec.page_matches_helper = hit ? where === p : null;
    if (hit) {
      const key = `${where}|${Math.round(hit.y0)}|${Math.round(hit.y1)}`;
      if (!shots.has(key)) {
        const name = `ch${String(j.chapter_number).padStart(2, '0')}_pdfpage${String(where).padStart(3, '0')}_${String(shots.size + 1).padStart(2, '0')}_${slug(r.drug || r.mechanism_rule_name)}`;
        const y = Math.max(0, hit.y0 - PAD), h = Math.min(hit.ph, hit.y1 + PAD) - y;
        execFileSync('pdftoppm', ['-f', String(where), '-l', String(where), '-r', String(DPI), '-x', '0', '-y', String(Math.round(y * K)), '-W', String(Math.round(hit.pw * K)), '-H', String(Math.round(h * K)), '-png', '-singlefile', pdf, `${shotDir}/${name}`]);
        shots.set(key, `screenshots/${name}.png`);
      }
      rec.screenshot = shots.get(key);
    } else rec.screenshot = null;
    out.push(rec);
  }
}
fs.writeFileSync(`${outDir}/records_verified.json`, JSON.stringify(out, null, 1));
const c = k => out.reduce((m, r) => (m[String(r[k])] = (m[String(r[k])] || 0) + 1, m), {});
console.log('invalid json files', bad);
console.log('records', out.length, 'quote_match', c('quote_match'), 'page ok', c('page_matches_helper'));
console.log('screenshots', fs.readdirSync(shotDir).length);
for (const r of out.filter(r => !r.quote_found_in_pdf)) console.log('NOTFOUND', r.chapter, r.record_no, r.pdf_page_index, r.drug, '|', r.mechanism_rule_name);
