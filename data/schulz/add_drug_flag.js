// Add a drug_or_not column to the Schulz structure file.
//
// The test is whether the name is in the project's DrugBank dump. That dump
// carries a SMILES for only 3,542 distinct names, so ABSENCE IS WEAK EVIDENCE:
// alprenolol, amobarbital and astemizole are real drugs that are simply not in
// it. The column is therefore named for what it measures and the script that
// reads it says so. Presence is strong; absence is a prompt to look.
const fs = require('fs');

const S = '/mnt/project-files/qsar-moa/schulz/schulz-structures.csv';
const LK = '/mnt/project-files/qsar-moa/schulz/schulz-name-to-smiles.csv';
const Q = String.fromCharCode(34);

function parseCSV(text) {
  const rows = []; let f = '', r = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === Q) { if (text[i + 1] === Q) { f += Q; i++; } else q = false; } else f += c; }
    else if (c === Q) q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); f = ''; rows.push(r); r = []; }
    else if (c !== '\r') f += c;
  }
  if (f.length || r.length) { r.push(f); rows.push(r); }
  return rows;
}
const q = s => Q + String(s == null ? '' : s).replace(new RegExp(Q, 'g'), Q + Q) + Q;

// names that the DrugBank pass resolved
const lk = parseCSV(fs.readFileSync(LK, 'utf8'));
const lkH = {}; lk[0].forEach((h, i) => lkH[h.trim()] = i);
const inDrugBank = new Set(lk.slice(1)
  .filter(r => (r[lkH.substance] || '').trim())
  .map(r => r[lkH.substance].trim()));
console.log('names resolved from the DrugBank dump:', inDrugBank.size);

const rows = parseCSV(fs.readFileSync(S, 'utf8'));
const H = {}; rows[0].forEach((h, i) => H[h.trim()] = i);
const body = rows.slice(1).filter(r => (r[H.substance] || '').trim());

if (rows[0].map(h => h.trim()).includes('drug_or_not')) {
  console.log('drug_or_not already present; nothing to do');
  process.exit(0);
}

// the eight non-drug chemicals the review named, for a cross-check
const NAMED_SOLVENTS = ['methanol', 'acetone', 'chloroform', 'butanone',
  'carbon tetrachloride', 'propylene glycol', 'trichloroethanol', 'aniline'];

const out = [rows[0].map(h => h.trim()).concat('drug_or_not').map(q).join(',')];
let yes = 0, no = 0, solventRows = [];
for (const r of body) {
  const name = r[H.substance].trim();
  const isDrug = inDrugBank.has(name);
  if (isDrug) yes++; else no++;
  if (NAMED_SOLVENTS.includes(name.toLowerCase()))
    solventRows.push(`${name}: drug_or_not=${isDrug ? 'yes' : 'no'}, ` +
      `index=${r[H.log_therapeutic_index] || '-'}, carbon=${r[H.has_carbon]}`);
  out.push(rows[0].map((h, i) => q(r[i] === undefined ? '' : r[i]))
    .concat(q(isDrug ? 'yes' : 'no')).join(','));
}
fs.writeFileSync(S, out.join('\n') + '\n');
console.log('rows:', body.length, '| drug_or_not yes:', yes, '| no:', no);
console.log('\nthe eight chemicals the review named:');
solventRows.forEach(s => console.log('  ' + s));
const missing = NAMED_SOLVENTS.filter(n =>
  !body.some(r => r[H.substance].trim().toLowerCase() === n));
if (missing.length) console.log('  not found under that exact name:', missing.join(', '));
console.log('\nwrote', S);
