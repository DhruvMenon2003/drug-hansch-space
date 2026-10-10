// Layer 3. The guided tour: scroll position picks the step, the step sets the view and the camera.
//
// No ScrollTrigger (it keeps a requestAnimationFrame loop alive for the life of the page, which makes an idle page
// impossible). An IntersectionObserver watches a thin horizontal band, the "reading line": whichever step crosses it is
// the active one, exactly what ScrollTrigger's `top 62%` .. `bottom 62%` toggle computed. The band is a rootMargin built
// from the measured layout, so it is rebuilt when the viewport changes shape. The Explore and Hansch sections cross the
// same line: arriving at Explore from the tour shows the all-drugs view, arriving at Hansch shows the chosen fit.
import { $, app, bus, narrow, STEPS } from './kernel.js';
import { setView } from './view.js';
import { announce } from './announce.js';

const NAMES = Object.keys(STEPS);

/** Activate tour step `name`: highlight its text, apply its view and ask the scene to fly to its camera pose. */
export function goStep(name) {
  if (app.step === name) return;
  const first = app.step == null;
  app.step = name;
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('is-active', s.dataset.step === name));
  const st = STEPS[name], gv = st.view.group === 'SERIES' ? app.seriesId : st.view.group ?? null;
  setView({ l1: '', l2: '', l3: '', route: '', small: false, veber: false, ...st.view, group: gv });
  bus.emit('cmd:camera', { preset: name });
  if (!first) {
    const h = document.querySelector(`.step[data-step="${name}"] h2`);
    announce(`Plot updated: step ${NAMES.indexOf(name) + 1} of ${NAMES.length}${h ? ', ' + h.textContent : ''}.`);
  }
}

// ---------------------------------------------------------------- the reading line
/** Height of what sticks above the reading area: the masthead, plus the stage on phones where the stage sits on top. */
const stack = () => ($('.masthead')?.offsetHeight ?? 0) + (narrow.matches ? ($('#stage')?.offsetHeight ?? 0) : 0);
/** y (px from the viewport top) of the reading line. Wide: 62% of the viewport. Phones: 30% down the visible reading area, below the sticky stack. */
export function readingLine() {
  const H = innerHeight;
  const y = narrow.matches ? stack() + 0.3 * (H - stack()) : 0.62 * H;
  return Math.max(1, Math.min(H - 3, Math.round(y)));
}

let io = null, line = 0, margin = '', built = { w: 0, h: 0 }, skipFirst = false, ctx = null, off = () => {};
const targets = () => [...document.querySelectorAll('.step'), ...['#explore', '#detail', '#hansch', '#method'].map(s => $(s)), $('#table-details')?.closest('section')].filter(Boolean);

/** "Show this fit in 3D" for the Hansch group in the select, unless the stage already shows it. */
function showSelectedFit() {
  const sel = $('#h-group');
  if (!sel?.value || !app.groups.has(sel.value)) return;
  const v = app.view;
  if (v.group === sel.value && v.x === 'logp' && v.y === 'act' && v.z === 'mr') return;
  setView({ x: 'logp', y: 'act', z: 'mr', color: 'single', group: sel.value, l1: '', l2: '', l3: '', route: '', small: true, veber: false });
  bus.emit('cmd:camera', { preset: 'series' });
}

function activate(el) {
  if (el.classList.contains('step')) { ctx = 'step'; goStep(el.dataset.step); return; }
  const id = el.id || 'table';
  if (id === 'explore') { if (ctx === 'step' || ctx === null) goStep('all'); }   // came from the tour (or landed here): the all-drugs view
  else if (id === 'hansch') { if (ctx !== 'hansch') showSelectedFit(); }
  ctx = id;
}

function onEntries(entries) {
  if (skipFirst) { skipFirst = false; return; }       // a preset step (deep link) stands until the page is scrolled
  for (const e of entries) if (e.isIntersecting) activate(e.target);
}

/** (Re)build the observer for the current viewport. Safe to call at any time; idempotent when nothing changed shape. */
export function refreshTourBand() {
  io?.disconnect();
  const H = innerHeight;
  built = { w: innerWidth, h: H };
  line = readingLine();
  margin = `-${line}px 0px -${Math.max(0, H - line - 2)}px 0px`;       // a 2 px strip at the line
  io = new IntersectionObserver(onEntries, { rootMargin: margin, threshold: 0 });
  for (const el of targets()) io.observe(el);
}

/**
 * Rebuild the band only when it can have moved: the width changed, the height changed by 150 px or more, or (same viewport)
 * the sticky stack changed height. A same-width height change under 150 px is the browser chrome sliding in or out.
 */
function maybeRebuild() {
  const widthChanged = innerWidth !== built.w, dh = Math.abs(innerHeight - built.h);
  if (!widthChanged && dh > 0 && dh < 150) return;
  if (!widthChanged && dh === 0 && Math.abs(readingLine() - line) < 2) return;
  refreshTourBand();
}

/** The band in use (tests and the mobile layout read it). */
export const tourBand = () => ({ line, margin });

/**
 * Hook the eight steps to the reading line and show step 1 (or the preset step in app.step).
 * @returns {() => void} undo
 */
export function initTour() {
  off();                                              // a second call replaces the first
  $('#tour')?.classList.add('tour-live');
  const preset = app.step && STEPS[app.step] ? app.step : null;
  app.step = null;                                    // so that goStep applies the preset instead of returning early
  goStep(preset || 'space');
  skipFirst = !!preset;
  ctx = null;
  refreshTourBand();
  const ac = new AbortController(), { signal } = ac;
  let timer = 0;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(maybeRebuild, 120); }, { signal });
  narrow.addEventListener('change', refreshTourBand, { signal });
  // the sticky stack can change height by itself (wrapped header, collapsing header)
  const ro = new ResizeObserver(maybeRebuild);
  for (const el of [$('.masthead'), $('#stage')]) if (el) ro.observe(el);
  off = () => { ac.abort(); clearTimeout(timer); ro.disconnect(); io?.disconnect(); io = null; $('#tour')?.classList.remove('tour-live'); };
  return off;
}
