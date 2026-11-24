// Attach the page-read book-versus-DrugBank comparison to each row, and apply Star's rule for conflicts:
// DrugBank's direction goes in the main mechanism column, the book's wording stays beside it, the row is flagged.
import fs from 'node:fs';
const out = process.argv[2];
const d = JSON.parse(fs.readFileSync(`${out}/rows.json`, 'utf8'));
const C = JSON.parse(fs.readFileSync(`${out}/extraction/verify/drugbank-comparison.json`, 'utf8'));
const cmp = new Map(C.comparisons.map(c => [`ch${String(c.chapter).padStart(2, '0')}#${c.record_number}`, c]));
const kind = new Map(C.disagreements.map(x => [`ch${String(x.chapter).padStart(2, '0')}#${x.record_number}`, x.kind]));
const OPP = { Agonist: 'Antagonist', Antagonist: 'Agonist', Inhibitor: 'Activator', Activator: 'Inhibitor' };
const LABEL = {
  'agrees': 'Agrees with the book',
  'partly agrees': 'Partly agrees with the book',
  'cannot compare': 'Cannot compare',
};
let flipped = 0, missing = 0;
const tally = {};
for (const r of d.rows) {
  const key = r.source_records[0];
  const c = cmp.get(key);
  r.book_mechanism = r.mechanism_group;
  r.conflict = '';
  if (!c) { missing++; r.db_check = 'Not compared'; r.db_says = ''; r.db_why = ''; r.db_status = ''; continue; }
  r.db_status = c.drugbank_status; r.db_says = c.drugbank_says || ''; r.db_why = c.why || ''; r.db_entry = c.drugbank_entry_used || '';
  if (c.agreement === 'disagrees') {
    const k = kind.get(key) || '';
    if (k.startsWith('opposite direction') && OPP[r.role_word]) {
      const base = r.mechanism_group.replace(/\s*(Agonist|Antagonist|Inhibitor|Activator)\s*$/, '');
      r.role_word = OPP[r.role_word];
      r.mechanism_group = `${base} ${r.role_word}`;
      r.db_check = 'CONFLICT: DrugBank states the opposite direction';
      r.conflict = `The book says "${r.book_mechanism}". DrugBank says the opposite, so the mechanism column follows DrugBank and the book's wording is kept in its own column.`;
      flipped++;
    } else {
      r.db_check = 'DrugBank names a different target and does not mention the book\'s target';
      r.conflict = 'DrugBank is silent on this target, so the mechanism column keeps the book\'s wording. This is not a contradiction.';
    }
  } else if (c.agreement === 'cannot compare') {
    r.db_check = `Cannot compare: ${c.drugbank_status}`;
  } else r.db_check = LABEL[c.agreement] || c.agreement;
  tally[r.db_check.split(':')[0]] = (tally[r.db_check.split(':')[0]] || 0) + 1;
}
// Conflicts sitting in a drug's second or third mechanism (the row is keyed on its first).
for (const r of d.rows) {
  for (const rm of (r.record_mechs || []).slice(1)) {
    const k = kind.get(rm.key) || '';
    if (!k.startsWith('opposite direction')) continue;
    const w = (rm.mech.match(/(Agonist|Antagonist|Inhibitor|Activator)\s*$/) || [])[1]; if (!w) continue;
    const fixed = rm.mech.replace(/(Agonist|Antagonist|Inhibitor|Activator)\s*$/, OPP[w]);
    r.other_mechanisms = [...new Set((r.other_mechanisms || []).map(x => x === rm.mech ? fixed : x))].filter(x => x !== r.mechanism_group);
    r.conflict = (r.conflict ? r.conflict + ' ' : '') + `On PDF p.${rm.page} the book says ${rm.mech} (${rm.wording}). DrugBank states the opposite direction, so ${fixed} is used here.`;
    r.db_check = 'CONFLICT: DrugBank states the opposite direction for one of this drug\'s mechanisms';
    flipped++;
  }
}
console.log('conflicts resolved toward DrugBank (all mechanisms):', flipped);
d.rows.sort((a, b) => a.mechanism_group.localeCompare(b.mechanism_group) || (a.is_class_row - b.is_class_row) || a.drug.localeCompare(b.drug));
fs.writeFileSync(`${out}/rows.json`, JSON.stringify(d, null, 1));
console.log('rows', d.rows.length, '| direction taken from DrugBank', flipped, '| rows with no comparison entry', missing);
console.log(tally);
console.log('mechanism groups', new Set(d.rows.map(r => r.mechanism_group)).size);
