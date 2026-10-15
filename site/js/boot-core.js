// Layer 4. Everything that does not need WebGL: data, theme tokens, HUD, controls, table, detail, Hansch panel, copy and
// the tour. Loaded first by main.js; boot-gl.js attaches the 3D scene afterwards, and startTour() then picks the first
// step (so the scene is listening when the first layout is emitted).
const BENCH_MOD = 'bench.js';                       // a variable specifier: loaded on demand, never preloaded
import { app, anim, bus, STEPS, $ } from './kernel.js';
import { announce, initAnnounce } from './announce.js';
import { loadData } from './data.js';
import { initTheme, readTokens } from './theme.js';
import { initView, selectDrug, setView } from './view.js';
import { initHud } from './hud.js';
import { initDetail } from './detail.js';
import { initControls, syncControls } from './controls.js';
import { initTable, initExtras } from './table.js';
import { fillMethod, fillTourText, initHansch } from './hansch.js';
import { goStep, initTour, refreshTourBand, tourBand } from './tour.js';
import { initLayout, layoutState } from './layout.js';
import { initSheet } from './sheet.js';
import { APP_BUILD, buildMismatch } from './version.js';
import { hideStatus, setProgress, setStatus } from './fallback.js';

/** "Skip to the 3D plot": the target is a marker span; hand focus to the canvas itself (when it is shown). */
function bindSkipLink() {
  document.addEventListener('click', e => {
    if (!e.target.closest?.('a[href="#space-skip"]')) return;
    const plot = $('#space');
    if (!plot || plot.hidden) return;                // 2D-only mode: the default jump to the marker stands
    e.preventDefault();
    plot.focus();
  });
}

/**
 * "A newer version of this page is available": reveal #version-banner when the data file was published by a different build
 * than the code that is running (cached old scripts with new data, or the reverse). Non-blocking: a banner with a Reload
 * button and a polite announcement. An unstamped ('dev') build never shows it. Returns whether the banner was shown.
 * @param {{ app_build?: unknown } | null | undefined} meta data meta  @param {string} [build] this code's build id (tests may pass one)
 */
export function checkBuild(meta, build = APP_BUILD) {
  const el = $('#version-banner');
  if (!el || !buildMismatch(build, meta?.app_build)) return false;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    $('#version-reload', el)?.addEventListener('click', () => location.reload());
  }
  el.hidden = false;
  announce('A newer version of this page is available. Use the Reload button to get it.');
  return true;
}

/**
 * Load the data and build every non-3D part of the page. `caps` comes from caps.js. Throws on a data error (an Error with
 * `phase: 'data'`, so main.js can tell it from a bug). Loading progress: 1 = data in, 2 = the page built.
 */
export async function bootCore(caps) {
  if (new URLSearchParams(location.search).has('debug')) window.__hansch = { app, anim, selectDrug, setView, goStep, STEPS, bus, caps, layout: layoutState, tour: { band: tourBand, refresh: refreshTourBand } };
  // gsap keeps its ticker (a rAF loop) alive for 120 ticks after the last tween by default; 20 is plenty and shortens the tail before true idle
  window.gsap?.config({ autoSleep: 20 });
  bindSkipLink();
  setStatus('Loading data…');
  try { await loadData(); } catch (err) { err.phase = 'data'; throw err; }
  setProgress(1);
  checkBuild(app.meta);                              // code and data from different deploys: offer a reload (never for a 'dev' build)
  setStatus('Building the page…');
  readTokens();
  initView();
  initHud();
  initTable();
  initDetail();
  // the PK bench and the CSV upload load their module and data only when asked for: nothing on first load or first pick
  const bench = () => import(`./${BENCH_MOD}`).then(m => (m.initBench(), m));
  $('#d-bench-open')?.addEventListener('click', () => bench());
  $('#upload')?.addEventListener('change', e => { const f = e.target.files[0]; if (f) bench().then(m => m.importTable(f)); });
  initSheet();
  initAnnounce();
  initControls();
  initHansch();
  initExtras({ gl: !!caps?.webgl });                 // the QED panel and the binding overlay: both arrive on first use
  fillTourText();
  fillMethod();
  syncControls();
  initLayout();                                     // header, stage size policy, Expand, jump links, reading aids
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
