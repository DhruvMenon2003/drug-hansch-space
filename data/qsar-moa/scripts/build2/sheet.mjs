// Write a new worksheet into Star's own workbook by editing the package parts. Existing sheets are not opened or rewritten.
import fs from 'node:fs';
const [out, srcDir] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(`${out}/rows.json`, 'utf8'));

// DrugBank comparison comes from the page-read file (merge.mjs); nothing is judged by keyword here.
for (const r of d.rows) { r.db_verdict = r.db_check || ''; r.db_quote = (r.db_says || '').slice(0, 900); }
const V = {}; for (const r of d.rows) { const k = r.db_verdict.split(':')[0]; V[k] = (V[k] || 0) + 1; }
console.log('DrugBank check:', V);

// ---- sheet contents
const HEAD = ['Mechanism of action (Star rule)', 'Drug', 'Target named in the book', 'Receptor or enzyme', 'Action word',
  "The book's own wording", 'Book page', 'Where on the page', 'Exact quote from the book', 'Screenshot file (folder qsar-moa/book-screenshots)',
  'Numbers given in the book?', 'DrugBank ID', 'DrugBank drug name', 'SMILES (from DrugBank)',
  'DrugBank check', "What DrugBank says", 'DrugBank page', 'Mechanism as the book states it', 'Conflict note', 'Chapter', 'Other mechanisms the book gives this drug', "Reader's notes"];
const rows = [];
let lastMech = null;
for (const r of d.rows) {
  if (r.mechanism_group !== lastMech) { rows.push({ band: `${r.mechanism_group}` }); lastMech = r.mechanism_group; }
  const db = r.drugbank || {};
  rows.push({ cells: [r.mechanism_group, r.drug, r.target, r.target_class, r.role_word, r.book_wording,
    `PDF p.${r.pdf_page_index} (printed p.${r.printed_page})`, r.location_on_page || '', r.quote, r.screenshot || '',
    r.numbers_given, db.in_star_export ? db.id : '', db.in_star_export ? db.name : '', db.in_star_export ? (db.smiles || '') : '', r.db_verdict, r.db_quote || '',
    db.in_star_export ? (db.drugbank_url || '') : '', r.book_mechanism || r.mechanism_group, r.conflict || '', 'ch' + String(r.chapters[0]).padStart(2, '0'), (r.other_mechanisms || []).join(' | '), r.notes || ''] });
}
// ---- build the worksheet XML with inline strings (sharedStrings.xml is left untouched)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr><dimension ref="A1:${col(HEAD.length - 1)}${rows.length + 3}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>`;
const widths = [34, 24, 28, 12, 11, 34, 20, 16, 60, 40, 18, 12, 22, 40, 34, 60, 30, 34, 50, 8, 30, 50];
widths.forEach((w, i) => { xml += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`; });
xml += `</cols><sheetData>`;
const cell = (r, c, v, style) => v === '' || v == null ? '' : `<c r="${col(c)}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
let rn = 1;
xml += `<row r="${rn}">` + cell(rn, 0, 'Mechanisms of action read from Pharmacology, ed. Luca Gallelli (InTech, 2012). Built ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC. One row per drug, grouped by mechanism. Only Agonist/Antagonist (receptors) and Inhibitor/Activator (enzymes) are kept, as instructed; dropped records and reasons are in qsar-moa/rows.json. Every row was checked against DrugBank: where DrugBank states the opposite direction, the mechanism follows DrugBank and the book wording is kept beside it. Therapeutic and toxic levels are not here because the book gives none.') + `</row>`; rn++;
xml += `<row r="${rn}">` + HEAD.map((h, i) => cell(rn, i, h)).join('') + `</row>`; rn++;
for (const r of rows) {
  if (r.band) { xml += `<row r="${rn}">` + cell(rn, 0, r.band) + `</row>`; rn++; continue; }
  xml += `<row r="${rn}">` + r.cells.map((v, i) => cell(rn, i, v)).join('') + `</row>`; rn++;
}
xml += `</sheetData><autoFilter ref="A2:${col(HEAD.length - 1)}${rn - 1}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;

// ---- register the part
const sheetFile = 'sheet5.xml';
fs.writeFileSync(`${srcDir}/xl/worksheets/${sheetFile}`, xml);
const ctP = `${srcDir}/[Content_Types].xml`; let ct = fs.readFileSync(ctP, 'utf8');
if (!ct.includes(`/xl/worksheets/${sheetFile}`)) ct = ct.replace('</Types>', `<Override PartName="/xl/worksheets/${sheetFile}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
fs.writeFileSync(ctP, ct);
const relP = `${srcDir}/xl/_rels/workbook.xml.rels`; let rel = fs.readFileSync(relP, 'utf8');
const RID = 'rId100';
if (!rel.includes(RID)) rel = rel.replace('</Relationships>', `<Relationship Id="${RID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetFile}"/></Relationships>`);
fs.writeFileSync(relP, rel);
const wbP = `${srcDir}/xl/workbook.xml`; let wb = fs.readFileSync(wbP, 'utf8');
const NAME = 'Mechanism of Action';
if (!wb.includes(`name="${NAME}"`)) wb = wb.replace('</sheets>', `<sheet name="${NAME}" sheetId="101" r:id="${RID}"/></sheets>`);
fs.writeFileSync(wbP, wb);
console.log('sheet rows written:', rn - 1, '| data rows:', rows.filter(r => r.cells).length, '| mechanism bands:', rows.filter(r => r.band).length);
