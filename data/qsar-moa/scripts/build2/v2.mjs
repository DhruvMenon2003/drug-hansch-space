// Parse-check the hand-written verification files and bounds-check their record numbers.
import fs from 'node:fs';
const ex = process.argv[2];
const count = {};
for (const f of fs.readdirSync(ex).filter(f => /^ch\d+\.json$/.test(f))) {
  const j = JSON.parse(fs.readFileSync(`${ex}/${f}`, 'utf8'));
  count[j.chapter_number] = (j.records || []).length;
}
const p = `${ex}/verify/drugbank-comparison.json`;
let j;
try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('drugbank-comparison.json DOES NOT PARSE:', e.message); process.exit(1); }
const arr = Array.isArray(j) ? j : (j.records || j.comparisons || Object.values(j).find(Array.isArray));
console.log('top keys', Array.isArray(j) ? '(array)' : Object.keys(j).join(','));
console.log('entries', arr.length);
const bad = arr.filter(r => !(r.record_number >= 1 && r.record_number <= (count[r.chapter] || 0)));
console.log('out-of-range record numbers', bad.length);
const dup = new Set(), seen = new Set();
for (const r of arr) { const k = r.chapter + ':' + r.record_number; if (seen.has(k)) dup.add(k); seen.add(k); }
console.log('duplicate keys', dup.size);
const tally = k => arr.reduce((m, r) => (m[String(r[k])] = (m[String(r[k])] || 0) + 1, m), {});
console.log('agreement', tally('agreement'));
console.log('drugbank_status', tally('drugbank_status'));
console.log('kind', tally('kind'));
console.log('fields', Object.keys(arr[0]).join(','));
for (const f of fs.readdirSync(`${ex}/verify`).filter(f => /recall/i.test(f) && f.endsWith('.json'))) {
  try { JSON.parse(fs.readFileSync(`${ex}/verify/${f}`, 'utf8')); console.log('parses:', f); }
  catch (e) { console.log('BROKEN:', f, e.message); }
}
