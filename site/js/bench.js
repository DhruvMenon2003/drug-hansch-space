// Layer 2. The bench: fill in the pharmacokinetic numbers a paper gives for the selected drug, per administration mode.
// The curated values come from data/clean_drugs.json, fetched on the first selection. Edits stay in this browser
// (localStorage, the same key the lab page used) and download as CSV with their source, ready to send back for curation.
import { app, bus, $, cap, esc, fx } from './kernel.js';
import { getSide } from './extras.js';
import { selectDrug } from './view.js';

const KEY = 'hansch-lab-v1';
const F = [['F', 'F', 'fraction absorbed, 0–1'], ['t12', 't½', 'h'], ['dose', 'Dose', 'mg'], ['tau', 'Every', 'h'], ['tox', 'Lethal dose', 'mg/kg'], ['act', 'Active dose', 'mg/day']];
const fcOf = r => (r.F > 0 && r.t12 > 0 && r.dose > 0 && r.tau > 0 ? 1.44 * r.F * r.t12 * r.dose / r.tau : null);
const tiOf = r => (r.tox > 0 && r.act > 0 ? Math.log10(r.tox) + Math.log10(r.act) : null);
let rows = null, edits = load(), cur = null;

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(edits)); } catch { /* private mode: edits last for the page */ } }

async function curated(cid) {
  if (!rows) {
    const j = await getSide('data/clean_drugs.json'), ix = Object.fromEntries(j.cols.map((c, i) => [c, i]));
    rows = new Map();
    for (const a of j.rows) {
      const o = {}; for (const c of ['rid', 'cid', 'nm', 'atc', 'md', ...F.map(f => f[0])]) o[c] = a[ix[c]];
      if (!rows.has(o.cid)) rows.set(o.cid, []);
      rows.get(o.cid).push(o);
    }
  }
  return rows.get(cid) || [];
}

const merged = r => ({ ...r, ...(edits[r.rid] || {}) });

function card(list, pick) {
  const r = merged(list[pick]), e = edits[r.rid] || {};
  const fc = fcOf(r), ti = tiOf(r);
  $('#d-bench').innerHTML = `<div class="bench">
    <h4>Numbers from a paper</h4>
    ${list.length > 1 ? `<div class="bench-modes">${list.map((m, i) => `<button type="button" class="ghost" data-i="${i}" aria-pressed="${i === pick}">${esc(cap(m.md || 'no route'))}</button>`).join('')}</div>` : `<p class="small">${esc(cap(r.md || 'No route listed'))} · ${esc(r.atc || '')}</p>`}
    <div class="bench-grid">${F.map(([k, l, u]) => `<label>${l} <small>${u}</small><input name="${k}" inputmode="decimal" value="${r[k] ?? ''}" placeholder="missing"${k in e ? ' class="changed"' : ''}></label>`).join('')}</div>
    <label class="bench-src">Source <small>DOI or PMID</small><input name="src" value="${esc(e.src || '')}" placeholder="doi:10.…"></label>
    <dl class="kv"><div><dt>Steady-state level</dt><dd>${fc == null ? 'needs F, t½, dose and interval' : fx(fc, 2)}</dd></div><div><dt>Therapeutic index</dt><dd>${ti == null ? 'needs lethal and active dose' : fx(ti, 2)}</dd></div></dl>
    <p class="bench-row">${Object.keys(e).length ? '<button type="button" class="ghost" data-act="revert">Back to curated</button>' : ''}
      <button type="button" class="ghost" data-act="csv">Download my edits (${Object.keys(edits).length})</button></p>
  </div>`;
  const box = $('#d-bench .bench');
  box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => card(list, +b.dataset.i));
  box.querySelectorAll('input').forEach(inp => inp.onchange = () => {
    const k = inp.name, v = inp.value.trim(), n = Number(v);
    const ed = edits[r.rid] || (edits[r.rid] = { nm: r.nm, md: r.md });
    if (k === 'src') ed.src = v;
    else if (v === '') delete ed[k];
    else if (!Number.isFinite(n) || n < 0 || (k === 'F' && n > 1)) { inp.setCustomValidity('Out of range'); inp.reportValidity(); return; }
    else ed[k] = n;
    save(); card(list, pick);
  });
  box.querySelector('[data-act="revert"]')?.addEventListener('click', () => { delete edits[r.rid]; save(); card(list, pick); });
  box.querySelector('[data-act="csv"]').onclick = csv;
}

function csv() {
  const cols = ['rid', 'nm', 'md', ...F.map(f => f[0]), 'fc', 'ti', 'src'];
  const q = v => (v == null ? '' : /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = Object.entries(edits).map(([rid, e]) => {
    const base = [...(rows?.values() || [])].flat().find(r => r.rid === rid) || {};
    const m = { ...base, ...e, rid };
    return cols.map(c => q(c === 'fc' ? fcOf(m) : c === 'ti' ? tiOf(m) : m[c])).join(',');
  });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' })), download: 'my-pk-edits.csv' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initBench() {
  initUpload();
  bus.on('selection', async ({ index }) => {
    const d = app.drugs[index]; cur = d.cid;
    $('#d-bench').innerHTML = '';
    const list = await curated(d.cid).catch(() => []);
    if (cur === d.cid && list.length) card(list, 0);
  });
}

// Upload: a reader's own CSV or TSV (for example the curation sheet saved as CSV). Rows are matched to drugs by PubChem CID or
// generic name, and to a mode by the route column; the numbers land in the same edit store as typed values.
const HEAD = [[/^(compound identifier|cid|pubchem)/, 'cid'], [/^(generic name|name|drug)/, 'nm'], [/^(mode of administration|route|admr)/, 'md'],
  [/^(bioavailability|f$|fraction)/, 'F'], [/^(half.?life|t1\/2|t12)/, 't12'], [/^(dosage|dose$|dose \(mg\)|dose_mg)/, 'dose'],
  [/^(dose interval|interval|tau)/, 'tau'], [/^(in vivo toxicity|toxicity|ld50|tox)/, 'tox'], [/^(in vivo activity|activity|act)/, 'act'], [/^(source|doi|pmid|reference)/, 'src']];

function parse(text) {
  const sep = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

async function importTable(file) {
  const out = $('#upload-out');
  const grid = parse(await file.text());
  const hi = grid.findIndex(r => r.some(c => HEAD.slice(0, 2).some(([re]) => re.test(c.trim().toLowerCase()))));
  if (hi < 0) { out.textContent = 'No drug name or CID column found. Name a column "Generic Name" or "Compound Identifier".'; return; }
  const map = grid[hi].map(h => HEAD.find(([re]) => re.test(h.trim().toLowerCase()))?.[1]);
  await curated(-1);
  const byName = new Map([...rows.values()].map(l => [String(l[0].nm).toLowerCase(), l]));
  let n = 0; const hit = new Set(), miss = new Set();
  for (const r of grid.slice(hi + 1)) {
    const o = {}; map.forEach((k, i) => { if (k && r[i] != null && String(r[i]).trim() !== '') o[k] = String(r[i]).trim(); });
    if (!o.cid && !o.nm) continue;
    const list = rows.get(Number(o.cid)) || byName.get(String(o.nm || '').toLowerCase());
    if (!list) { miss.add(o.nm || o.cid); continue; }
    const md = (o.md || '').toUpperCase(), tgt = list.filter(x => !md || x.md === md);
    const vals = {}; for (const [k] of F) { const v = Number(o[k]); if (o[k] != null && Number.isFinite(v) && v >= 0 && !(k === 'F' && v > 1)) vals[k] = v; }
    if (!Object.keys(vals).length) continue;
    for (const x of tgt.length ? tgt : [list[0]]) { edits[x.rid] = { ...(edits[x.rid] || { nm: x.nm, md: x.md }), ...vals, src: o.src || `upload: ${file.name}` }; n++; }
    hit.add(list[0].cid);
  }
  save();
  out.innerHTML = `Filled ${n} drug routes for ${hit.size} drugs.` + (miss.size ? ` ${miss.size} names not in this dataset.` : '') +
    (hit.size ? `<br>${[...hit].slice(0, 30).map(c => `<button type="button" class="ghost" data-cid="${c}">${esc(cap(rows.get(c)[0].nm))}</button>`).join(' ')}` : '');
  out.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => selectDrug(+b.dataset.cid));
  if (cur != null) bus.emit('selection', { index: app.drugs.findIndex(d => d.cid === cur) });
}

export function initUpload() { $('#upload')?.addEventListener('change', e => e.target.files[0] && importTable(e.target.files[0])); }
