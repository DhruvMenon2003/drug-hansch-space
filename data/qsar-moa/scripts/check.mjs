import ExcelJS from 'exceljs';
import fs from 'node:fs';
const out = process.argv[2];
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(`${out}/Drug-Leaderboard-v5-mechanism-of-action.xlsx`);
for (const ws of wb.worksheets) console.log(ws.name, ws.rowCount, 'x', ws.columnCount);
const ws = wb.getWorksheet('Mechanism Drugs');
let missing = 0, linked = 0, rows = 0;
ws.eachRow((r, n) => { if (n === 1) return; const a = r.getCell(1).value; const f = r.getCell(6).value; if (!f || String(r.getCell(1).value).includes('—')) return; rows++; const sh = r.getCell(23).value; const h = sh && typeof sh === 'object' ? sh.hyperlink : null; if (h) { linked++; if (!fs.existsSync(`${out}/${h}`)) missing++; } });
console.log('data rows', rows, 'rows with screenshot link', linked, 'links to missing files', missing);
for (const n of [3, 4, 5]) { const r = ws.getRow(n); console.log(n, [1, 6, 7, 9, 21, 26].map(c => { const v = r.getCell(c).value; return typeof v === 'object' && v ? v.text : v; }).join(' | ')); }
