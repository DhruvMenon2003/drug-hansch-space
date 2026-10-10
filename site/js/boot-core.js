// Layer 4. Everything that does not need WebGL: data, theme tokens, HUD, controls, table, detail, Hansch panel, copy and
// the tour. Loaded first by main.js; boot-gl.js attaches the 3D scene afterwards, and startTour() then picks the first
// step (so the scene is listening when the first layout is emitted).
import { app, anim, bus, STEPS, $ } from './kernel.js';
import { initAnnounce } from './announce.js';
import { loadData } from './data.js';
import { initTheme, readTokens } from './theme.js';
import { initView, selectDrug, setView } from './view.js';
import { initHud } from './hud.js';
import { initDetail } from './detail.js';
import { initControls, syncControls } from './controls.js';
import { initTable } from './table.js';
import { fillMethod, fillTourText, initHansch } from './hansch.js';
import { goStep, initTour, refreshTourBand, tourBand } from './tour.js';
import { hideStatus, setProgress, setStatus } from './fallback.js';

/**
 * Load the data and build every non-3D part of the page. `caps` comes from caps.js. Throws on a data error (an Error with
 * `phase: 'data'`, so main.js can tell it from a bug). Loading progress: 1 = data in, 2 = the page built.
 */
export async function bootCore(caps) {
  if (new URLSearchParams(location.search).has('debug')) window.__hansch = { app, anim, selectDrug, setView, goStep, STEPS, bus, caps, tour: { band: tourBand, refresh: refreshTourBand } };
  // gsap keeps its ticker (a rAF loop) alive for 120 ticks after the last tween by default; 20 is plenty and shortens the tail before true idle
  window.gsap?.config({ autoSleep: 20 });
  setStatus('Loading data…');
  try { await loadData(); } catch (err) { err.phase = 'data'; throw err; }
  setProgress(1);
  setStatus('Building the page…');
  readTokens();
  initView();
  initHud();
  initTable();
  initDetail();
  initAnnounce();
  initControls();
  initHansch();
  fillTourText();
  fillMethod();
  syncControls();
  setProgress(2);
}

/**
 * Show the first tour step (which lays the scene out) and start watching the theme. With the 3D layer the loading line
 * goes away after the first drawn frame (progress 4); without it, now.
 * @param {{ gl?: boolean }} [o]
 */
export function startTour({ gl = true } = {}) {
  // Started here, in the same task as the first camera move, exactly as the single-file app did: its first callback (which
  // publishes the measured masthead height as --stage-top and so changes the stage's aspect) must not run before that move,
  // or the initial camera distance, which scales with the aspect at the time, would depend on load timing.
  const head = $('.masthead');
  new ResizeObserver(() => document.documentElement.style.setProperty('--stage-top', `${head.offsetHeight}px`)).observe(head);
  const done = () => { setProgress(4); hideStatus(); };
  if (gl) {
    const off = bus.on('gl:firstframe', () => { off(); clearTimeout(timer); done(); });
    const timer = setTimeout(() => { off(); done(); }, 8000);     // a tab that never draws must not show "loading" for ever
  }
  const offTour = initTour();
  if (window.__hansch?.tour) Object.assign(window.__hansch.tour, { init: initTour, off: offTour });
  initTheme();
  if (!gl) done();
}
