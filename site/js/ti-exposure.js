// The Exposure tab of the therapeutic-index overlay: the one place on this page where a dose turns into a
// concentration, and the margin stops being a ratio of two dish measurements and becomes a statement about a person.
//
// The index everywhere else is activity minus hERG, both in-vitro, and it is not dose-aware. Here the reader supplies
// a dose, an interval and a bioavailability for each route the drug is actually labelled for; the drug's own measured
// human clearance and fraction unbound do the rest, and the free plasma concentration at steady state is put next to
// the hERG potency. Where that free concentration comes from is marked on every row: clearance and fu are measured
// and come from the dataset, the dose and the interval are the reader's, and F is the reader's too unless the route
// sets it by definition.
//
// The arithmetic is in js/exposure.js, which has no DOM and is tested on its own.
import { app, $, cap, esc, fin, fx } from './kernel.js';
import { exposure, isFu, routeF, routeFWhy, shift } from './exposure.js';

const DEFAULTS = { dose: 100, tau: 24, weight: 70 };
let state = { ...DEFAULTS, cid: null, f: {} }, wired = false;

/** The drugs this tab can say anything about: an index, a measured clearance and a measured free fraction. */
const usable = () => app.drugs.filter(d => d.ti && fin(d.ti.pk?.cl) && isFu(d.ti.pk?.fu) && fin(d.d?.mw));

const pick = () => usable().find(d => d.cid === state.cid) || null;

/** The routes the drug is labelled for, from its own ATC entries, in the FDA legend's own words. */
function routesOf(d) {
  const seen = [];
  for (const e of d.atc || []) for (const r of e.routes || []) if (!seen.includes(r)) seen.push(r);
  return seen;
}

function intro() {
  const box = $('#ti-exp-intro');
  if (!box) return;
  box.innerHTML = `<p class="small">Explore an average steady-state exposure scenario, not a safe-dose recommendation.
      Css,total = F × dose / (CL × interval); Css,unbound = fu × Css,total. Clearance is converted from
      mL/min/kg to L/h using the entered body weight; molecular weight converts mg/L to mol/L.</p>
    <p class="small">This assumes linear, time-invariant systemic clearance, constant plasma binding and steady state.
      Stored human PK values are experimental inputs, not individual patient measurements. Dose, interval and
      non-intravascular F are your assumptions (F initially 100%). The estimate is an interval average, not Cmax,
      cardiac-site concentration or a clinical safety assessment.</p>`;
}

function controls() {
  const box = $('#ti-exp-controls');
  if (!box) return;
  const list = usable().sort((a, b) => a.name.localeCompare(b.name));
  box.innerHTML = `<div class="field"><label for="tix-drug">Drug</label>
      <select id="tix-drug">${list.map(d =>
        `<option value="${d.cid}"${d.cid === state.cid ? ' selected' : ''}>${esc(cap(d.name))}</option>`).join('')}</select>
      <small class="field-hint">${list.length} of the ${app.drugs.filter(d => d.ti).length} drugs with an index also
        carry a measured clearance and free fraction.</small></div>
    <div class="field"><label for="tix-dose">Dose (mg)</label>
      <input type="number" id="tix-dose" min="0.01" step="any" value="${state.dose}">
      <small class="field-hint">One administration. Yours to set; nothing here knows the label.</small></div>
    <div class="field"><label for="tix-tau">Interval (hours)</label>
      <input type="number" id="tix-tau" min="0.1" step="any" value="${state.tau}">
      <small class="field-hint">24 is once a day, 12 twice, 8 three times.</small></div>
    <div class="field"><label for="tix-weight">Body weight (kg)</label>
      <input type="number" id="tix-weight" min="1" step="any" value="${state.weight}">
      <small class="field-hint">Clearance is per kilogram, so this scales it.</small></div>`;
}

/** One row per route the drug is labelled for, each with its own F. */
function table(d) {
  const t = d.ti, pk = t.pk, routes = routesOf(d);
  if (!routes.length) return '<p class="small">This drug carries no route in its ATC entries, so there is nothing to put a bioavailability on.</p>';
  const rows = routes.map(route => {
    const known = routeF(route);
    const f = known ?? (state.f[route] ?? 1);
    const e = exposure({ dose: state.dose, tau: state.tau, f, cl: pk.cl, fu: pk.fu, mw: d.d.mw,
      weight: state.weight, herg: t.herg, act: t.act });
    const fCell = known !== null
      ? `<strong>100%</strong> <span class="small">${esc(routeFWhy(route))}</span>`
      : `<input type="number" class="tix-f" data-route="${esc(route)}" min="1" max="100" step="1" value="${Math.round(f * 100)}" aria-label="Bioavailability for ${esc(cap(route))}, per cent">`
        + ` <span class="small">%, ${esc(routeFWhy(route))}</span>`;
    return `<tr>
      <td data-label="Route">${esc(cap(route))}</td>
      <td data-label="Bioavailability">${fCell}</td>
      <td data-label="Free concentration">${e ? `${fx(e.pFree, 2)} <span class="small">p-scale</span><br><span class="small">${esc(conc(e.free))} free of ${esc(conc(e.cssMolar))} total</span>` : '—'}</td>
      <td data-label="Margin over hERG">${e && e.margin !== null
        ? `<strong>${fx(e.margin, 2)}</strong><br><span class="small">${fold(e.fold)}</span>`
        : '—'}</td>
      <td data-label="Against the activity">${e && e.coverage !== null ? fx(e.coverage, 2) : '—'}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Exposure by route">
    <table class="stats sources-table"><thead><tr><th scope="col">Route</th><th scope="col">Bioavailability</th>
      <th scope="col">Estimated average unbound plasma</th><th scope="col">Margin over hERG</th>
      <th scope="col">Against the activity</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** A free fraction can be 0.0002; two decimals would print that as nothing at all. */
const frac = v => (fin(v) ? (v >= 0.01 ? v.toFixed(3) : v.toPrecision(2)) : '—');

const conc = c => {
  if (!fin(c) || c <= 0) return '—';
  const [v, u] = c >= 1e-3 ? [c * 1e3, 'mM'] : c >= 1e-6 ? [c * 1e6, 'µM'] : [c * 1e9, 'nM'];
  return `${v.toPrecision(3)} ${u}`;
};
const fold = f => (fin(f) ? `${f >= 1 ? `${f.toPrecision(3)}-fold below the hERG number` : `${(1 / f).toPrecision(3)}-fold above it`}` : '—');

const pctOf = v => (fin(v) ? `${(v * 100) >= 1 ? (v * 100).toFixed(1) : (v * 100).toPrecision(2)}%` : '—');

export function render() {
  const d = pick();
  const out = $('#ti-exp-out');
  if (!out) return;
  if (!d) { out.innerHTML = '<p class="small">Pick a drug above.</p>'; return; }
  const t = d.ti, pk = t.pk;
  out.innerHTML = `<dl class="kv decide-figs">
      <div><dt>Clearance</dt><dd><strong>${fx(pk.cl, 2)}</strong> <small>mL/min/kg, stored experimental input</small></dd></div>
      <div><dt>Free fraction</dt><dd><strong>${frac(pk.fu)}</strong> <small>stored experimental input, ${esc(pctOf(pk.fu))} unbound</small></dd></div>
      <div><dt>hERG</dt><dd><strong>${fx(t.herg, 2)}</strong> <small>pChEMBL, ${esc(t.hsrc === 'measured' ? 'measured aggregate' : 'predicted')}</small></dd></div>
      <div><dt>Activity</dt><dd><strong>${fx(t.act, 2)}</strong> <small>p-scale, ${esc(t.asrc === 'measured' ? 'measured aggregate' : 'predicted')} at ${esc(t.tname)}</small></dd></div>
    </dl>`
    + (t.tid === (app.tiMeta?.liability_target || 'CHEMBL240')
      ? `<p class="small"><strong>This drug's own target is the hERG channel.</strong> Its activity and its liability
         refer to the same endpoint, so the index is zero by construction and the two right-hand columns below carry
         the same number. The exposure is still worth reading; the margin is not.</p>`
      : '')
    + table(d)
    + `<p class="small">Both right-hand columns are log units against the same free concentration: the margin is how
       far it sits below the hERG number, and the last column how far it sits below the recorded target potency (aggregate or prediction) — positive there is ordinary, and is a statement about an assay rather
       than about whether the drug works.</p>`
    + `<p class="small">The hERG gap is −log10(Css,unbound) − p(hERG), or log10(hERG potency concentration / Css,unbound).
       A gap of ${fx(shift(30), 2)} means thirtyfold under these assumptions, not a safety threshold.
       Halving dose or F adds ${fx(shift(2), 2)}; halving clearance subtracts it. Target and hERG values may be
       predictions or measured aggregates with different assay endpoints. Plasma unbound concentration and
       nominal assay concentration are not automatically comparable.</p>`;
}

function readNumber(id, key, min) {
  const el = $(id);
  if (!el) return;
  const v = Number(el.value);
  if (fin(v) && v >= min) state[key] = v;
  el.value = state[key];
}

export function initExposure() {
  intro();
  const status = $('#ti-exp-status');
  if (!app.tiReady) {
    if (status) { status.hidden = false; status.textContent = 'The index file has not landed yet. Close this and open it again in a moment.'; }
    return false;
  }
  const list = usable();
  if (!list.length) {
    if (status) { status.hidden = false; status.textContent = 'No drug on this page carries both an index and the measured pharmacokinetics this needs.'; }
    return false;
  }
  if (state.cid === null) state.cid = (app.selected >= 0 && list.includes(app.drugs[app.selected]) ? app.drugs[app.selected] : list[0]).cid;
  if (status) status.hidden = true;
  const body = $('#ti-exp-body');
  if (body) body.hidden = false;
  if (!wired) {
    wired = true;
    controls();
    $('#ti-exp-controls')?.addEventListener('change', e => {
      if (e.target.id === 'tix-drug') state.cid = Number(e.target.value);
      readNumber('#tix-dose', 'dose', 0.01);
      readNumber('#tix-tau', 'tau', 0.1);
      readNumber('#tix-weight', 'weight', 1);
      render();
    });
    $('#ti-exp-out')?.addEventListener('change', e => {
      const route = e.target?.dataset?.route;
      if (!route) return;
      const v = Math.min(100, Math.max(1, Number(e.target.value) || 100));
      state = { ...state, f: { ...state.f, [route]: v / 100 } };
      render();
    });
  }
  render();
  return true;
}
