// Build a name -> SMILES lookup for the Schulz extract, from the DrugBank dump.
// Streams the 232 MB CSV with a stateful parser and keeps only three columns.
// Writes the lookup, the unmatched list, and prints the match rate.
const fs = require('fs');

const DB = '/mnt/project-files/drugbank_drugs_info.csv';
const SCHULZ = '/mnt/project-files/qsar-moa/schulz/schulz-extract.csv';
const OUT = '/mnt/project-files/qsar-moa/schulz/schulz-name-to-smiles.csv';
const UNMATCHED = '/mnt/project-files/qsar-moa/schulz/schulz-unmatched-names.csv';

const I_DBID = 10, I_NAME = 11, I_SMILES = 27;   // 0-based, from the header

const norm = s => String(s || '')
  .toLowerCase()
  .replace(/ /g, ' ')
  .replace(/[‐-―]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

// --- stream the DrugBank dump ----------------------------------------------
const byName = new Map();           // normalised name -> {id, smiles}
let field = '', row = [], inQ = false, nRows = 0, nWithSmiles = 0;

function endRow() {
  nRows++;
  if (nRows > 1) {                                   // skip the header
    const name = row[I_NAME], smi = row[I_SMILES], id = row[I_DBID];
    if (name && smi && String(smi).trim()) {
      nWithSmiles++;
      const k = norm(name);
      if (k && !byName.has(k)) byName.set(k, { id: String(id || '').trim(), smiles: String(smi).trim() });
    }
  }
  row = [];
}

const stream = fs.createReadStream(DB, { encoding: 'utf8', highWaterMark: 1 << 22 });
stream.on('data', chunk => {
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i];
    if (inQ) {
      if (c === '"') {
        if (chunk[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; endRow(); }
    else if (c !== '\r') field += c;
  }
});
stream.on('end', () => {
  if (field.length || row.length) { row.push(field); endRow(); }
  console.log('DrugBank rows read        :', nRows - 1);
  console.log('rows carrying a SMILES    :', nWithSmiles);
  console.log('distinct names with SMILES:', byName.size);
  matchSchulz();
});

// --- match the Schulz names ------------------------------------------------
function parseCSV(text) {
  const rows = []; let f = '', r = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); f = ''; rows.push(r); r = []; }
    else if (c !== '\r') f += c;
  }
  if (f.length || r.length) { r.push(f); rows.push(r); }
  return rows;
}

function candidates(name) {
  const out = [];
  const base = name.trim();
  out.push(base);
  // "Rifampicin (Rifampin)" -> "Rifampicin" and "Rifampin"
  const m = base.match(/^([^(]+)\(([^)]+)\)\s*$/);
  if (m) { out.push(m[1].trim()); out.push(m[2].trim()); }
  // "Amitriptyline, N-desmethyl-" -> "N-desmethyl-Amitriptyline" is NOT safe,
  // so only the leading part is tried, and only when a comma is present.
  if (base.includes(',')) out.push(base.split(',')[0].trim());
  // a trailing "and metabolites" / "total" style suffix
  out.push(base.replace(/\s+(and|plus)\s+.*$/i, '').trim());
  // A one- or two-letter fragment is never a usable synonym: "Bismut(h)" once
  // produced "h" and matched hydrogen. Reject that whole class.
  return [...new Set(out.filter(Boolean))].filter(v => v.length >= 3);
}

function matchSchulz() {
  const rows = parseCSV(fs.readFileSync(SCHULZ, 'utf8'));
  const hdr = rows[0].map(h => h.trim());
  const ix = {}; hdr.forEach((h, i) => ix[h] = i);
  const body = rows.slice(1).filter(r => (r[ix.substance] || '').trim());

  const outLines = ['substance,match_kind,matched_name,drugbank_id,smiles'];
  const unLines = ['substance,has_log_index,therapeutic_low_mg_L,toxic_low_mg_L'];
  let hitExact = 0, hitAlt = 0, miss = 0;
  let hitWithIdx = 0, missWithIdx = 0, totalWithIdx = 0;

  const q = s => '"' + String(s).replace(/"/g, '""') + '"';

  for (const r of body) {
    const name = (r[ix.substance] || '').trim();
    const hasIdx = (r[ix.log_therapeutic_index] || '').trim() !== '';
    if (hasIdx) totalWithIdx++;
    const cands = candidates(name);
    let found = null, kind = null, which = null;
    for (let i = 0; i < cands.length; i++) {
      const hit = byName.get(norm(cands[i]));
      if (hit) { found = hit; kind = i === 0 ? 'exact' : 'alternate_name'; which = cands[i]; break; }
    }
    if (found) {
      if (kind === 'exact') hitExact++; else hitAlt++;
      if (hasIdx) hitWithIdx++;
      outLines.push([q(name), kind, q(which), q(found.id), q(found.smiles)].join(','));
    } else {
      miss++;
      if (hasIdx) missWithIdx++;
      unLines.push([q(name), hasIdx ? 'yes' : 'no',
        q(r[ix.therapeutic_low_mg_L] || ''), q(r[ix.toxic_low_mg_L] || '')].join(','));
    }
  }

  fs.writeFileSync(OUT, outLines.join('\n') + '\n');
  fs.writeFileSync(UNMATCHED, unLines.join('\n') + '\n');
  console.log('\nSchulz rows               :', body.length);
  console.log('matched exactly           :', hitExact);
  console.log('matched on an alternate   :', hitAlt);
  console.log('not matched               :', miss);
  console.log('match rate                :', ((hitExact + hitAlt) / body.length * 100).toFixed(1) + '%');
  console.log('\nrows carrying a log index :', totalWithIdx);
  console.log('  of those, matched       :', hitWithIdx,
    '(' + (hitWithIdx / Math.max(totalWithIdx, 1) * 100).toFixed(1) + '%)');
  console.log('  of those, unmatched     :', missWithIdx, '<-- THIS is the usable n');
  console.log('\nwrote', OUT);
  console.log('wrote', UNMATCHED);
}
