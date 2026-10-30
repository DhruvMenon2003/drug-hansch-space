// The decision workbench: the Decisions tab of the therapeutic-index overlay. The reader sets the inclusion rules
// the ranking has to obey, and the batch is re-derived in front of them: how many molecules survive, how many
// targets still hold enough of them to rank, where the median goes, who is left at the top, and which drugs on the
// plot keep an index. Data: site/data/ti/batch.json (every ranked molecule, written by tools/build_ti_live.py).
//
// What this does and does not do. Every number per molecule is fixed: the activity, the hERG value and so the index
// itself were produced by the run and are never recomputed here. What the rules move is membership and rank, which
// is exactly what an inclusion rule moves in a real workflow, and it moves honestly because the file carries the
// whole batch, not only the molecules this page happens to draw. A decision that would change a fitted number -
// the descriptor block, the split, the pruner inside the hyper-parameter search - cannot be answered this way and
// is not offered here; those arrive as recorded runs, labelled as recorded.
import { app, bus, $, esc, fin, fx, median } from './kernel.js';

const URL = 'data/ti/batch.json';

/**
 * The rules, in the order they are applied. Order matters and is shown: each rule reports what it removed from what
 * the rules above it had already left, so the counts add up to the batch and no molecule is counted out twice.
 * `keep` answers "does this molecule pass this rule", for every option but the first, which keeps everything.
 */
export const RULES = [
  { key: 'act', label: 'Activity number', dflt: 'any', options: [
    { v: 'any', label: 'any source', note: 'measurement, Hansch series or the target’s fallback model' },
    { v: 'model_ok', label: 'no fallback', note: 'a measurement or a validated Hansch series only', keep: m => m.as !== 'fallback_nonlinear' },
    { v: 'measured', label: 'measured only', note: 'ChEMBL holds a binding value for this molecule at this target', keep: m => m.as === 'measured' },
  ] },
  { key: 'herg', label: 'hERG number', dflt: 'any', options: [
    { v: 'any', label: 'any source', note: 'measurement or the liability model' },
    { v: 'measured', label: 'measured only', note: 'a real hERG measurement, no prediction on the toxicity side', keep: m => m.hs === 'measured' },
  ] },
  { key: 'ad', label: 'Applicability domain', dflt: 'any', options: [
    { v: 'any', label: 'keep molecules outside it', note: 'the published batch does this, and says so on every row' },
    { v: 'inside', label: 'inside the domain only', note: 'drop molecules the model was asked about but not trained near', keep: m => m.ad !== 'outside' },
    { v: 'measured', label: 'measured on both sides', note: 'no domain question at all, because nothing was modelled', keep: m => m.ad === 'measured' },
  ] },
  { key: 'tgt', label: 'Target assignment', dflt: 'any', options: [
    { v: 'any', label: 'recorded or inferred', note: 'the structure router may name the target' },
    { v: 'sure', label: 'no tied routings', note: 'drop the ones where the router’s best matches were level', keep: m => m.rd !== 'ambiguous' },
    { v: 'mechanism', label: 'recorded in ChEMBL only', note: 'the target comes from a curated mechanism of action', keep: m => m.ts === 'chembl_mechanism' },
  ] },
];

/**
 * The minimum molecules a target must still hold for a rank inside it to mean anything. It starts at one, which is
 * what the run published, so that the panel's baseline is the run's own batch and not a stricter one chosen here.
 * Raising it to two is the first thing worth doing: 61 of the 170 targets hold a single molecule, and a rank of
 * 1 of 1 is not a ranking.
 */
export const MIN_N = { key: 'minN', label: 'Molecules needed at a target', dflt: 1, min: 1, max: 10 };

export const defaults = () => Object.fromEntries([...RULES.map(r => [r.key, r.dflt]), [MIN_N.key, MIN_N.dflt]]);

/**
 * Apply the rules in order. Returns the surviving molecules and, for each rule, what it removed from what was left
 * to it. `minN` is applied last, on whole targets, because it is a question about the targets the earlier rules left.
 * @param {Array<object>} molecules every ranked molecule  @param {object} rules  @returns {{kept: object[], steps: object[]}}
 */
export function applyRules(molecules, rules = defaults()) {
  let live = molecules.slice();
  const steps = [];
  for (const rule of RULES) {
    const opt = rule.options.find(o => o.v === rules[rule.key]) || rule.options[0];
    const before = live.length;
    if (opt.keep) live = live.filter(opt.keep);
    steps.push({ key: rule.key, label: rule.label, choice: opt.label, note: opt.note, removed: before - live.length, left: live.length });
  }
  const minN = Math.max(1, Number(rules.minN) || 1);
  const count = new Map();
  for (const m of live) count.set(m.t, (count.get(m.t) || 0) + 1);
  const before = live.length;
  live = live.filter(m => count.get(m.t) >= minN);
  steps.push({ key: MIN_N.key, label: MIN_N.label, choice: minN === 1 ? 'one is enough' : `${minN} or more`,
    note: minN === 1 ? 'a target with a single molecule still gets a rank of 1 of 1' : 'targets holding fewer are dropped whole, ranks and all',
    removed: before - live.length, left: live.length });
  return { kept: live, steps };
}

/**
 * Rank within each target, widest margin first. Returns the molecules with `rank` and `nt` (how many the target
 * holds under these rules) set, in one flat list ordered by the index. The molecule's own fields are untouched.
 */
export function rerank(kept) {
  const byTarget = new Map();
  for (const m of kept) {
    if (!byTarget.has(m.t)) byTarget.set(m.t, []);
    byTarget.get(m.t).push(m);
  }
  const out = [];
  for (const list of byTarget.values()) {
    list.sort((a, b) => b.ti - a.ti);
    list.forEach((m, i) => out.push({ ...m, rank: i + 1, nt: list.length }));
  }
  return out.sort((a, b) => b.ti - a.ti);
}

/** The headline figures for a set of ranked molecules. */
export function summarise(ranked) {
  const tis = ranked.map(m => m.ti).filter(fin);
  return {
    n: ranked.length,
    targets: new Set(ranked.map(m => m.t)).size,
    median: tis.length ? median(tis) : null,
    firsts: ranked.filter(m => m.rank === 1 && m.nt > 1).length,
    onPage: ranked.reduce((a, m) => a + (m.cids?.length || 0), 0),
  };
}

/** How the rules read as one sentence, for the plot note and for anyone copying the state out. */
export function describe(rules = defaults()) {
  const parts = RULES.map(rule => {
    const opt = rule.options.find(o => o.v === rules[rule.key]) || rule.options[0];
    return opt.keep ? `${rule.label.toLowerCase()}: ${opt.label}` : null;
  }).filter(Boolean);
  const minN = Math.max(1, Number(rules.minN) || 1);
  if (minN > 1) parts.push(`at least ${minN} molecules at a target`);
  return parts.length ? parts.join('; ') : 'the batch as published, with nothing excluded';
}

// ---------------------------------------------------------------------------------------------- the page

let batch = null, loaded = null, rules = defaults(), wired = false;

/** Fetch the batch once. `fetcher` is for the tests; the page passes nothing. */
export function loadBatch(fetcher) {
  loaded ||= (fetcher ? fetcher(URL) : fetch(URL, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))))
    .then(d => { batch = d; return true; })
    .catch(() => { loaded = null; return false; });
  return loaded;
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

/** The panel's own copy. It lives here, not in index.html, because the page carries it only once this tab is opened. */
function intro() {
  const box = $('#ti-decide-intro');
  if (!box) return;
  box.innerHTML = `<p class="small">A ranking is only as strong as the rules about what is allowed into it. Set them
      here and the whole batch is put in order again in front of you: molecules that no longer qualify drop out,
      targets left holding too few are dropped whole, and the ranks inside every surviving target are worked out
      again. The drugs on the plot behind this panel follow the same rules, so a drug that stops qualifying goes
      grey.</p>
    <p class="small"><strong>What moves and what cannot.</strong> Every number per molecule is fixed: the activity,
      the hERG value and the index between them came from the run and are not recomputed in a browser. These rules
      move membership and rank, which is what an inclusion rule moves. A decision that would change a fitted number
      — the descriptor block, the split, the pruner inside the hyper-parameter search — cannot be answered by
      re-deriving, and is not offered here.</p>`;
}

/** The two tables, written once; their rows are filled on every run of the rules. */
function tables() {
  const box = $('#ti-decide-tables');
  if (!box) return;
  box.innerHTML = `<h3>What each decision removed</h3>
    <p class="small">In the order the rules are applied, so each row counts only what was still left to it. The order
      decides the attribution, never the result: the surviving set is the same whichever order the rules run in.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="What each decision removed">
      <table class="stats sources-table"><thead><tr><th scope="col">Decision</th><th scope="col">Set to</th>
        <th scope="col">Removed</th><th scope="col">Left</th></tr></thead>
      <tbody id="ti-decide-steps"></tbody></table>
    </div>
    <h3>The widest margins under these rules</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Widest margins under these rules">
      <table class="stats sources-table"><thead><tr><th scope="col">Molecule</th><th scope="col">Target</th>
        <th scope="col">Rank</th><th scope="col">Index</th></tr></thead>
      <tbody id="ti-decide-top"></tbody></table>
    </div>`;
}

function controls() {
  const box = $('#ti-decide-rules');
  if (!box) return;
  box.innerHTML = RULES.map(rule => `<div class="field">
      <label for="tid-${rule.key}">${esc(rule.label)}</label>
      <select id="tid-${rule.key}" data-rule="${rule.key}">${rule.options.map(o =>
        `<option value="${o.v}"${o.v === rules[rule.key] ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      <small class="field-hint" id="tid-${rule.key}-hint"></small>
    </div>`).join('') + `<div class="field">
      <label for="tid-minN">${esc(MIN_N.label)}</label>
      <input type="number" id="tid-minN" data-rule="minN" min="${MIN_N.min}" max="${MIN_N.max}" step="1" value="${rules.minN}">
      <small class="field-hint">A rank of 1 of 1 says nothing. Raising this drops those targets whole.</small>
    </div>`;
  box.addEventListener('change', e => {
    const key = e.target.dataset?.rule;
    if (!key) return;
    rules = { ...rules, [key]: key === 'minN' ? Math.min(MIN_N.max, Math.max(MIN_N.min, Number(e.target.value) || 1)) : e.target.value };
    if (key === 'minN') e.target.value = rules.minN;
    render();
  });
}

/** Run the rules and write the panel. Also publishes the surviving drugs to the plot. */
export function render() {
  if (!batch) return;
  const { kept, steps } = applyRules(batch.molecules, rules);
  const ranked = rerank(kept);
  const base = summarise(rerank(applyRules(batch.molecules, defaults()).kept));
  const now = summarise(ranked);

  for (const rule of RULES) {
    const opt = rule.options.find(o => o.v === rules[rule.key]) || rule.options[0];
    const hint = $(`#tid-${rule.key}-hint`);
    if (hint) hint.textContent = opt.note;
  }

  const cell = (now, was, dec = 0) => `<strong>${fx(now, dec)}</strong>${now === was ? '' : ` <small>was ${fx(was, dec)}</small>`}`;
  $('#ti-decide-out').innerHTML = `<dl class="kv decide-figs">
      <div><dt>Molecules ranked</dt><dd>${cell(now.n, base.n)} <small>of ${base.n} published, ${pct(now.n, base.n)}</small></dd></div>
      <div><dt>Targets</dt><dd>${cell(now.targets, base.targets)} <small>each with its own ranking</small></dd></div>
      <div><dt>Median index</dt><dd>${now.median === null ? '—' : cell(now.median, base.median, 2)} <small>log units</small></dd></div>
      <div><dt>Drugs on this plot</dt><dd>${cell(now.onPage, base.onPage)} <small>of ${base.onPage} that carry one</small></dd></div>
    </dl>`;

  $('#ti-decide-steps').innerHTML = steps.map(s => `<tr>
      <td data-label="Decision">${esc(s.label)}</td>
      <td data-label="Set to">${esc(s.choice)}<br><span class="small">${esc(s.note)}</span></td>
      <td data-label="Removed">${s.removed || '—'}</td>
      <td data-label="Left">${s.left}</td>
    </tr>`).join('');

  const names = batch.targets;
  $('#ti-decide-top').innerHTML = ranked.slice(0, 12).map(m => `<tr>
      <td data-label="Molecule">${esc(m.name)}${m.cids?.length ? ' <span class="small">on this plot</span>' : ''}</td>
      <td data-label="Target">${esc(names[m.t].name)}</td>
      <td data-label="Rank">${m.rank} <span class="small">of ${m.nt}</span></td>
      <td data-label="Index"><strong>${fx(m.ti, 2)}</strong></td>
    </tr>`).join('') || '<tr><td colspan="4">No molecule survives these rules.</td></tr>';

  $('#ti-decide-say').textContent = ranked.length
    ? `Under these rules: ${describe(rules)}.`
    : `No molecule survives these rules: ${describe(rules)}. Loosen one above.`;

  app.tiKeep = sameAsPublished(rules) ? null : new Set(ranked.flatMap(m => m.cids || []));
  app.tiRuleText = sameAsPublished(rules) ? null : describe(rules);
  bus.emit('recolor');
  bus.emit('ti:rules');
}

const sameAsPublished = r => RULES.every(rule => r[rule.key] === rule.dflt) && Number(r.minN) === MIN_N.dflt;

/** Called by the overlay the first time the Decisions tab is opened. */
export function initDecide() {
  const status = $('#ti-decide-status');
  if (status) status.textContent = 'Loading the whole ranked batch…';
  return loadBatch().then(ok => {
    intro();
    if (!ok) {
      if (status) status.textContent = 'The ranked batch did not load, so the decisions cannot be re-derived. Close the panel and try again.';
      return false;
    }
    if (status) status.hidden = true;
    const body = $('#ti-decide-body');
    if (body) body.hidden = false;
    if (!wired) {
      wired = true;
      intro();
      tables();
      controls();
      $('#ti-decide-reset')?.addEventListener('click', () => { rules = defaults(); controls(); render(); });
    }
    render();
    return true;
  });
}
