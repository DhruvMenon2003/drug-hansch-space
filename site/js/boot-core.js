// Layer 4. Everything that does not need WebGL: data, theme tokens, HUD, controls, table, detail, Hansch panel, copy and
// the tour. Loaded first by main.js; boot-gl.js attaches the 3D scene afterwards, and startTour() then picks the first
// step (so the scene is listening when the first layout is emitted).
import { app, anim, bus, STEPS, $ } from './kernel.js';
import { loadData } from './data.js';
import { initTheme, readTokens } from './theme.js';
import { initView, selectDrug, setView } from './view.js';
import { initHud } from './hud.js';
import { initDetail } from './detail.js';
import { initControls, syncControls } from './controls.js';
import { initTable } from './table.js';
import { fillMethod, fillTourText, initHansch } from './hansch.js';
import { goStep, initTour } from './tour.js';
import { hideStatus } from './fallback.js';

/** Load the data and build every non-3D part of the page. `caps` comes from caps.js. Throws on a data error (main.js reports it). */
export async function bootCore(caps) {
  if (new URLSearchParams(location.search).has('debug')) window.__hansch = { app, anim, selectDrug, setView, goStep, STEPS, bus, caps };
  await loadData();
  readTokens();
  initView();
  initHud();
  initTable();
  initDetail();
  initControls();
  initHansch();
  fillTourText();
  fillMethod();
  syncControls();
}

/** Show the first tour step (which lays the scene out), clear the loading line and start watching the theme. */
export function startTour() {
  // Started here, in the same task as the first camera move, exactly as the single-file app did: its first callback (which
  // publishes the measured masthead height as --stage-top and so changes the stage's aspect) must not run before that move,
  // or the initial camera distance, which scales with the aspect at the time, would depend on load timing.
  const head = $('.masthead');
  new ResizeObserver(() => document.documentElement.style.setProperty('--stage-top', `${head.offsetHeight}px`)).observe(head);
  initTour();
  hideStatus();
  initTheme();
}
