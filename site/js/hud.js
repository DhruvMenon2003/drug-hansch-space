// Layer 2. The text overlays on the stage: legend (and the ATC chips it mirrors), axis key, and the count line.
import { app, bus, $, cap, esc, fin } from './kernel.js';
import { AX, axLong, passes } from './model.js';

/** Legend for the current colour mode; keeps the ATC chips in step with the slots. */
export function renderLegend() {
  const v = app.view, T = app.tokens, sw = (c, t) => `<span><span class="sw" style="background:${c}"></span>${esc(t)}</span>`;
  let h = '';
  if (app.qsarHighlight) h = sw(T.s1, 'DRD2: within domain') + sw(T.mark, 'DRD2: outside domain') + sw(T.point, 'Not in the DRD2 dataset');
  else if (app.scafFocus) h = sw(T.s1, `On this scaffold (${app.scafFocus.size})`) + sw(T.point, 'Another scaffold');
  else if (v.color === 'atc') {
    v.atc.forEach((c, i) => { if (c) h += sw(T['s' + (i + 1)], `${c} ${cap(app.meta.atc_names[c])}`); });
    h += sw(T.point, 'Other ATC groups');
  } else if (v.color === 'oral') h = sw(T.s1, 'Oral route') + sw(T.s2, 'No oral route') + sw(T.point, 'No route listed');
  else if (v.color === 'act') h = `<span>pChEMBL &lt;6<span class="ramp"></span>≥9</span>` + sw(T.point, 'No activity value');
  else if (v.color === 'ro5') h = sw(T.q2, '0 rule-of-five violations') + sw(T.q4, '1') + sw(T.q5, '2 or more');
  else h = `<span>Each sphere is one drug</span>`;
  $('#legend').innerHTML = h;
  // chips mirror the slots
  document.querySelectorAll('#atc-pick .chip').forEach(ch => {
    const slot = v.atc.indexOf(ch.dataset.code);
    ch.setAttribute('aria-pressed', slot >= 0);
    ch.querySelector('.sw').style.background = slot >= 0 ? T['s' + (slot + 1)] : '';
    ch.disabled = slot < 0 && !v.atc.includes(null);
  });
  $('#atc-pick-wrap').hidden = v.color !== 'atc';
  const grp = $('#g-atc');
  if (grp) grp.hidden = v.color !== 'atc';                   // the whole 'ATC highlight' group has nothing to show in another colour mode
  renderBadges();
}

/** The counts on the closed Explore groups: how many ATC groups are highlighted, how many filters are on. */
export function renderBadges() {
  const v = app.view, fb = $('#g-filters-badge'), ab = $('#g-atc-badge');
  const n = [v.l1, v.l2, v.l3, v.route, v.small].filter(Boolean).length;
  if (fb) fb.textContent = n ? `${n} on` : '';
  if (ab) ab.textContent = v.color === 'atc' && v.atc.some(Boolean) ? `${v.atc.filter(Boolean).length} chosen` : '';
}

/** One line per chosen axis, with its long name. */
export function renderAxisKey() {
  const v = app.view;
  $('#axis-key').innerHTML = ['x', 'y', 'z'].filter(a => v[a] !== 'none')
    .map(a => `<span><b>${a.toUpperCase()}</b> ${esc(axLong(v[a]))}</span>`).join('');
}

/** "Showing n of N drugs ..." with the reasons drugs are left out. */
export function renderCount() {
  const v = app.view, n = app.visible.length, total = app.drugs.length;
  const grp = v.group && app.groups.get(v.group);
  const big = d => v.small && !(d.d.mw <= app.hansch.max_mw);
  const missing = app.drugs.filter(d => !(v.group && !grp?.cids.has(d.cid)) && !big(d) && [v.x, v.y, v.z].some(k => !AX[k].pseudo && !fin(AX[k].get(d)))).length;
  // drugs the size filter alone removes from this view (counted with the filter ignored; the view itself is never touched)
  const nBig = v.small && !v.group ? app.drugs.filter(d => !(d.d.mw <= app.hansch.max_mw) && passes(d, false, true)).length : 0;
  let s = `Showing ${n} of ${total} drugs`;
  if (grp) s += ` in the fit for ${grp.fit.id === 'ALL' ? 'all drugs with an activity value' : grp.fit.label}`;
  if (nBig) s += `; ${nBig} drugs over ${app.hansch.max_mw} Da are left out`;
  if (missing) s += `; ${missing} have no value on one of the axes`;
  $('#count').textContent = s + '.';
}

/** Redraw the overlays on layout, colour and theme changes (works with WebGL absent). */
export function initHud() {
  bus.on('layout', () => { renderLegend(); renderAxisKey(); renderCount(); });
  bus.on('recolor', renderLegend);
  bus.on('theme', renderLegend);
}
