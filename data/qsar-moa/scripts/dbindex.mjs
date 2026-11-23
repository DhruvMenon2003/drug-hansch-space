// Build a de-duplicated DrugBank lookup (one row per drugbank_id) from the user's CSV export.
import fs from 'node:fs';
const [src, out] = process.argv.slice(2);
const rs = fs.createReadStream(src, { encoding: 'utf8', highWaterMark: 1 << 22 });
let field = '', row = [], inQ = false, prevQ = false, header = null, n = 0;
const seen = new Map();
function endRow() {
  row.push(field); field = '';
  if (!header) header = row;
  else if (row.length === header.length) {
    n++;
    const id = row[10];
    if (id && !seen.has(id)) seen.set(id, { id, name: row[11], type: row[9], state: row[12], description: row[13], cas: row[14], approved: row[18], investigational: row[17], withdrawn: row[23], inchikey: row[26], smiles: row[27], formula: row[29] });
  }
  row = [];
}
for await (const chunk of rs) {
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (inQ) {
      if (c === '"') { if (chunk[i + 1] === '"') { field += '"'; i++; } else if (i + 1 === chunk.length) { prevQ = true; inQ = false; } else inQ = false; }
      else field += c;
    } else if (prevQ && c === '"') { field += '"'; inQ = true; prevQ = false; }
    else { prevQ = false; if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') endRow(); else if (c !== '\r') field += c; }
  }
}
if (field || row.length) endRow();
console.log('header', header.join('|'));
console.log('rows', n, 'distinct drugbank ids', seen.size);
fs.writeFileSync(out, JSON.stringify([...seen.values()]));
console.log('sample', JSON.stringify([...seen.values()].slice(0, 2)).slice(0, 700));
