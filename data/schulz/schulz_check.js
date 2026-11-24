// Verify the Schulz extract independently: counts, and whether
// log_therapeutic_index really equals log10(toxic_low / therapeutic_low).
const fs = require('fs');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = fs.readFileSync('/mnt/project-files/qsar-moa/schulz/schulz-extract.csv', 'utf8');
const rows = parseCSV(raw);
const hdr = rows[0].map(h => h.trim());
const ix = {};
hdr.forEach((h, i) => ix[h] = i);
const body = rows.slice(1).filter(r => r.length >= hdr.length - 2 && (r[ix.substance] || '').trim());

const num = v => {
  if (v === undefined) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const f = parseFloat(s);
  return isNaN(f) ? NaN : f;
};

let therap = 0, toxic = 0, both = 0, bothPos = 0, withIdx = 0, idxOK = 0, idxBad = [];
const names = new Set();
const quals = {};
for (const r of body) {
  names.add(r[ix.substance].trim().toLowerCase());
  const t = num(r[ix.therapeutic_low_mg_L]);
  const x = num(r[ix.toxic_low_mg_L]);
  const li = num(r[ix.log_therapeutic_index]);
  if (!isNaN(t)) therap++;
  if (!isNaN(x)) toxic++;
  if (!isNaN(t) && !isNaN(x)) both++;
  if (!isNaN(t) && !isNaN(x) && t > 0 && x > 0) bothPos++;
  if (!isNaN(li)) {
    withIdx++;
    if (!isNaN(t) && !isNaN(x) && t > 0 && x > 0) {
      const expect = Math.log10(x / t);
      if (Math.abs(expect - li) < 1e-6) idxOK++;
      else if (idxBad.length < 8)
        idxBad.push(`${r[ix.substance]}: stored ${li}, log10(${x}/${t}) = ${expect.toFixed(6)}`);
    } else if (idxBad.length < 8) idxBad.push(`${r[ix.substance]}: index ${li} but levels ${t}/${x}`);
  }
  for (const k of ['therapeutic_qualifier', 'toxic_qualifier']) {
    const q = (r[ix[k]] || '').trim();
    if (q) quals[k + '=' + q] = (quals[k + '=' + q] || 0) + 1;
  }
}
console.log('data rows            :', body.length);
console.log('distinct names       :', names.size);
console.log('therapeutic_low set  :', therap);
console.log('toxic_low set        :', toxic);
console.log('both set             :', both, '| both > 0 :', bothPos);
console.log('log_therapeutic_index:', withIdx, '| matches log10(toxic/therap):', idxOK);
console.log('units values         :', [...new Set(body.map(r => (r[ix.units] || '').trim()))].slice(0, 5));
console.log('licence values       :', [...new Set(body.map(r => (r[ix.licence] || '').trim()))].slice(0, 3));
console.log('rows with a citation :', body.filter(r => (r[ix.source_citation] || '').trim()).length);
console.log('\nqualifiers:'); Object.entries(quals).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ' : ' + v));
if (idxBad.length) { console.log('\nindex mismatches (first few):'); idxBad.forEach(s => console.log('  ' + s)); }

// sanity: implausibly large indices are the superscript-corruption signature
const big = body.filter(r => num(r[ix.log_therapeutic_index]) > 3)
  .map(r => `${r[ix.substance]}: therap ${r[ix.therapeutic_low_mg_L]} tox ${r[ix.toxic_low_mg_L]} idx ${num(r[ix.log_therapeutic_index]).toFixed(2)} | tox_raw="${r[ix.toxic_raw]}" ann="${r[ix.toxic_annotation]}"`);
console.log('\nrows with log index > 3 (would be a >1000x window):', big.length);
big.slice(0, 12).forEach(s => console.log('  ' + s));
