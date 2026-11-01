// Layer 2. An honest two-axis view of the same filtered records when WebGL is unavailable.
import { app, esc, fx, S } from './kernel.js';
import { AX, colorOf } from './model.js';

export function renderProjection(state) {
  const figure = document.querySelector('#inquiry-projection');
  figure.hidden = !document.documentElement.classList.contains('no-webgl');
  if (figure.hidden) return;
  figure.querySelector('.projection-legend').innerHTML = document.querySelector('#legend').innerHTML;
  const axes = ['x', 'y', 'z'].filter(a => !AX[app.view[a]].pseudo);
  const [xa, ya] = axes, x = AX[app.view[xa]], y = AX[app.view[ya]];
  const svg = figure.querySelector('svg'), caption = figure.querySelector('figcaption');
  if (!x || !y) { svg.innerHTML = ''; caption.textContent = 'Choose two measured or computed axes to draw a projection. The full data table remains available below.'; return; }
  const sx = app.scales[xa], sy = app.scales[ya];
  const px = v => 128 + (sx.map(v) + S) / (2 * S) * 490;
  const py = v => 330 - (sy.map(v) + S) / (2 * S) * 300;
  const xlabel = `${x.label}${x.unit ? ` (${x.unit})` : ''}`, ylabel = `${y.label}${y.unit ? ` (${y.unit})` : ''}`;
  const sparse = ticks => ticks.filter((_, i) => i === 0 || i === Math.floor((ticks.length - 1) / 2) || i === ticks.length - 1);
  const ticks = sparse(sx.ticks).map(v => `<text class="projection-tick" x="${px(v)}" y="350" text-anchor="middle">${fx(v, x.dec)}</text>`).join('') + sparse(sy.ticks).map(v => `<text class="projection-tick" x="116" y="${py(v) + 4}" text-anchor="end">${fx(v, y.dec)}</text>`).join('');
  const slice = state.active && axes.some(a => app.view[a] === 'tpsa') && state.slice != null ? state.slice : null;
  const plane = app.view[xa] === 'tpsa' && slice >= sx.lo && slice <= sx.hi && slice != null ? `<line class="projection-slice" x1="${px(slice)}" x2="${px(slice)}" y1="30" y2="330"/>` : app.view[ya] === 'tpsa' && slice >= sy.lo && slice <= sy.hi && slice != null ? `<line class="projection-slice" x1="128" x2="618" y1="${py(slice)}" y2="${py(slice)}"/>` : '';
  const rows = app.visible.filter(d => Number.isFinite(x.get(d)) && Number.isFinite(y.get(d)));
  const point = d => `<circle class="projection-point" data-projection-cid="${d.cid}" cx="${px(x.get(d))}" cy="${py(y.get(d))}" r="${slice != null && d.d.tpsa > slice ? 1.8 : 3.6}" fill="${esc(colorOf(d))}"><title>${esc(d.name)} · ${esc(xlabel)} ${fx(x.get(d),2)} · ${esc(ylabel)} ${fx(y.get(d),2)}</title></circle>`;
  const selected = app.drugs[app.selected];
  const marked = rows.filter(d => d.cid === state.cid || d.cid === selected?.cid || state.neighbours.some(n => n.cid === d.cid));
  const rings = marked.map(d => `<circle class="${d.cid === state.cid ? 'projection-anchor' : 'projection-neighbour'}" cx="${px(x.get(d))}" cy="${py(y.get(d))}" r="${d.cid === state.cid ? 8 : 6}"/>`).join('');
  svg.innerHTML = `<title id="projection-title">${esc(xlabel)} versus ${esc(ylabel)}: ${rows.length} compounds</title><desc>Two-dimensional projection of the current filtered population. The pinned compound has an outer ring. Select by the neighbour list, search or full data table below.</desc><path class="projection-axis" d="M128 30V330H618"/>${ticks}<text class="projection-axis-label" x="373" y="387" text-anchor="middle">${esc(xlabel)}</text><text class="projection-axis-label" transform="translate(17 180) rotate(-90)" text-anchor="middle">${esc(ylabel)}</text>${plane}${rows.map(point).join('')}${rings}`;
  const omitted = axes.slice(2).map(a => AX[app.view[a]].label);
  caption.textContent = `2D projection · ${rows.length} compounds · ${omitted.length ? `${omitted.join(', ')} is omitted here; neighbour rankings still use all displayed map axes. ` : ''}Colours follow the Explore legend. Use the neighbour list, search or full table to select a record.`;
}
