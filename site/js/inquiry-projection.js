// Layer 2. An honest two-axis view of the same filtered records when WebGL is unavailable.
import { app, esc, fx, S } from './kernel.js';
import { AX, colorOf } from './model.js';
import { focusExtent, identityWarning } from './inquiry-math.js';

export function renderProjection(state) {
  const figure = document.querySelector('#inquiry-projection');
  figure.hidden = !document.documentElement.classList.contains('no-webgl');
  if (figure.hidden) return;
  figure.querySelector('.projection-legend').innerHTML = document.querySelector('#legend').innerHTML;
  const axes = ['x', 'y', 'z'].filter(a => !AX[app.view[a]].pseudo);
  const [xa, ya] = axes, x = AX[app.view[xa]], y = AX[app.view[ya]];
  const svg = figure.querySelector('svg'), caption = figure.querySelector('figcaption');
  const toggle = figure.querySelector('#inquiry-projection-zoom');
  const pin = app.visible.find(d => d.cid === state.cid);
  toggle.disabled = !pin || !x || !y;
  const focused = state.projectionZoom && !toggle.disabled;
  toggle.textContent = focused ? 'Show whole population' : 'Zoom to pin & neighbours';
  toggle.setAttribute('aria-pressed', String(focused));
  if (!x || !y) { svg.innerHTML = ''; caption.textContent = 'Choose two measured or computed axes to draw a projection. The full data table remains available below.'; return; }
  const focusRows = pin ? [pin, ...state.neighbours] : [];
  const zoomScale = get => { const {lo, hi} = focusExtent(focusRows, get); return {lo, hi, ticks:[lo,(lo+hi)/2,hi], map:v=>(v-lo)/(hi-lo)*2*S-S}; };
  const sx = focused ? zoomScale(x.get) : app.scales[xa], sy = focused ? zoomScale(y.get) : app.scales[ya];
  const px = v => 128 + (sx.map(v) + S) / (2 * S) * 490;
  const py = v => 330 - (sy.map(v) + S) / (2 * S) * 300;
  const xlabel = `${x.label}${x.unit ? ` (${x.unit})` : ''}`, ylabel = `${y.label}${y.unit ? ` (${y.unit})` : ''}`;
  const sparse = ticks => ticks.filter((_, i) => i === 0 || i === Math.floor((ticks.length - 1) / 2) || i === ticks.length - 1);
  const ticks = sparse(sx.ticks).map(v => `<text class="projection-tick" x="${px(v)}" y="350" text-anchor="middle">${fx(v, focused ? 2 : x.dec)}</text>`).join('') + sparse(sy.ticks).map(v => `<text class="projection-tick" x="116" y="${py(v) + 4}" text-anchor="end">${fx(v, focused ? 1 : y.dec)}</text>`).join('');
  const slice = state.active && axes.some(a => app.view[a] === 'tpsa') && state.slice != null ? state.slice : null;
  const plane = app.view[xa] === 'tpsa' && slice >= sx.lo && slice <= sx.hi && slice != null ? `<line class="projection-slice" x1="${px(slice)}" x2="${px(slice)}" y1="30" y2="330"/>` : app.view[ya] === 'tpsa' && slice >= sy.lo && slice <= sy.hi && slice != null ? `<line class="projection-slice" x1="128" x2="618" y1="${py(slice)}" y2="${py(slice)}"/>` : '';
  const rows = app.visible.filter(d => Number.isFinite(x.get(d)) && Number.isFinite(y.get(d)) && x.get(d)>=sx.lo && x.get(d)<=sx.hi && y.get(d)>=sy.lo && y.get(d)<=sy.hi);
  const point = d => `<circle class="projection-point" data-projection-cid="${d.cid}" cx="${px(x.get(d))}" cy="${py(y.get(d))}" r="${slice != null && d.d.tpsa > slice ? 1.8 : 3.6}" fill="${esc(colorOf(d))}"><title>${esc(d.name)}${identityWarning(d) ? ' — identity mismatch' : ''} · ${esc(xlabel)} ${fx(x.get(d),2)} · ${esc(ylabel)} ${fx(y.get(d),2)}</title></circle>`;
  const selected = app.drugs[app.selected];
  const marked = rows.filter(d => d.cid === state.cid || d.cid === selected?.cid || state.neighbours.some(n => n.cid === d.cid));
  const rings = marked.map(d => `<circle class="${d.cid === state.cid ? 'projection-anchor' : 'projection-neighbour'}" cx="${px(x.get(d))}" cy="${py(y.get(d))}" r="${d.cid === state.cid ? 8 : 6}"/>`).join('');
  const flagged = rows.filter(identityWarning);
  const warnings = flagged.map(d=>`<g class="projection-identity-mark" transform="translate(${px(x.get(d))} ${py(y.get(d))})"><circle r="7"/><path d="M-5-5L5 5M-5 5L5-5"/></g>`).join('');
  svg.innerHTML = `<title id="projection-title">${esc(xlabel)} versus ${esc(ylabel)}: ${rows.length} stored records</title><desc>Two-dimensional projection. The pin has an outer ring; a crossed outline marks a known identity mismatch. Select by the neighbour list, search or full data table below.</desc><defs><clipPath id="projection-clip"><rect x="122" y="24" width="502" height="312"/></clipPath></defs><path class="projection-axis" d="M128 30V330H618"/>${ticks}<text class="projection-axis-label" x="373" y="387" text-anchor="middle">${esc(xlabel)}</text><text class="projection-axis-label" transform="translate(17 180) rotate(-90)" text-anchor="middle">${esc(ylabel)}</text><g clip-path="url(#projection-clip)">${plane}${rows.map(point).join('')}${rings}${warnings}</g>`;
  const omitted = axes.slice(2).map(a => AX[app.view[a]].label);
  caption.textContent = `${focused ? 'Neighbourhood zoom' : 'Whole-population 2D projection'} · ${rows.length} of ${app.visible.length} filtered records in frame · ${app.visible.length-rows.length} off-screen. ${focused ? 'Only the viewport changes; axes retain their original units. ' : ''}${omitted.length ? `${omitted.join(', ')} is omitted here. ` : ''}Neighbour rankings use the full filtered cohort and all map axes. Colours follow the legend. ${flagged.length ? 'Crossed outline: a known ofatumumab name–structure mismatch, retained for inspection; these coordinates do not describe validated ofatumumab chemistry. ' : ''}Use the neighbour list, search or full table to select a record.`;
}
