// The Model search tab: the one place on this page where a decision inside the fitting itself can be changed and
// the answer watched for it.
//
// Everywhere else the overlay shows a finished run. Here the search that chose each target's model is opened up.
// tools/build_ti_search.py ran the real thing offline -- ten candidates per target, two descriptor blocks against
// five penalties, scored fold by fold on that target's own training rows -- and recorded every intermediate score
// in data/ti/search.json. A pruner is only a rule over those scores, so the rule runs here, in the browser, and
// its own parameters are knobs: how many candidates finish before median pruning starts biting, how many folds it
// waits, how hard halving cuts. Nothing is refitted in a browser, and nothing has to be: the fits are recorded and
// the rule is arithmetic.
//
// Two honesty checks are built in. The replay is run at the recorded defaults and compared with the policy the
// Python run wrote down; a mismatch is printed rather than hidden. And the pipeline's own gate is carried per
// target, because at a target where no candidate clears it the pruner changes the bill and nothing else.
import { $, esc, fin, fx } from './kernel.js';

const URL = 'data/ti/search.json';
const SCHEMES = { random: 'Random folds', scaffold: 'Scaffold folds' };
const POLICIES = { full: 'No pruning', median: 'Median pruning', halving: 'Successive halving' };

let data = null, wired = false;
let state = { scheme: 'scaffold', policy: 'median', startup: 2, warmup: 1, min: 1, factor: 3, target: null };

/** A missing fold score loses; it is never read as zero. The floor is the file's own. */
const sc = v => (v === null || v === undefined ? (data?.meta?.curve_scale?.floor ?? -100) - 1 : v);
const r2 = v => (v === null || v === undefined ? null : v / (data?.meta?.curve_scale?.divide_by || 100));
const median = xs => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The result shape every policy returns: which candidate it selected, how many folds each candidate was given,
 * and the totals read off that. The per-candidate spend is what the table greys out, so it is the same array the
 * fold count is summed from and the two can never tell different stories.
 */
function done(curves, pick, paid) {
  return {
    pick,
    paid,
    folds: paid.reduce((a, b) => a + b, 0),
    pruned: paid.filter((n, i) => n < curves[i].length).length,
  };
}

/** Fold counts at which halving stops to compare: the last is always the full budget. */
export function rungs(k, min, factor) {
  const out = [];
  for (let r = Math.max(1, min); r < k; r *= Math.max(2, factor)) out.push(r);
  return [...out, k];
}

/** Every candidate, every fold. What the pipeline does today, and the baseline every other policy is read against. */
export function replayFull(curves) {
  let pick = 0;
  curves.forEach((row, i) => { if (sc(row[row.length - 1]) > sc(curves[pick][curves[pick].length - 1])) pick = i; });
  return done(curves, pick, curves.map(row => row.length));
}

/**
 * Median pruning. A candidate is stopped when its running score falls below the median of the candidates that
 * have already finished at the same fold. Only finished candidates vote, and a stopped candidate reports no final
 * score, so it can never be selected however good its first fold looked.
 */
export function replayMedian(curves, k, { startup = 2, warmup = 1 } = {}) {
  const finished = [], paid = curves.map(() => 0);
  for (let i = 0; i < curves.length; i += 1) {
    const row = curves[i];
    for (let t = 0; t < k; t += 1) {
      paid[i] = t + 1;
      if (t + 1 === k) { finished.push([i, row]); break; }
      if (finished.length < startup || t < warmup) continue;
      const others = finished.map(([, c]) => sc(c[t]));
      if (others.length && sc(row[t]) < median(others)) break;
    }
  }
  const best = finished.reduce((a, b) => (sc(b[1][b[1].length - 1]) > sc(a[1][a[1].length - 1]) ? b : a), finished[0]);
  return done(curves, best ? best[0] : 0, paid);
}

/** Successive halving. One rung's folds for everyone, keep the best share, spend the next rung on those. */
export function replayHalving(curves, k, { min = 1, factor = 3 } = {}) {
  const ladder = rungs(k, min, factor), paid = curves.map(() => 0);
  let alive = curves.map((_, i) => i);
  for (const rung of ladder) {
    for (const i of alive) paid[i] = rung;
    if (rung === ladder[ladder.length - 1]) break;
    const keep = Math.max(1, Math.floor(alive.length / Math.max(2, factor)));
    alive = [...alive].sort((a, b) => sc(curves[b][rung - 1]) - sc(curves[a][rung - 1])).slice(0, keep);
  }
  const pick = alive.reduce((a, b) => (sc(curves[b][curves[b].length - 1]) > sc(curves[a][curves[a].length - 1]) ? b : a), alive[0]);
  return done(curves, pick, paid);
}

/** One policy over one target, by name, with the current knobs. */
export function replay(policy, curves, k, knobs = state) {
  if (policy === 'median') return replayMedian(curves, k, knobs);
  if (policy === 'halving') return replayHalving(curves, k, { min: knobs.min, factor: knobs.factor });
  return replayFull(curves);
}

/** Does the replay reproduce what the Python run recorded, at the parameters it used? */
export function selfCheck(blob) {
  const bad = [];
  for (const [id, t] of Object.entries(blob.targets)) {
    for (const [scheme, s] of Object.entries(t.schemes)) {
      for (const name of Object.keys(POLICIES)) {
        const mine = replay(name, s.curves, s.folds,
          { startup: blob.meta.median_pruner.n_startup_trials, warmup: blob.meta.median_pruner.n_warmup_steps,
            min: blob.meta.halving_pruner.min_resource, factor: blob.meta.halving_pruner.reduction_factor });
        const theirs = s.policies[name];
        if (mine.pick !== theirs.pick || mine.folds !== theirs.folds) bad.push(`${id}/${scheme}/${name}`);
      }
    }
  }
  return bad;
}

/** Across every target: how often this policy lands on the exhaustive search's candidate, and what it cost. */
export function summarise(blob, scheme, policy, knobs) {
  let n = 0, same = 0, folds = 0, full = 0, usable = 0, usableSame = 0, moved = [];
  for (const [id, t] of Object.entries(blob.targets)) {
    const s = t.schemes[scheme];
    if (!s) continue;
    const base = replayFull(s.curves), mine = replay(policy, s.curves, s.folds, knobs);
    n += 1; folds += mine.folds; full += base.folds;
    const agrees = mine.pick === base.pick;
    if (agrees) same += 1;
    if (s.winner_passes_gate) { usable += 1; if (agrees) usableSame += 1; else moved.push(id); }
  }
  return { n, same, folds, full, usable, usableSame, moved, share: full ? folds / full : 1 };
}

function intro() {
  const box = $('#ti-search-intro');
  if (!box) return;
  box.innerHTML = `<p class="small">Every other tab shows a finished run. This one shows the search that chose the
      models: for each target, two descriptor blocks against five penalties, each scored fold by fold on that
      target's own measurements. The fits were run offline and recorded, so the rule that decides when to give up
      on a candidate can be changed here and the consequence read off, which is the question a pruner actually
      poses: does it change the answer, or only the bill?</p>
    <p class="small"><strong>The fold scheme is the louder decision.</strong> Random folds let one chemical series
      sit on both sides of the split, so the model is asked to interpolate inside a family it has already seen.
      Scaffold folds hold a whole series out. Switch between them below and watch how many targets keep a model
      that clears the pipeline's own gate at all.</p>`;
}

function controls() {
  const box = $('#ti-search-controls');
  if (!box) return;
  const list = Object.entries(data.targets)
    .map(([id, t]) => [id, data.meta.names[id] || id, !!t.schemes[state.scheme]?.winner_passes_gate])
    .sort((a, b) => a[1].localeCompare(b[1]));
  const opt = (o, v) => Object.entries(o).map(([k, label]) =>
    `<option value="${k}"${k === v ? ' selected' : ''}>${esc(label)}</option>`).join('');
  box.innerHTML = `<div class="field"><label for="tis-scheme">Folds</label>
      <select id="tis-scheme">${opt(SCHEMES, state.scheme)}</select>
      <small class="field-hint">How the held-out set is drawn. Scaffold folds ask the harder question.</small></div>
    <div class="field"><label for="tis-policy">When to give up on a candidate</label>
      <select id="tis-policy">${opt(POLICIES, state.policy)}</select>
      <small class="field-hint">The rule replayed over the recorded scores.</small></div>
    ${state.policy === 'median' ? `<div class="field"><label for="tis-startup">Candidates that must finish first</label>
      <input type="number" id="tis-startup" min="0" max="9" step="1" value="${state.startup}">
      <small class="field-hint">Nothing is pruned until this many have a full score to be compared against.</small></div>
    <div class="field"><label for="tis-warmup">Folds before pruning may start</label>
      <input type="number" id="tis-warmup" min="0" max="4" step="1" value="${state.warmup}">
      <small class="field-hint">A candidate judged on one fold is judged on one twentieth of the data.</small></div>`
    : state.policy === 'halving' ? `<div class="field"><label for="tis-min">Folds in the first rung</label>
      <input type="number" id="tis-min" min="1" max="4" step="1" value="${state.min}">
      <small class="field-hint">What every candidate is given before the first cut.</small></div>
    <div class="field"><label for="tis-factor">Cut by a factor of</label>
      <input type="number" id="tis-factor" min="2" max="10" step="1" value="${state.factor}">
      <small class="field-hint">Three keeps the top third at each rung, so two cuts leave one candidate.</small></div>` : ''}
    <div class="field"><label for="tis-target">Target to open up</label>
      <select id="tis-target">${list.map(([id, name, ok]) =>
        `<option value="${id}"${id === state.target ? ' selected' : ''}>${esc(name)}${
          ok ? ' — past the gate' : ''}</option>`).join('')}</select>
      <small class="field-hint">${list.length} targets carry enough measurements to fit at all;
        ${list.filter(t => t[2]).length} of them end up with a model good enough to use.</small></div>`;
}

/** The headline: what this rule does to the whole set of targets, not to one. */
function headline() {
  const s = summarise(data, state.scheme, state.policy, state);
  const base = summarise(data, state.scheme, 'full', state);
  const names = s.moved.slice(0, 3).map(id => esc(data.meta.names[id] || id)).join(', ');
  return `<dl class="kv decide-figs">
      <div><dt>Same candidate as the full search</dt>
        <dd><strong>${s.same}</strong> <small>of ${s.n} targets</small></dd></div>
      <div><dt>Folds paid for</dt>
        <dd><strong>${Math.round(100 * s.share)}%</strong> <small>${s.folds} of ${s.full}</small></dd></div>
      <div><dt>Targets with a model past the gate</dt>
        <dd><strong>${base.usable}</strong> <small>held-out R² at or above ${fx(data.meta.gate.min_q2, 2)}</small></dd></div>
      <div><dt>Of those, same candidate</dt>
        <dd><strong>${s.usableSame}</strong> <small>of ${base.usable}${s.moved.length ? `; moved at ${names}` : ''}</small></dd></div>
    </dl>
    <p class="small">${state.policy === 'full'
      ? 'This is the search as the pipeline runs it: every candidate gets every fold, so there is nothing to disagree with.'
      : `The first two figures are the whole trade. The second pair is the one that matters: at the ${base.usable}
         targets where some candidate is good enough to be used, a pruner that lands somewhere else has changed a
         model that gets shipped. Everywhere else every candidate fails the gate, so the pruner is only saving
         money on a search with no winner.`}</p>`;
}

/** One target, candidate by candidate, with the folds this rule actually paid for. */
function table(id) {
  const t = data.targets[id], s = t?.schemes?.[state.scheme];
  if (!s) return '';
  const base = replayFull(s.curves), mine = replay(state.policy, s.curves, s.folds, state);
  const rows = data.meta.trials.map((trial, i) => {
    const curve = s.curves[i], paid = mine.paid[i], last = r2(curve[curve.length - 1]);
    const cells = curve.map((v, t2) => {
      const shown = t2 < paid;
      return `<td data-label="Fold ${t2 + 1}"${shown ? '' : ' class="tis-skip"'}>${
        shown ? fx(r2(v), 2) : '<span class="small">not run</span>'}</td>`;
    }).join('');
    const mark = i === mine.pick ? '<strong>chosen</strong>' : i === base.pick
      ? '<span class="small">the full search picks this</span>' : '';
    return `<tr>
      <td data-label="Candidate">${esc(label(trial))}</td>
      ${cells}
      <td data-label="Final">${paid >= curve.length ? fx(last, 2) : '<span class="small">never finished</span>'}</td>
      <td data-label="Outcome">${mark}</td>
    </tr>`;
  }).join('');
  const heads = s.curves[0].map((_, i) => `<th scope="col">Fold ${i + 1}</th>`).join('');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Candidates for this target">
      <table class="stats sources-table"><thead><tr><th scope="col">Candidate</th>${heads}
        <th scope="col">Final</th><th scope="col">Outcome</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small">${esc(data.meta.names[id] || id)} holds ${t.n} measured molecules over ${t.scaffolds}
      scaffolds. Scores are held-out R² pooled over the folds run so far, so the last column is the number the
      candidate is judged on and the earlier ones are the same number on less data. This rule paid for
      ${mine.folds} of the ${base.folds} fold fits${mine.pruned ? ` and dropped ${mine.pruned} candidates` : ''}${
      mine.pick === base.pick ? ', and landed on the same candidate.'
        : `, and landed on a different candidate: ${esc(label(data.meta.trials[mine.pick]))} rather than
           ${esc(label(data.meta.trials[base.pick]))}.`}</p>`;
}

const label = trial => `${trial.block === 'hansch' ? 'Hansch block' : 'Wide block'}, ${
  trial.kind === 'ols' ? 'no penalty' : `ridge α ${trial.alpha}`}`;

export function render() {
  const out = $('#ti-search-out');
  if (!out || !data) return;
  controls();
  out.innerHTML = headline() + table(state.target) + `<p class="small">The Hansch block is
    ${data.meta.blocks.hansch.descriptors} descriptors and the wide one ${data.meta.blocks.wide.descriptors}.
    logP and its square are one descriptor in two columns, so they enter and leave together and are counted
    once, here and in every variable count on this page. The folds,
    the seed and the candidate order are fixed by the recorded run, because a pruner's behaviour depends on the
    order it meets the candidates in. Optuna's own pruners carry more parameters than the two here; these are the
    rules themselves, replayed on recorded scores, not a wrapper around that library.</p>`;
}

export async function loadSearch(fetcher = (u => fetch(u).then(r => (r.ok ? r.json() : Promise.reject(r.status))))) {
  const status = $('#ti-search-status');
  try {
    data = await fetcher(URL);
  } catch {
    if (status) { status.hidden = false; status.textContent = 'The recorded model search could not load. Close the panel and try again.'; }
    return false;
  }
  const bad = selfCheck(data);
  const withModel = Object.keys(data.targets)
    .filter(id => data.targets[id].schemes[state.scheme]?.winner_passes_gate);
  state.target = state.target || withModel[0] || Object.keys(data.targets)[0];
  if (status) {
    status.hidden = bad.length === 0;
    if (bad.length) status.textContent = `This page's replay disagrees with the recorded run at ${bad.length} of `
      + `${Object.keys(data.targets).length * 2 * 3} policy runs (${bad.slice(0, 2).join(', ')}). Read the numbers below with that in mind.`;
  }
  const body = $('#ti-search-body');
  if (body) body.hidden = false;
  render();
  return true;
}

function read(id, key, lo, hi) {
  const el = $(id);
  if (!el) return;
  const v = Math.round(Number(el.value));
  if (fin(v) && v >= lo && v <= hi) state[key] = v;
  el.value = state[key];
}

export function initSearch() {
  intro();
  if (!wired) {
    wired = true;
    $('#ti-search-controls')?.addEventListener('change', e => {
      const id = e.target?.id;
      if (id === 'tis-scheme') state.scheme = e.target.value;
      if (id === 'tis-policy') state.policy = e.target.value;
      if (id === 'tis-target') state.target = e.target.value;
      read('#tis-startup', 'startup', 0, 9);
      read('#tis-warmup', 'warmup', 0, 4);
      read('#tis-min', 'min', 1, 4);
      read('#tis-factor', 'factor', 2, 10);
      render();
    });
  }
  if (data) { render(); return true; }
  return loadSearch();
}
