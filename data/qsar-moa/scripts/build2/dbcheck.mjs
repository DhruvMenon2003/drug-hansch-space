// DrugBank check for every row. Order: Star's own export, then PubChem's copy of DrugBank's "Mechanism of action".
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ALIAS } from '../scripts/config.mjs';
const out = process.argv[2];
const d = JSON.parse(fs.readFileSync(`${out}/rows.json`, 'utf8'));
const idx = JSON.parse(fs.readFileSync(`${out}/drugbank_index.json`, 'utf8'));
const byName = new Map(idx.map(x => [x.name.toLowerCase(), x]));
const cacheFile = `${out}/drugbank_moa_text.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const get = u => { try { return JSON.parse(execFileSync('curl', ['-sS', '-m', '45', u], { encoding: 'utf8', maxBuffer: 1 << 26 })); } catch (e) { return null; } };
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const clean = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function moaFromCid(cid) {
  const v = get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Mechanism+of+Action`);
  const refs = new Map((v?.Record?.Reference || []).map(r => [r.ReferenceNumber, r]));
  const txt = []; let url = null;
  const walk = s => { for (const i of s.Information || []) { const r = refs.get(i.ReferenceNumber); if (r?.SourceName === 'DrugBank') { txt.push((i.Value?.StringWithMarkup || []).map(x => x.String).join(' ')); url = r.URL || url; } } for (const k of s.Section || []) walk(k); };
  for (const s of v?.Record?.Section || []) walk(s);
  return { text: txt.map(clean).filter(Boolean), drugbank_url_from_pubchem: url };
}
let hit = 0, noEntry = 0, noText = 0;
for (const r of d.rows) {
  if (r.is_class_row) { r.drugbank = { status: 'Not a single drug: the book names a mechanism without naming a drug' }; continue; }
  const k = r.drug.toLowerCase();
  const lookup = k in ALIAS ? ALIAS[k] : r.drug;
  const e = lookup ? byName.get(String(lookup).toLowerCase()) : null;
  const rec = { looked_up_as: lookup || '(a class, not one drug)', in_star_export: !!e };
  if (e) { Object.assign(rec, { id: e.id, name: e.name, smiles: e.smiles, inchikey: e.inchikey, cas: e.cas, approved: e.approved === 't', description: e.description, drugbank_url: `https://go.drugbank.com/drugs/${e.id}` }); }
  let cid = null, key = e ? e.id : 'name:' + k;
  if (cache[key]?.text) { rec.mechanism_text = cache[key].text; rec.pubchem_cid = cache[key].pubchem_cid; rec.drugbank_url = cache[key].drugbank_url || rec.drugbank_url; }
  else {
    if (e?.inchikey) { const c = get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${e.inchikey}/cids/JSON`); cid = c?.IdentifierList?.CID?.[0] || null; sleep(250); }
    if (!cid) { const nm = encodeURIComponent(lookup || r.drug); const c = get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${nm}/cids/JSON`); cid = c?.IdentifierList?.CID?.[0] || null; sleep(250); }
    let m = { text: [], drugbank_url_from_pubchem: null };
    if (cid) { m = moaFromCid(cid); sleep(250); }
    rec.pubchem_cid = cid; rec.mechanism_text = m.text;
    if (m.drugbank_url_from_pubchem) rec.drugbank_url = m.drugbank_url_from_pubchem;
    cache[key] = { pubchem_cid: cid, text: m.text, drugbank_url: rec.drugbank_url || null, name: r.drug, retrieved_utc: new Date().toISOString() };
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  }
  if (!e && !(rec.mechanism_text || []).length) { rec.status = 'DrugBank has nothing for this name: it is not in Star\'s DrugBank export, and PubChem carries no DrugBank mechanism text for it'; noEntry++; }
  else if (!(rec.mechanism_text || []).length) { rec.status = 'In DrugBank, but DrugBank states no mechanism of action for it'; noText++; }
  else { rec.status = 'DrugBank mechanism text retrieved'; hit++; }
  r.drugbank = rec;
}
fs.writeFileSync(`${out}/rows.json`, JSON.stringify(d, null, 1));
console.log('rows', d.rows.length, '| text retrieved', hit, '| in DrugBank but no mechanism text', noText, '| nothing in DrugBank', noEntry, '| class rows', d.rows.filter(r => r.is_class_row).length);
