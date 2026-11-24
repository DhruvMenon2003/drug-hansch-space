// Assemble one row per drug, grouped by mechanism, from the 31 chapter files. No invented values.
import fs from 'node:fs';
const exDir = process.argv[2], out = process.argv[3];
let all = [];
for (const f of fs.readdirSync(exDir).filter(f => /^ch\d+\.json$/.test(f)).sort()) {
  const j = JSON.parse(fs.readFileSync(`${exDir}/${f}`, 'utf8'));
  (j.records || []).forEach((r, i) => all.push({ ...r, _ch: j.chapter_number, _chTitle: j.chapter_title, _rec: i + 1 }));
}
// Star's rule: receptor and enzyme only.
const dropped = all.filter(r => !['receptor', 'enzyme'].includes(r.target_class));
const use = all.filter(r => ['receptor', 'enzyme'].includes(r.target_class));

// Star's four words only. Normalise the helper's name to end in one of them.
const WORD = { receptor: ['Agonist', 'Antagonist'], enzyme: ['Inhibitor', 'Activator'] };
const roleFrom = r => {
  const h = ((r.role_detail || '') + ' || ' + (r.mechanism_book_wording || '') + ' || ' + (r.quote || '') + ' || ' + (r.mechanism_rule_name || ''));
  if (r.target_class === 'receptor') {
    if (/antagoni[sz]|\bblocke?[rd]?s?\b|\bblocks\b|\bblocking\b|inhibit/i.test(h)) return 'Antagonist';
    if (/(?<!ant)agoni[sz]|activat|stimulat/i.test(h)) return 'Agonist';
  } else {
    if (/inhibit|\bsuppress|anti-?cholinesterase|\bblocks?\b/i.test(h)) return 'Inhibitor';
    if (/activat|stimulat/i.test(h)) return 'Activator';
  }
  const m = (r.mechanism_rule_name || '').match(/(Agonist|Antagonist|Inhibitor|Activator)\s*$/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};
// Did the BOOK itself state one of Star's four actions for this target?
// Stems matter: 'antagonizing' is antagoni-Z-ing, 'agonism' is agoni-SM. Match stems, not whole words.
const ANTAG = /antagoni[sz]|\bblocke?[rd]?s?\b|\bblocks\b|\bblocking\b|inhibit(s|ing|ion)? (the )?(function|activity)? ?of/i;
const AGON = /(?<!ant)agoni[sz]|activat|stimulat/i;
const INHIB = /inhibit|\bsuppress|anti-?cholinesterase|\bblocks?\b|\bblocking\b/i;
const ACTIV = /activat|stimulat/i;
// Kinds of action that are NOT one of the four. Star 2026-11-24: drop these.
const OTHER_KIND = /allosteric|\bpam\b|\bnam\b|potentiator|potentiates|inverse agonist|partial agonist|co-?agonist|stabiliz|stabilis|direction not stated|direction inferred/i;
const ONLY_BINDS = /^(binds|binding|acts on|ligand)/i;
const statedness = r => {
  const book = (r.mechanism_book_wording || '') + ' ' + (r.quote || '');
  const role = r.role_detail || '';
  if (OTHER_KIND.test(role) || OTHER_KIND.test(r.mechanism_book_wording || '')) return 'drop: the book describes a different kind of action';
  if (r.target_class === 'enzyme' && /\binduc/i.test(role + ' ' + (r.mechanism_book_wording || ''))) return 'drop: enzyme induction, not activation of the enzyme';
  if (ONLY_BINDS.test(role.trim())) return 'drop: the book says only that it binds or acts on the target';
  if (r.target_class === 'receptor' && (ANTAG.test(book) || AGON.test(book))) return 'Stated by the book';
  if (r.target_class === 'enzyme' && (INHIB.test(book) || ACTIV.test(book))) return 'Stated by the book';
  return 'drop: the book does not state an agonist, antagonist, inhibitor or activator action';
};
const titled = s => s.replace(/\s+/g, ' ').trim();
const key = s => titled(s).toLowerCase();

for (const r of use) {
  r._role = roleFrom(r);
  const base = (r.mechanism_rule_name || '').replace(/\s*(Agonist|Antagonist|Inhibitor|Activator|Modulator|Ligand.*|Partial Agonist|Inverse Agonist)\s*$/i, '').trim()
    || titled(r.target || '');
  r._mech = r._role ? `${titled(base)} ${r._role}` : titled(r.mechanism_rule_name || base);
  r._stated = statedness(r);
}
// merge mechanism names that differ only by case/spacing
const canon = new Map();
for (const r of use) { const k = key(r._mech); if (!canon.has(k)) canon.set(k, r._mech); r._mech = canon.get(k); }

// Four pairs held back: book vs DrugBank disagreement, to be put to Star separately.
const HELD = []; // Star 2026-11-24: do not hold the conflicts; DrugBank direction in the main column, book wording beside it, flagged.
const isHeld = r => HELD.some(([d, re]) => (r.drug || '').toLowerCase().includes(d) && re.test(r._mech));
const held = use.filter(isHeld);
const keep = use.filter(r => !isHeld(r));

// Star 2026-11-24: "Stick to agonists/antagonists or inhibitors/activators. Drop everything else."
// Keep ONLY records where the book itself states one of the four actions. Everything in the naming-rule gap goes.
// Page-read verdicts from the reading thread decide what stays (they win over any keyword test).
const V = JSON.parse(fs.readFileSync(exDir + '/verify/surviving-records.json', 'utf8'));
const C = JSON.parse(fs.readFileSync(exDir + '/verify/consistency-pass.json', 'utf8'));
const KEEP = new Set(V.surviving_records.map(x => x.chapter + ':' + x.record_number));
for (const x of C.regraded || []) if (x.revised_verdict === 'keep') KEEP.add(x.chapter + ':' + x.record_number);
for (const r of use) { const m = (r.mechanism_rule_name || '').match(/(Agonist|Antagonist|Inhibitor|Activator)\s*$/i); if (m) { r._role = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); const base = r.mechanism_rule_name.replace(/\s*(Agonist|Antagonist|Inhibitor|Activator)\s*$/i, '').trim(); r._mech = titled(base) + ' ' + r._role; const k = key(r._mech); if (!canon.has(k)) canon.set(k, r._mech); r._mech = canon.get(k); } r._stated = 'Stated by the book (confirmed by a second read of the page)'; }
const inKeep = r => KEEP.has(r._ch + ':' + r._rec);
const heldAll = use.filter(r => inKeep(r) && isHeld(r));
const gapOut = use.filter(r => !inKeep(r));
const keep2 = use.filter(r => inKeep(r) && !isHeld(r));
console.log('verified keep set', KEEP.size, '| held back', heldAll.length);
// One row per drug.
const rows = new Map();
for (const r of keep2) {
  const d = titled(r.drug || '');
  const id = d ? 'drug:' + d.toLowerCase() : `class:${r._mech.toLowerCase()}`;
  if (!rows.has(id)) rows.set(id, { drug: d, isClass: !d, recs: [] });
  rows.get(id).recs.push(r);
}
const outRows = [];
for (const [id, v] of rows) {
  const recs = v.recs.slice().sort((a, b) => a._ch - b._ch || a.pdf_page_index - b.pdf_page_index || a._rec - b._rec);
  const primary = recs[0];
  const mechs = [...new Set(recs.map(r => r._mech))];
  outRows.push({
    mechanism_group: primary._mech,
    drug: v.drug || '(no drug named — the book states the mechanism only)',
    is_class_row: v.isClass,
    other_mechanisms: mechs.slice(1),
    n_mechanisms: mechs.length,
    target: primary.target, target_class: primary.target_class,
    role_word: primary._role, direction_source: primary._stated,
    drug_kind: primary.drug_kind === 'not stated' ? '' : primary.drug_kind,
    book_wording: [...new Set(recs.map(r => r.mechanism_book_wording))].join(' | '),
    chapters: [...new Set(recs.map(r => r._ch))],
    pdf_page_index: primary.pdf_page_index, printed_page: primary.printed_page,
    location_on_page: primary.location_on_page,
    quote: primary.quote,
    all_pages: [...new Set(recs.map(r => `PDF p.${r.pdf_page_index} (printed p.${r.printed_page})`))],
    numbers_given: [...new Set(recs.map(r => r.numbers_given).filter(x => x && x !== 'none'))].join('; ') || 'none',
    numbers_detail: [...new Set(recs.map(r => r.numbers_detail).filter(Boolean))].join(' | '),
    notes: [...new Set(recs.map(r => r.notes).filter(Boolean))].join(' | '),
    record_mechs: recs.map(r => ({ key: `ch${String(r._ch).padStart(2, "0")}#${r._rec}`, mech: r._mech, page: r.pdf_page_index, wording: r.mechanism_book_wording })),
    source_records: recs.map(r => `ch${String(r._ch).padStart(2, '0')}#${r._rec}`),
  });
}
outRows.sort((a, b) => a.mechanism_group.localeCompare(b.mechanism_group) || (a.is_class_row - b.is_class_row) || a.drug.localeCompare(b.drug));
fs.writeFileSync(`${out}/rows.json`, JSON.stringify({ built_utc: new Date().toISOString(), rows: outRows, held_back: held.map(r => ({ drug: r.drug, mechanism: r._mech, chapter: r._ch, record: r._rec, page: r.pdf_page_index, quote: r.quote })), dropped_outside_the_four_words: gapOut.map(r => ({ drug: r.drug, target: r.target, target_class: r.target_class, mechanism_as_read: r.mechanism_rule_name, book_wording: r.mechanism_book_wording, role_detail: r.role_detail, reason: r._stated, chapter: r._ch, record: r._rec, page: r.pdf_page_index })), dropped_outside_the_four_words: gapOut.map(r => ({ drug: r.drug, target: r.target, target_class: r.target_class, mechanism_as_read: r.mechanism_rule_name, book_wording: r.mechanism_book_wording, role_detail: r.role_detail, reason: r._stated, chapter: r._ch, record: r._rec, page: r.pdf_page_index })), dropped_not_receptor_or_enzyme: dropped.map(r => ({ drug: r.drug, target: r.target, target_class: r.target_class, kind: r.other_target_kind, chapter: r._ch, record: r._rec })) }, null, 1));
const g = new Set(outRows.map(r => r.mechanism_group));
console.log('records kept', keep2.length, 'dropped outside the four words', gapOut.length);
console.log('rows', outRows.length, '| mechanism groups', g.size, '| class rows', outRows.filter(r => r.is_class_row).length, '| held back', held.length, '| dropped', dropped.length);
const st = {}; for (const r of outRows) st[r.direction_source] = (st[r.direction_source] || 0) + 1; console.log(st);
console.log('drugs with more than one mechanism:', outRows.filter(r => r.n_mechanisms > 1).length);
