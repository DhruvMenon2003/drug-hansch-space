// Build the new workbook from the verified extraction records. Every cell value comes from a file in qsar-moa/; nothing is typed in from memory
// except the DrugBank verdicts in VERDICT, which were set by Claude after reading the DrugBank sentences shown in step 13 of the step log.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
const out = process.argv[2];
const J = f => JSON.parse(fs.readFileSync(`${out}/${f}`, 'utf8'));
const inc = J('records_included.json'), exc = J('records_excluded.json'), moa = J('drugbank_moa_text.json'), oa = J('openalex_papers.json'), chapters = J('extraction/chapters.json');

// ---- DrugBank verdicts: key = "<DrugBank ID>|<mechanism>" -> [verdict, note]
const C = 'Confirmed', CI = 'Target confirmed; direction implied, word not used', ND = 'Not stated in DrugBank text', DIS = 'DrugBank disagrees', TD = 'Target confirmed; direction not stated';
const VERDICT = {
  'DB06155|Cannabinoid 1 Receptor Antagonist': [C, 'DrugBank: "specific CB1 cannabinoid receptor antagonist".'],
  'DB13873|Peroxisome Proliferator Activated Receptor Alpha Agonist': [C, 'DrugBank: activates PPAR-alpha.'],
  'DB13873|Peroxisome Proliferator Activated Receptor Gamma Agonist': [ND, 'DrugBank names only PPAR-alpha for fenofibric acid; the book says it activates PPARα and PPARγ.'],
  'DB01393|Peroxisome Proliferator Activated Receptor Alpha Agonist': [C, 'DrugBank: "likely an agonist of PPAR-alpha"; also mentions PPAR-gamma and PPAR-delta effects.'],
  'DB00636|Peroxisome Proliferator Activated Receptor Alpha Agonist': [C, 'DrugBank: agonist of the PPAR-α receptor.'],
  'DB00822|Aldehyde Dehydrogenase Inhibitor': [C, 'DrugBank: irreversible inactivation of aldehyde dehydrogenase.'],
  'DB00822|Dopamine Beta-Hydroxylase Inhibitor': [ND, 'DrugBank text does not mention dopamine beta-hydroxylase.'],
  'DB00704|Mu Opioid Receptor Antagonist': [C, 'DrugBank: competitive antagonist at mu, kappa and delta receptors, highest affinity for mu.'],
  'DB00659|NMDA Receptor Antagonist': [DIS, 'DrugBank text does not mention NMDA; it says acamprosate directly binds and inhibits GABA B receptors and indirectly affects GABA A receptors. The book says NMDA antagonism.'],
  'DB00904|Serotonin 5-HT3 Receptor Antagonist': [C, 'DrugBank: selective antagonist of 5-HT3.'],
  'DB00181|GABA B Receptor Antagonist': [DIS, 'DrugBank: baclofen is an AGONIST at GABA B receptors. The book (ch. 12, PDF p. 255) calls it an antagonist. Check the book page before using this row.'],
  'DB00273|AMPA Glutamate Receptor Antagonist': [C, 'DrugBank: reduces glutamate activity at AMPA and kainate receptors.'],
  'DB00273|Kainate Glutamate Receptor Antagonist': [C, 'DrugBank: reduces glutamate activity at AMPA and kainate receptors.'],
  'DB00273|GABA A Receptor Antagonist': [DIS, 'DrugBank: topiramate STIMULATES GABA-A receptor activity. The book says inhibition of GABA A receptors.'],
  'DB00898|NMDA Receptor Antagonist': [C, 'DrugBank: "inhibits NMDA receptor functioning".'],
  'DB00145|NMDA Receptor Agonist': [CI, 'DrugBank: glycine binds the NMDA receptor complex and potentiates NMDA transmission (co-agonist role).'],
  'DB00898|Cytochrome P450 2E1 Activator': [ND, 'DrugBank text does not mention CYP2E1.'],
  'DB02709|Sirtuin 1 Activator': [ND, 'DrugBank mechanism text for resveratrol is short and does not mention sirtuins.'],
  'DB02709|AMP-Activated Protein Kinase Activator': [ND, 'DrugBank mechanism text for resveratrol does not mention AMPK.'],
  'DB00131|AMP-Activated Protein Kinase Activator': [ND, 'DrugBank text for adenosine phosphate does not mention AMPK.'],
  'DB01065|Melatonin Receptor Agonist': [CI, 'DrugBank: binds melatonin receptors 1 and 2 and signals through them.'],
  'DB00980|Melatonin Receptor Agonist': [C, 'DrugBank: melatonin receptor agonist, high affinity for MT1 and MT2.'],
  'DB06594|Melatonin Receptor Agonist': [C, 'DrugBank: agonist at melatonin receptors MT1 and MT2.'],
  'DB06594|Serotonin 5-HT2C Receptor Antagonist': [C, 'DrugBank: antagonist at serotonin 5-HT2C receptors.'],
  'DB00136|Vitamin D Receptor Agonist': [CI, 'DrugBank: calcitriol binds the vitamin D receptor, which then regulates gene transcription.'],
  'DB00877|mTORC1 Inhibitor': [C, 'DrugBank: FKBP12-sirolimus complex inhibits mTOR (DrugBank says mTOR, not specifically mTORC1).'],
  'DB00331|AMP-Activated Protein Kinase Activator': [C, 'DrugBank: metformin activates AMPK.'],
  'DB00331|mTORC1 Inhibitor': [ND, 'DrugBank text does not mention mTOR.'],
  'DB00331|Ribosomal Protein S6 Kinase 1 Inhibitor': [ND, 'DrugBank text does not mention S6K1.'],
  'DB00734|Dopamine D2 Receptor Antagonist': [C, 'DrugBank: inhibits D2 dopaminergic receptors.'],
  'DB00734|Serotonin 5-HT2 Receptor Antagonist': [C, 'DrugBank: inhibits 5-HT2A serotonergic receptors.'],
  'DB01238|Dopamine Autoreceptor Agonist': [CI, 'DrugBank: partial agonist activity on D2 receptors; "autoreceptor" is not used.'],
  'DB01238|Dopamine D2 Receptor Antagonist': [CI, 'DrugBank: aripiprazole both stimulates and inhibits dopamine as it engages the D2 receptor (partial agonist).'],
  'DB01238|Dopamine Receptor Agonist': [C, 'DrugBank: partial agonist activity on D2 receptors.'],
  'DB00246|Dopamine Receptor Antagonist': [TD, 'DrugBank: binds serotonin-2A and dopamine D2 receptors like other atypical antipsychotics; the word antagonist is not used for ziprasidone in the text read.'],
  'DB00246|Serotonin Receptor Antagonist': [TD, 'DrugBank: binds 5-HT2A and other serotonin receptors; direction word not used in the text read.'],
  'DB00334|Dopamine Receptor Antagonist': [C, 'DrugBank: antagonism of dopamine receptors D1 to D4.'],
  'DB00334|Serotonin Receptor Antagonist': [C, 'DrugBank: antagonism of serotonin receptors 5HT2A, 5HT2C, 5HT3 and 5HT6.'],
  'DB00176|Sigma 1 Receptor Agonist': [TD, 'DrugBank: fluvoxamine has affinity for binding to sigma-1 receptors; agonism is not stated.'],
  'DB00740|Glutamate Receptor Antagonist': [DIS, 'DrugBank describes inhibited glutamate release, inactivated sodium channels and interference with events after transmitter binding; it does not call riluzole a glutamate receptor antagonist.'],
  'DB00843|Acetylcholinesterase Inhibitor': [C, 'DrugBank: selectively and reversibly inhibits acetylcholinesterase.'],
  'DB01043|NMDA Receptor Antagonist': [C, 'DrugBank: uncompetitive (open-channel) NMDA receptor antagonist.'],
  'DB00514|NMDA Receptor Antagonist': [C, 'DrugBank (dextromethorphan): low-affinity uncompetitive NMDA antagonist.'],
  'DB00514|Sigma 1 Receptor Agonist': [C, 'DrugBank (dextromethorphan): sigma-1 receptor agonist.'],
  'DB00783|Estrogen Receptor Agonist': [CI, 'DrugBank: acts at the estrogen receptor; estradiol is more potent than estrone and estriol there.'],
  'DB00655|Estrogen Receptor Agonist': [CI, 'DrugBank: estrogens interact with estrogen receptors in responsive tissues.'],
  'DB04573|Estrogen Receptor Agonist': [CI, 'DrugBank: ligand-bound estrogen receptor regulates gene transcription.'],
  'DB00396|Progesterone Receptor Agonist': [CI, 'DrugBank: progesterone binds the progesterone receptor, which modulates gene expression.'],
};
const NOENTRY = ['No DrugBank entry in the project export', 'This name is not in /mnt/project-files/drugbank_drugs_info.csv (it only lists drugs that appear in clinical trials). The DrugBank website could not be read automatically (bot block), so absence from DrugBank itself is not established.'];
const CLASSROW = ['Not a single drug', 'The book names a drug class or a mechanism without a drug.'];

// ---- group + order
const mechOrder = [...new Set(inc.map(r => r.mechanism_canonical))].sort((a, b) => a.localeCompare(b));
const rowsBy = new Map(); // key mech|drug
for (const r of inc) { const k = `${r.mechanism_canonical}|${r.drug_display}`; if (!rowsBy.has(k)) rowsBy.set(k, []); rowsBy.get(k).push(r); }
const nameCount = {}; for (const k of rowsBy.keys()) { const d = k.split('|')[1]; if (d) nameCount[d] = (nameCount[d] || 0) + 1; }

const wb = new ExcelJS.Workbook(); wb.creator = 'Claude (for Star)'; wb.created = new Date();
const ws7 = wb.addWorksheet('Read Me', { views: [{ showGridLines: false }] });
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }, alignment: { wrapText: true, vertical: 'middle' } };
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F7D0' } }, AMBER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9B3' } }, RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8C9C9' } }, GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } }, BAND = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
function sheet(name, cols, freeze = 1) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: freeze, xSplit: 0 }] });
  ws.columns = cols.map(([h, w]) => ({ header: h, width: w })); ws.getRow(1).eachCell(c => Object.assign(c, HEAD)); ws.getRow(1).height = 45;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; return ws;
}
const pgs = r => `PDF p. ${r.verified_pdf_page} (printed p. ${r.printed_page})`;
const kindFix = k => (k === 'not stated' ? '' : k);

// ================= Sheet 1: Mechanism Drugs =================
const s1cols = [['Mechanism group (Star rule: Target + Agonist/Antagonist/Inhibitor/Activator)', 38], ['Book\'s exact wording', 34], ['Target class', 10], ['Rank', 6], ['Percentile', 9], ['Drug Name', 26], ['DrugBank ID', 12], ['Drug SMILES', 40], ['Drug Target', 30], ['UniProt ID', 11], ['Minimum Therapeutic Level (mg)', 14], ['Minimum Toxic Level (mg)', 14], ['Log Therapeutic Index', 11], ['Steady State Volume of Distribution (L/kg)', 14], ['Clearance (mL/min/kg)', 12], ['Dosage (ug)', 10], ['Dose Interval (min)', 10], ['Fraction absorbed', 10], ['Fraction unbound', 10], ['In Vivo Free Drug Concentration (ug/L)', 14], ['Book location', 22], ['Exact quote from the book', 70], ['Screenshot file (in the screenshots folder)', 44], ['Numbers given in the book?', 22], ['Drug kind (book)', 14], ['DrugBank check', 26], ['DrugBank check detail', 60], ['DrugBank mechanism page', 30], ['Also listed under other mechanism groups?', 16], ['Notes from the reader (kept from extraction)', 60]];
const ws1 = sheet('Mechanism Drugs', s1cols, 1);
let rowNo = 0;
for (const m of mechOrder) {
  const keys = [...rowsBy.keys()].filter(k => k.startsWith(m + '|')).sort((a, b) => (a.split('|')[1] || '~').localeCompare(b.split('|')[1] || '~'));
  const band = ws1.addRow([`${m}  —  ${keys.length} row${keys.length > 1 ? 's' : ''}`]); band.eachCell(c => { c.fill = BAND; c.font = { bold: true }; }); ws1.mergeCells(band.number, 1, band.number, s1cols.length);
  for (const k of keys) {
    const rs = rowsBy.get(k), r = rs[0], d = r.drugbank;
    const [v, note] = !r.drug ? CLASSROW : !d ? NOENTRY : (VERDICT[`${d.id}|${m}`] || ['NOT CHECKED', 'No verdict was set for this pair.']);
    const quotes = rs.map(x => `[${pgs(x)}${x.location_on_page ? ', ' + x.location_on_page : ''}] ${x.quote}`).join('\n');
    const shots = [...new Set(rs.map(x => x.screenshot).filter(Boolean))];
    const nums = [...new Set(rs.map(x => (x.numbers_given === 'none' ? null : x.numbers_given)).filter(Boolean))].join('; ') || 'none';
    const row = ws1.addRow([m, [...new Set(rs.map(x => x.mechanism_book_wording))].join(' | '), r.target_class, null, null, r.drug_display || '(no drug named — class or mechanism only)', d?.id || '', d?.smiles || '', d?.name && d.name !== r.drug_display ? `${r.target} (DrugBank drug: ${d.name})` : r.target, '', '', '', '', '', '', '', '', '', '', '', rs.map(x => pgs(x)).join('; '), quotes, shots.join('\n'), nums, kindFix(r.drug_kind), v, note, d ? { text: moa[d.id].drugbank_url, hyperlink: moa[d.id].drugbank_url } : '', r.drug && nameCount[r.drug_display] > 1 ? `Yes (${nameCount[r.drug_display]} groups in total)` : (r.drug ? 'No' : ''), rs.map(x => x.notes).filter(Boolean).join('\n')]);
    row.alignment = { wrapText: true, vertical: 'top' };
    const sc = row.getCell(23); if (shots[0]) sc.value = { text: shots.join('\n'), hyperlink: shots[0] };
    row.getCell(26).fill = v === C ? GREEN : v === DIS ? RED : (v === CI || v === TD) ? AMBER : GREY;
    for (let c = 11; c <= 20; c++) row.getCell(c).fill = GREY; rowNo++;
  }
}
ws1.getCell('A' + (ws1.rowCount + 2)).value = 'Grey cells (Rank to In Vivo Free Drug Concentration) stay empty on purpose: the book gives no therapeutic or toxic levels and no pharmacokinetic parameters for these drugs. They will be filled from the papers you upload. Units: levels in mg (dose), as you chose; the other units follow the template notes.';

// ================= Sheet 2: Mechanisms list (3A) =================
const allRecs = [...inc, ...exc.map(r => ({ ...r, mechanism_canonical: r.mechanism_canonical || r.mechanism_rule_name }))];
const mm = new Map();
for (const r of allRecs) { const k = r.mechanism_canonical; if (!mm.has(k)) mm.set(k, { recs: [], drugs: new Set(), pages: new Set(), chapters: new Set(), words: new Set(), nums: new Set(), included: false, why: new Set(), cls: r.target_class }); const o = mm.get(k); o.recs.push(r); if (r.drug_display || r.drug) o.drugs.add(r.drug_display || r.drug); o.pages.add(r.verified_pdf_page || r.pdf_page_index); o.chapters.add(r.chapter); o.words.add(r.mechanism_book_wording); if (r.numbers_given && r.numbers_given !== 'none') o.nums.add(r.numbers_given); if (!r.excluded_reason) o.included = true; else o.why.add(r.excluded_reason); }
const ws2 = sheet('All Mechanisms in Book', [['Mechanism (Star rule where it applies)', 46], ['Book\'s exact wording(s)', 50], ['Target class', 12], ['Chapter(s)', 10], ['PDF page(s)', 18], ['Drugs named', 40], ['Numbers given in the book?', 12], ['What numbers', 40], ['In the "Mechanism Drugs" sheet?', 14], ['Why not (if not)', 60]]);
for (const [k, o] of [...mm].sort((a, b) => a[0].localeCompare(b[0]))) { const row = ws2.addRow([k, [...o.words].join(' | '), o.cls, [...o.chapters].join(', '), [...o.pages].sort((a, b) => a - b).join(', '), [...o.drugs].join('; ') || '(none)', o.nums.size ? 'yes' : 'no', [...o.nums].join('; '), o.included ? 'yes' : 'no', o.included ? '' : [...o.why].join(' / ')]); row.alignment = { wrapText: true, vertical: 'top' }; if (!o.included) row.eachCell(c => { c.fill = GREY; }); }

// ================= Sheet 3: Excluded records =================
const ws3 = sheet('Left Out Records', [['Chapter', 8], ['Drug', 24], ['Mechanism (as read)', 40], ['Target class', 12], ['Kind of target', 22], ['Book\'s wording', 40], ['Quote', 70], ['PDF page', 8], ['Why left out', 70]]);
for (const r of exc) ws3.addRow([r.chapter, r.drug_display || r.drug, r.mechanism_rule_name, r.target_class, r.other_target_kind, r.mechanism_book_wording, r.quote, r.verified_pdf_page || r.pdf_page_index, r.excluded_reason]).alignment = { wrapText: true, vertical: 'top' };

// ================= Sheet 4: Chapters =================
const ws4 = sheet('Chapters Read', [['Chapter', 8], ['Title', 80], ['PDF pages', 12], ['Status', 30], ['Records found', 10], ['Records kept in the sheet', 12]]);
for (const c of chapters.chapters) { const kept = inc.filter(r => r.chapter === c.n).length; const row = ws4.addRow([c.n, c.title, `${c.pdf_first}-${c.pdf_last}`, c.status, c.records ?? '', c.status === 'read' ? kept : '']); if (c.status !== 'read') row.getCell(4).fill = c.status.includes('safety') ? RED : AMBER; row.getCell(2).alignment = { wrapText: true }; }

// ================= Sheet 5: Papers =================
const ws5 = sheet('Papers (OpenAlex)', [['Mechanism', 40], ['Search', 16], ['Rank', 6], ['Search text used', 56], ['Match type', 22], ['Title', 80], ['Year', 7], ['First author', 22], ['Authors (count)', 9], ['Journal / source', 34], ['Type', 12], ['Cited by', 8], ['DOI', 36], ['Open access?', 9], ['Open-access link', 40], ['OpenAlex ID', 30], ['Local file path (fill in after upload)', 40]]);
for (const p of oa.rows) { const row = ws5.addRow([p.mechanism, `${p.mechanism} ${p.keyword}`.length ? p.keyword : '', p.rank, p.query_used, p.match_kind, p.title, p.year, p.first_author, p.n_authors, p.journal, p.type, p.cited_by, p.doi, p.open_access, p.oa_url, p.openalex_id, '']); if (p.match_kind !== 'exact phrase') row.getCell(5).fill = AMBER; if (p.doi) row.getCell(13).value = { text: p.doi, hyperlink: p.doi }; row.getCell(6).alignment = { wrapText: true, vertical: 'top' }; }
const ws5b = sheet('Search Summary', [['Mechanism', 46], ['Search', 16], ['Exact-phrase query', 60], ['Works matching the exact phrase', 14], ['Works matching without quotes (only run if exact < 10)', 18], ['Papers listed', 8]]);
for (const s of oa.summary) ws5b.addRow([s.mechanism, s.keyword, s.exact_query, s.exact_total, s.fallback_total ?? '', s.listed]);

// ================= Sheet 6: Data Provenance (template style) =================
const ws6 = sheet('Data Provenance', [['Row', 8], ['Column', 34], ['Drug', 26], ['Original value', 18], ['New value', 40], ['Source', 46], ['Source detail / quote', 90], ['Rule', 60], ['Flags', 50]]);
for (const m of mechOrder) for (const k of [...rowsBy.keys()].filter(k => k.startsWith(m + '|'))) {
  const rs = rowsBy.get(k), r = rs[0], d = r.drugbank; const ck = `${m}|${r.drug_display}`;
  const src = `Pharmacology, ed. L. Gallelli (InTech, 2012), chapter ${r.chapter}, ${rs.map(pgs).join('; ')}`;
  const add = (col, nv, source, detail, rule, flags = '') => ws6.addRow(['', col, r.drug_display || '(class)', '', nv, source, detail, rule, flags]).alignment = { wrapText: true, vertical: 'top' };
  add('Mechanism group', m, src, rs.map(x => x.quote).join(' || '), `Star rule: ${r.target_class === 'receptor' ? 'receptor → Agonist/Antagonist' : 'enzyme → Inhibitor/Activator'}; book's wording kept in its own column`, rs.some(x => /inferred|inference/i.test(x.notes || '')) ? 'Reader notes say the role or target is inferred; see Notes column in Mechanism Drugs' : '');
  if (d) { add('DrugBank ID', d.id, 'project DrugBank export (drugbank_drugs_info.csv), matched by drug name', `Book name "${r.drug}" → DrugBank name "${d.name}"`, 'name match; spelling alias set by Claude where the book spells differently', ''); add('Drug SMILES', d.smiles, 'project DrugBank export (moldb_smiles)', '', 'copied from export; not re-canonicalised with RDKit', 'Template note says SMILES are RDKit canonical: not yet applied'); const e = moa[d.id]; const [v, note] = VERDICT[`${d.id}|${m}`] || ['NOT CHECKED', '']; add('DrugBank mechanism check', v, `DrugBank page ${e.drugbank_url} via PubChem copy ${e.pubchem_url}`, (e.text.join(' ') || '').replace(/<[^>]+>/g, '').slice(0, 900), note, 'DrugBank site itself blocks automated reading; text taken from PubChem\'s credited copy'); }
}

// ================= Sheet 7: Notes =================
ws7.getColumn(1).width = 150;
[
  'What this workbook is', 'New sheet in the style of Drug-Leaderboard-v3-live-summary-fixed.xlsx, built from the Gallelli book (Pharmacology, InTech 2012). Created ' + new Date().toISOString().slice(0, 10) + ' (UTC).',
  '', 'How rows work', '• "Mechanism Drugs": one row per drug within each mechanism group. A drug that the book places under several mechanisms (for example topiramate) appears once in each group; the column "Also listed under other mechanism groups?" says so. Ask if you would rather have exactly one row per drug.',
  '• Mechanism names follow your rule: receptor → Agonist or Antagonist, enzyme → Inhibitor or Activator. The book\'s own words are in column B. Targets that are neither receptor nor enzyme (ion channels, transporters, DNA, pathways) and receptor/enzyme mentions with no stated direction (for example "selective oestrogen receptor modulator") are NOT in the first sheet; they are in "Left Out Records" with the reason.',
  '• Where the book says only "blocker", "blocks" or "activation of", the rule name uses the nearest allowed word and the reader notes say so. Where the reader inferred the receptor or enzyme class, the notes say so.',
  '• Minimum Therapeutic Level and Minimum Toxic Level are doses in mg (your choice). The book gives none of these, nor pharmacokinetic parameters, so the grey template columns are empty. They are not guessed.',
  '', 'Checks done', '• Every quote was searched for in the book PDF by program: 100 of 101 found exactly on the page the reader gave (the one that was not found is CP55940, p. 113, and it is in "Left Out Records" because the book gives no direction).',
  '• Screenshots are PNG files in the screenshots folder, one per quoted passage, cropped to the lines around the quote at 200 dpi. Each file name starts with the chapter and PDF page. Open a few to check the crop is what you want.',
  '• DrugBank check: the DrugBank website refused automated reading (bot block), so the "Mechanism of action" text was taken from PubChem\'s copy, which PubChem credits to DrugBank, and each row links to the DrugBank page. Verdicts were set by Claude reading that text; they are not machine-made. 4 rows disagree with DrugBank (red: acamprosate on NMDA, baclofen on GABA B, topiramate on GABA A, riluzole on glutamate receptors): see the DrugBank check column.',
  '', 'What is not finished', '• 9 chapters were stopped by the safety filter (1, 2, 3, 4, 7, 8, 9, 17, 18) and 13 are waiting for the usage limit to reset (5 had an early partial read; 11 and 21 to 31). Their mechanisms are not here yet; see "Chapters Read".',
  '• UniProt IDs are empty (not looked up yet). Papers have not been downloaded: "Papers (OpenAlex)" is the list you asked for, top 10 per search. Fill the last column with the file path after you upload them.',
  '• OpenAlex searches use the plural of the mechanism name inside quotation marks, e.g. "Acetylcholinesterase Inhibitors" QSAR. Where fewer than 10 works matched exactly, the list was topped up with the same words without quotation marks (amber cells).',
].forEach((t, i) => { const c = ws7.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: 'top' }; if (['What this workbook is', 'How rows work', 'Checks done', 'What is not finished'].includes(t)) c.font = { bold: true, size: 13 }; });
await wb.xlsx.writeFile(`${out}/Drug-Leaderboard-v5-mechanism-of-action.xlsx`);
const cnt = {}; for (const k of rowsBy.keys()) { const r = rowsBy.get(k)[0], d = r.drugbank; const [v] = !r.drug ? CLASSROW : !d ? NOENTRY : (VERDICT[`${d.id}|${r.mechanism_canonical}`] || ['NOT CHECKED']); cnt[v] = (cnt[v] || 0) + 1; }
console.log('mechanism groups', mechOrder.length, 'drug rows', rowsBy.size, 'verdicts', cnt, 'unique drugs', Object.keys(nameCount).length, 'excluded', exc.length);
