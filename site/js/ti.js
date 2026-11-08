// The ranked therapeutic-index overlay: a lazy dialog on the existing explorer that shows the batch in order,
// where every number came from, the Hansch series models that survived their gates, and the five OECD principles
// with this run's own figures. Data: site/data/ti/summary.json, written by ti/rank.py.
import { $, esc, getSide } from './kernel.js';

const SUMMARY_URL = 'data/ti/summary.json';
const TABS = ['rank', 'route', 'series', 'decide', 'expose', 'search', 'oecd'];
const DECIDE_MOD = 'ti-decide.js';   // variable specifiers: the workbench, its whole-batch file and the exposure
const EXPOSE_MOD = 'ti-exposure.js'; // arithmetic all arrive on first use, never on the way to anything else
const SEARCH_MOD = 'ti-search.js';   // and so does the recorded model search, which is the largest file of the three
const SOURCES = {
  measured: 'ChEMBL-derived binding aggregate (median of retained records); no prediction on this side',
  series_hansch: 'a readable Hansch equation on this molecule’s own congeneric series, past every gate',
  fallback_nonlinear: 'the declared fallback for this target: same properties, no equation to read',
  unavailable: 'no measurement and no model that validates, so the cell was left empty',
};
let data = null, wired = false, bodyReady = null;

// Keep the complete archived instrument off the first-paint path. The static fragment contains no scripts.
function loadBody() {
  if (!$('#ti-rank-style')) {
    const link = document.createElement('link');
    link.id = 'ti-rank-style'; link.rel = 'stylesheet';
    link.href = new URL('../css/ti-rank.css', import.meta.url).href;
    document.head.append(link);
  }
  bodyReady ||= fetch('fragments/ti-body.html').then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }).then(html => { $('#ti-dialog').insertAdjacentHTML('beforeend', html); wire(); })
    .catch(err => { bodyReady = null; throw err; });
  return bodyReady;
}

const num = (v, d = 2) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v))
  ? '—' : Number(v).toFixed(d));

function showTab(name) {
  for (const t of TABS) {
    const tab = $(`#ti-t-${t}`), panel = $(`#ti-p-${t}`);
    if (!tab || !panel) continue;
    const on = t === name;
    tab.setAttribute('aria-selected', String(on));
    panel.hidden = !on;
  }
}

function wire() {
  if (wired) return;
  wired = true;
  for (const t of TABS) $(`#ti-t-${t}`)?.addEventListener('click', () => showTab(t));
  $('#ti-filter')?.addEventListener('change', fillRanked);
  // The Decisions tab needs the whole ranked batch, not the top of it, so it is a second file and a second module,
  // both fetched the first time the tab is opened and never on the way to anything else.
  $('#ti-t-decide')?.addEventListener('click', () => import(`./${DECIDE_MOD}`).then(m => m.initDecide()).catch(() => {
    const status = $('#ti-decide-status');
    if (status) { status.hidden = false; status.textContent = 'The decision workbench could not load. Close the panel and try again.'; }
  }), { once: true });
  $('#ti-t-expose')?.addEventListener('click', () => import(`./${EXPOSE_MOD}`).then(m => m.initExposure()).catch(() => {
    const status = $('#ti-exp-status');
    if (status) { status.hidden = false; status.textContent = 'The exposure panel could not load. Close it and try again.'; }
  }), { once: true });
  $('#ti-t-search')?.addEventListener('click', () => import(`./${SEARCH_MOD}`).then(m => m.initSearch()).catch(() => {
    const status = $('#ti-search-status');
    if (status) { status.hidden = false; status.textContent = 'The recorded model search could not load. Close it and try again.'; }
  }), { once: true });
}

/** The ranked table, filtered. Provenance travels with every row; it is never dropped to make the table tidy. */
function fillRanked() {
  const mode = $('#ti-filter')?.value || 'all';
  const rows = data.ranked.filter(r => {
    if (mode === 'inside') return r.applicability_domain !== 'outside';
    if (mode === 'measured') return r.p_activity_source === 'measured' && r.p_toxicity_source === 'measured';
    if (mode === 'series') return r.p_activity_source === 'series_hansch' || r.p_toxicity_source === 'series_hansch';
    return true;
  });
  const tag = s => (s === 'measured' ? 'measured aggregate' : s === 'series_hansch' ? 'Hansch series' : 'fallback');
  $('#ti-rows').innerHTML = rows.slice(0, 200).map(r => `<tr>
    <th scope="row" data-label="Molecule">${esc(r.name)} <span class="ti-rank-target-key">${esc(r.target_chembl_id)} · ${r.target_source === 'chembl_mechanism' ? 'recorded' : r.routing_decision === 'ambiguous' ? 'ambiguous' : 'inferred'}</span></th>
    <td data-label="Rank in target">${r.rank_in_target} <span class="small">of ${r.n_in_target}</span></td>
    <td data-label="Target">${esc(r.target_name || r.target_chembl_id)}
        <span class="small">${esc(r.target_source === 'chembl_mechanism' ? 'recorded' : 'inferred from structure' + (r.routing_decision === 'ambiguous' ? ', ambiguous' : ''))}</span></td>
    <td data-label="Activity">${num(r.p_activity)} <span class="small">${esc(tag(r.p_activity_source))}</span></td>
    <td data-label="hERG">${num(r.p_toxicity_herg)} <span class="small">${esc(tag(r.p_toxicity_source))}</span></td>
    <td data-label="Index"><strong>${num(r.therapeutic_index)}</strong></td>
    <td data-label="Domain">${esc(r.applicability_domain)}</td>
  </tr>`).join('') || '<tr><td colspan="7">No molecule matches that filter.</td></tr>';
  const shown = Math.min(rows.length, 200);
  $('#ti-count').textContent = rows.length > shown
    ? `${shown} of ${rows.length} shown; the full set is in therapeutic_index.csv.`
    : `${rows.length} molecule${rows.length === 1 ? '' : 's'}.`;
}

function fillRouting() {
  $('#ti-route-rule').textContent = data.routing_rule;
  const tally = {};
  for (const r of data.ranked) {
    tally[r.p_activity_source] = (tally[r.p_activity_source] || 0) + 1;
    tally[r.p_toxicity_source] = (tally[r.p_toxicity_source] || 0) + 1;
  }
  $('#ti-sources').innerHTML = Object.entries(SOURCES).map(([key, meaning]) => `<tr>
    <td data-label="Source"><code>${esc(key)}</code></td>
    <td data-label="What it means">${esc(meaning)}</td>
    <td data-label="Molecules">${tally[key] || 0}</td></tr>`).join('');

  $('#ti-excluded').innerHTML = Object.entries(data.not_ranked)
    .map(([why, n]) => `<tr><td data-label="Reason">${esc(why)}</td><td data-label="Molecules">${n}</td></tr>`)
    .join('') || '<tr><td colspan="2">Every molecule was ranked.</td></tr>';

  const models = Object.entries(data.models).sort((a, b) => b[1].rows - a[1].rows);
  $('#ti-models').innerHTML = models.map(([id, m]) => `<tr>
    <td data-label="Target"><code>${esc(id)}</code></td>
    <td data-label="Compounds">${m.rows}</td>
    <td data-label="Assay">${esc(m.standard_type || '—')}</td>
    <td data-label="Series validated">${m.series_validated} of ${m.series_tried}</td>
    <td data-label="Fallback q²">${num(m.fallback_q2_scaffold_grouped)}${m.fallback_usable ? '' : ' <span class="small">below the bar, not used</span>'}</td>
    <td data-label="Shuffled q²">${num(m.fallback_shuffled_q2)}</td></tr>`).join('');
}

function fillSeries() {
  const s = data.validated_series;
  const acc = data.acceptance.series_hansch;
  $('#ti-series-note').textContent = s.length
    ? `${s.length} series cleared every gate: at least ${acc.min_n} compounds, median similarity `
      + `${acc.min_median_tanimoto} or above, r² ≥ ${acc.min_r2}, q² ≥ ${acc.min_q2_loo} leaving each one out, `
      + `and a shuffled-label q² below ${acc.max_scramble_q2}. At most one term per five compounds, chosen on `
      + `corrected Akaike information so that q² never takes part in choosing the terms it then scores.`
    : 'No series cleared every gate in this run.';
  $('#ti-series').innerHTML = s.map(m => `<tr>
    <td data-label="Target"><code>${esc(m.target_id)}</code></td>
    <td data-label="n">${m.n}</td>
    <td data-label="Similarity">${num(m.median_tanimoto)}</td>
    <td data-label="Terms"><code>${esc(m.terms.join(' + '))}</code></td>
    <td data-label="r²">${num(m.r2)}</td>
    <td data-label="q² (leave one out)"><strong>${num(m.q2_loo)}</strong></td>
    <td data-label="log P optimum">${m.optimum === null ? 'none in range' : num(m.optimum)}</td>
  </tr>`).join('') || '<tr><td colspan="7">None in this run.</td></tr>';
}

function fillOecd() {
  const c = data.counts, m = Object.values(data.models);
  const q2s = m.filter(x => x.fallback_usable).map(x => x.fallback_q2_scaffold_grouped).sort((a, b) => a - b);
  const worstShuffled = Math.max(...m.map(x => x.fallback_shuffled_q2));
  const seriesOk = m.reduce((a, x) => a + x.series_validated, 0);
  const seriesTried = m.reduce((a, x) => a + x.series_tried, 0);
  const principles = [
    ['1 · A defined endpoint',
      `<code>${esc(data.endpoint.definition)}</code> — ${esc(data.endpoint.direction)}. It is
       ${esc(data.endpoint.is_not)}.
       Values are measured aggregates or model predictions on the pChEMBL scale (−log₁₀ mol/L).
       Training records use one endpoint type per target; target Ki and hERG IC50 may still differ.
       Retained repeats are aggregated by median; spreads above one log unit are excluded.
       The difference is an exploratory potency contrast, not evidence of clinical safety.`],
    ['2 · An unambiguous algorithm',
      `The inputs are fixed by checksum, the versions are recorded (${Object.entries(data.software)
        .map(([k, v]) => `${k} ${v}`).join(', ')}), and the same ${data.descriptors.length} properties are
       calculated the same way for every molecule. Measured pharmacokinetic values travel through the file and
       are never model inputs.`],
    ['3 · A defined domain of applicability',
      `Predictions outside the recorded domain remain in this frozen batch and are explicitly flagged.
       Decisions lets you exclude them. Measured aggregates need no prediction domain, but still have assay and source limitations.`],
    ['4 · Fit, robustness and predictivity',
      `Series use leave-one-out q²; fallback models use scaffold-grouped q². These are different tests,
       not external prospective validation. ${seriesOk} of ${seriesTried} series passed the recorded gates.
       ${q2s.length} targets produced a usable fallback${q2s.length ? `, grouped q² ${num(q2s[0])}–${num(q2s[q2s.length - 1])}` : ''}.
       Maximum recorded fallback shuffled q²: ${num(worstShuffled)}. Passing these gates does not validate clinical use.`],
    ['5 · A mechanistic interpretation, where there is one',
      `Series equations expose fitted descriptor relationships. A negative squared log P coefficient can
       locate a fitted maximum within the studied range; it does not demonstrate membrane transport or mechanism.
       The nonlinear fallback has no comparable simple equation. Both remain empirical models.`],
  ];
  $('#ti-oecd').innerHTML = principles
    .map(([h, body]) => `<h3>${h}</h3><p class="small">${body}</p>`).join('');
}

export async function openIndex() {
  const dialog = $('#ti-dialog');
  if (!dialog.open) dialog.showModal();
  if (data) return;
  try {
    await loadBody();
    data = await getSide(SUMMARY_URL);
    const c = data.counts;
    $('#ti-lede').textContent = `${c['molecules in']} molecules in, ${c.ranked} ranked. `
      + `Rows distinguish measured aggregates from predictions. The ranked preview contains ${data.ranked.length} rows; the full frozen batch is available in Decisions and CSV. `
      + `Archived summary source counts do not reconcile with the full batch; use row-level source labels.`;
    $('#ti-status').hidden = true;
    $('#ti-body').hidden = false;
    fillRanked();
    fillRouting();
    fillSeries();
    fillOecd();
    showTab('rank');
  } catch (err) {
    data = null;
    $('#ti-status').hidden = false;
    $('#ti-status').textContent = `The ranked batch could not load (${err.message}). Close and try again.`;
  }
}
