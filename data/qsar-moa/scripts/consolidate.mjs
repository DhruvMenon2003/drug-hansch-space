// Turn verified records into (a) included drug-mechanism records, (b) excluded records with reasons, (c) drug -> DrugBank match.
import fs from 'node:fs';
import { CANON, ALIAS, DISPLAY } from './config.mjs';
const out = process.argv[2];
const recs = JSON.parse(fs.readFileSync(`${out}/records_verified.json`, 'utf8'));
const idx = JSON.parse(fs.readFileSync(`${out}/drugbank_index.json`, 'utf8'));
const byName = new Map(idx.map(d => [d.name.toLowerCase(), d]));
const inc = [], exc = [];
for (const r of recs) {
  let reason = null;
  if (!['receptor', 'enzyme'].includes(r.target_class)) reason = `Target is not a receptor or an enzyme (${r.other_target_kind || r.target_class}); user decision 2026-11-23 "ignore these"`;
  else if (!r.naming_rule_applies) reason = 'Receptor or enzyme, but the book gives no Agonist/Antagonist/Inhibitor/Activator direction, so the naming rule cannot be applied';
  else if (!r.quote_found_in_pdf) reason = 'Quote could not be found in the book file by the automatic check';
  r.mechanism_canonical = CANON[r.mechanism_rule_name] || r.mechanism_rule_name;
  const k = (r.drug || '').toLowerCase();
  r.drug_display = r.drug ? (DISPLAY[k] || r.drug.charAt(0).toUpperCase() + r.drug.slice(1)) : '';
  if (r.drug) {
    const lookup = k in ALIAS ? ALIAS[k] : r.drug;
    const d = lookup ? byName.get(lookup.toLowerCase()) : null;
    r.drugbank = d ? { id: d.id, name: d.name, smiles: d.smiles, inchikey: d.inchikey, cas: d.cas } : null;
    r.drugbank_lookup_name = lookup;
  }
  (reason ? exc : inc).push(reason ? { ...r, excluded_reason: reason } : r);
}
fs.writeFileSync(`${out}/records_included.json`, JSON.stringify(inc, null, 1));
fs.writeFileSync(`${out}/records_excluded.json`, JSON.stringify(exc, null, 1));
console.log('included', inc.length, 'excluded', exc.length);
const mech = new Map(); for (const r of inc) { if (!mech.has(r.mechanism_canonical)) mech.set(r.mechanism_canonical, new Set()); if (r.drug) mech.get(r.mechanism_canonical).add(r.drug_display); }
console.log('mechanisms', mech.size); for (const [m, s] of [...mech].sort()) console.log('  ', m, '<-', [...s].join('; ') || '(no drug named)');
const drugs = new Map(); for (const r of inc) if (r.drug) drugs.set(r.drug_display, r);
console.log('drugs', drugs.size);
for (const [n, r] of drugs) console.log('  ', n, '=>', r.drugbank ? r.drugbank.id + ' ' + r.drugbank.name : `NO MATCH (looked up: ${r.drugbank_lookup_name})`, '|', r.drug_kind);
