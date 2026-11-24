// Second pass for the Schulz names DrugBank's dump could not resolve:
// a few more safe name variants, then PubChem name -> SMILES for the rest.
// Every row records where its structure came from. Nothing is guessed.
const fs = require('fs');
const https = require('https');

const SCHULZ = '/mnt/project-files/qsar-moa/schulz/schulz-extract.csv';
const LOOKUP = '/mnt/project-files/qsar-moa/schulz/schulz-name-to-smiles.csv';
const OUT = '/mnt/project-files/qsar-moa/schulz/schulz-structures.csv';
const STILL = '/mnt/project-files/qsar-moa/schulz/schulz-unresolved-names.csv';

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
const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';

// what the DrugBank pass already resolved
const lk = parseCSV(fs.readFileSync(LOOKUP, 'utf8'));
const lkH = {}; lk[0].forEach((h, i) => lkH[h.trim()] = i);
const resolved = new Map();
for (const r of lk.slice(1)) {
  if (!r[lkH.substance]) continue;
  resolved.set(r[lkH.substance], {
    smiles: r[lkH.smiles], source: 'drugbank_dump',
    matched_name: r[lkH.matched_name], dbid: r[lkH.drugbank_id],
    kind: r[lkH.match_kind],
  });
}

const rows = parseCSV(fs.readFileSync(SCHULZ, 'utf8'));
const H = {}; rows[0].forEach((h, i) => H[h.trim()] = i);
const body = rows.slice(1).filter(r => (r[H.substance] || '').trim());

// extra safe variants for the names the first pass missed
function variants(name) {
  const out = new Set();
  const base = name.trim();
  out.add(base);
  const inner = base.match(/^([^(]+)\(([^)]+)\)\s*$/);     // "A (B)"
  if (inner) { out.add(inner[1].trim()); out.add(inner[2].trim()); }
  // inline parenthesis inside a word: "Acecarbromal(um)", "Bismut(h)"
  const m2 = base.match(/^([A-Za-z0-9-]+)\(([A-Za-z]+)\)$/);
  if (m2) { out.add(m2[1]); out.add(m2[1] + m2[2]); }
  out.add(base.replace(/\(([^)]*)\)/g, '').replace(/\s+/g, ' ').trim());
  if (base.includes(',')) out.add(base.split(',')[0].trim());
  out.add(base.replace(/\s+(and|plus)\s+.*$/i, '').trim());
  // A one- or two-letter fragment is never a usable synonym: "Bismut(h)" once
  // produced "h" and matched hydrogen. Reject that whole class.
  return [...out].filter(Boolean).filter(v => v.length >= 3);
}

const pending = body
  .map(r => (r[H.substance] || '').trim())
  .filter(n => !resolved.has(n));
console.log('names still unresolved after the DrugBank pass:', pending.length);

function pubchem(name) {
  return new Promise(resolve => {
    const url = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/'
      + encodeURIComponent(name)
      + '/property/CanonicalSMILES,IsomericSMILES/JSON';
    const req = https.get(url, { timeout: 20000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const p = JSON.parse(d).PropertyTable.Properties[0];
          const smi = p.CanonicalSMILES || p.IsomericSMILES || p.SMILES;
          resolve(smi ? { smiles: smi, cid: p.CID } : null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

(async () => {
  let got = 0, tried = 0;
  for (const name of pending) {
    let hit = null, used = null;
    for (const v of variants(name)) {
      tried++;
      hit = await pubchem(v);
      await new Promise(r => setTimeout(r, 220));   // stay under PubChem's rate limit
      if (hit) { used = v; break; }
    }
    if (hit) {
      got++;
      resolved.set(name, {
        smiles: hit.smiles, source: 'pubchem_name_lookup',
        matched_name: used, dbid: 'CID:' + hit.cid, kind: 'pubchem',
      });
    }
    if ((got + 1) % 25 === 0) console.log(`  ... ${got} resolved of ${pending.length} tried so far`);
  }
  console.log('PubChem resolved          :', got, 'of', pending.length,
    `(${tried} name variants queried)`);

  // write one structure file for the whole extract
  const lines = ['substance,has_log_index,log_therapeutic_index,therapeutic_low_mg_L,'
    + 'toxic_low_mg_L,units,structure_source,matched_name,source_id,smiles,has_carbon'];
  const miss = ['substance,has_log_index,therapeutic_low_mg_L,toxic_low_mg_L'];
  let withIdxResolved = 0, withIdxTotal = 0, organic = 0;
  for (const r of body) {
    const name = (r[H.substance] || '').trim();
    const li = (r[H.log_therapeutic_index] || '').trim();
    const hasIdx = li !== '';
    if (hasIdx) withIdxTotal++;
    const hit = resolved.get(name);
    if (!hit || !hit.smiles) {
      miss.push([q(name), hasIdx ? 'yes' : 'no',
        q(r[H.therapeutic_low_mg_L]), q(r[H.toxic_low_mg_L])].join(','));
      continue;
    }
    if (hasIdx) withIdxResolved++;
    const hasC = /C/i.test(String(hit.smiles).replace(/Cl|Ca|Cd|Cr|Cu|Co|Cs/g, ''));
    if (hasC) organic++;
    lines.push([q(name), hasIdx ? 'yes' : 'no', q(li), q(r[H.therapeutic_low_mg_L]),
      q(r[H.toxic_low_mg_L]), q(r[H.units]), q(hit.source), q(hit.matched_name),
      q(hit.dbid), q(hit.smiles), hasC ? 'yes' : 'no'].join(','));
  }
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  fs.writeFileSync(STILL, miss.join('\n') + '\n');
  console.log('\n--- headline numbers ---');
  console.log('rows with a structure     :', lines.length - 1, 'of', body.length,
    `(${((lines.length - 1) / body.length * 100).toFixed(1)}%)`);
  console.log('rows with an index        :', withIdxTotal);
  console.log('  AND a structure  -> n   :', withIdxResolved,
    `(${(withIdxResolved / Math.max(withIdxTotal, 1) * 100).toFixed(1)}% of them)`);
  console.log('  of those, carbon-containing:', organic);
  console.log('still unresolved          :', miss.length - 1);
  console.log('\nwrote', OUT, '\nwrote', STILL);
})();
