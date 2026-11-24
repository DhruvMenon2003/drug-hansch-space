// Fetch DrugBank's "Mechanism of action" text (as mirrored by PubChem, credited to DrugBank) for each matched drug,
// then show the sentences that mention each book target so a verdict can be set by reading them.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const out = process.argv[2];
const inc = JSON.parse(fs.readFileSync(`${out}/records_included.json`, 'utf8'));
const cacheFile = `${out}/drugbank_moa_text.json`;
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const get = url => { try { return JSON.parse(execFileSync('curl', ['-sS', '-m', '60', url], { encoding: 'utf8', maxBuffer: 1 << 26 })); } catch (e) { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const drugs = new Map(); for (const r of inc) if (r.drugbank) drugs.set(r.drugbank.id, r.drugbank);
for (const d of drugs.values()) {
  if (cache[d.id]) continue;
  const c = get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${d.inchikey}/cids/JSON`);
  const cid = c?.IdentifierList?.CID?.[0];
  const e = { drugbank_id: d.id, name: d.name, pubchem_cid: cid || null, drugbank_url: `https://go.drugbank.com/drugs/${d.id}`, text: [], retrieved_utc: new Date().toISOString() };
  if (cid) {
    await sleep(300);
    const v = get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Mechanism+of+Action`);
    const refs = new Map((v?.Record?.Reference || []).map(r => [r.ReferenceNumber, r]));
    const walk = s => { for (const i of s.Information || []) { const ref = refs.get(i.ReferenceNumber); if (ref?.SourceName === 'DrugBank') { e.text.push((i.Value?.StringWithMarkup || []).map(x => x.String).join('\n')); e.source_id = ref.SourceID; e.source_url = ref.URL; } } for (const k of s.Section || []) walk(k); };
    for (const s of v?.Record?.Section || []) walk(s);
    e.pubchem_url = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=Mechanism-of-Action`;
  }
  cache[d.id] = e; await sleep(300);
}
fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
const TARGET = {
  'AMP-Activated Protein Kinase Activator': /AMPK|AMP-activated/i, 'AMPA Glutamate Receptor Antagonist': /AMPA/i, 'Acetylcholinesterase Inhibitor': /cholinesterase/i,
  'Aldehyde Dehydrogenase Inhibitor': /aldehyde dehydrogenase/i, 'Cannabinoid 1 Receptor Antagonist': /CB1|cannabinoid/i, 'Cytochrome P450 2E1 Activator': /2E1/i,
  'Dopamine Autoreceptor Agonist': /dopamine|D2|autoreceptor/i, 'Dopamine Beta-Hydroxylase Inhibitor': /hydroxylase/i, 'Dopamine D2 Receptor Antagonist': /D2|dopamine/i,
  'Dopamine Receptor Agonist': /dopamine|D2/i, 'Dopamine Receptor Antagonist': /dopamine|D2/i, 'Estrogen Receptor Agonist': /estrogen receptor|ER[αβ ]|\bER\b/i,
  'GABA A Receptor Antagonist': /GABA/i, 'GABA B Receptor Antagonist': /GABA/i, 'Glutamate Receptor Antagonist': /glutamate|NMDA|kainate/i, 'Kainate Glutamate Receptor Antagonist': /kainate/i,
  'Melatonin Receptor Agonist': /MT1|MT2|melatonin receptor/i, 'Mu Opioid Receptor Antagonist': /opioid|mu\b|μ/i, 'NMDA Receptor Agonist': /NMDA/i, 'NMDA Receptor Antagonist': /NMDA|N-methyl/i,
  'Peroxisome Proliferator Activated Receptor Alpha Agonist': /PPAR|peroxisome/i, 'Peroxisome Proliferator Activated Receptor Gamma Agonist': /PPAR.?(γ|gamma)|peroxisome/i,
  'Progesterone Receptor Agonist': /progesterone receptor|\bPR\b/i, 'Ribosomal Protein S6 Kinase 1 Inhibitor': /S6K|S6 kinase/i, 'Serotonin 5-HT2 Receptor Antagonist': /5-?HT2|serotonin/i,
  'Serotonin 5-HT2C Receptor Antagonist': /5-?HT2C/i, 'Serotonin 5-HT3 Receptor Antagonist': /5-?HT3/i, 'Serotonin Receptor Antagonist': /5-?HT|serotonin/i, 'Sigma 1 Receptor Agonist': /sigma|σ/i,
  'Sirtuin 1 Activator': /sirt/i, 'Vitamin D Receptor Agonist': /vitamin D receptor|VDR/i, 'mTORC1 Inhibitor': /mTOR|target of rapamycin/i,
};
const seen = new Set();
for (const r of inc) {
  if (!r.drugbank) continue; const key = r.drugbank.id + '|' + r.mechanism_canonical; if (seen.has(key)) continue; seen.add(key);
  const e = cache[r.drugbank.id]; const txt = e.text.join(' ');
  const sents = txt.split(/(?<=[.!?])\s+/).filter(s => TARGET[r.mechanism_canonical]?.test(s));
  console.log(`\n## ${r.drug_display} [${r.drugbank.id}] :: ${r.mechanism_canonical}  (DrugBank text ${txt.length} chars, cid ${e.pubchem_cid})`);
  if (!txt.length) console.log('   NO DRUGBANK MECHANISM TEXT AVAILABLE');
  else if (!sents.length) console.log('   target not mentioned');
  for (const s of sents.slice(0, 2)) console.log('   >', s.slice(0, 260));
}
