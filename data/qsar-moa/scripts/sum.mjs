import fs from 'node:fs';
const dir = process.argv[2];
const keyCount = {};
for (const f of fs.readdirSync(dir).filter(f => /^ch\d+\.json$/.test(f)).sort()) {
  let j;
  try { j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); } catch (e) { console.log(f, 'INVALID JSON', e.message); continue; }
  const recs = Array.isArray(j) ? j : (j.records || j.mechanisms || []);
  console.log(`== ${f} top keys: ${Array.isArray(j) ? '(array)' : Object.keys(j).join(',')} records=${recs.length}`);
  for (const r of recs) {
    for (const k of Object.keys(r)) keyCount[k] = (keyCount[k] || 0) + 1;
    const g = (...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== null) return r[k]; return ''; };
    console.log(`  p${g('pdf_page_index', 'pdf_page')} | ${g('target_class')} | drug=${g('drug')} | moa=${g('mechanism_rule_format', 'mechanism')} | book="${String(g('book_wording', 'mechanism_book_wording')).slice(0, 70)}" | nums=${String(g('numbers_kind', 'numbers_given')).slice(0, 40)} | rule=${g('naming_rule_applies')} | qlen=${String(g('quote')).length}`);
  }
}
console.log('KEYS', keyCount);
