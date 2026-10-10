// The only script index.html loads. It imports just caps and fallback statically; the app proper is imported
// dynamically so that a failure in one part (three.js, an import map, WebGL) is reported instead of leaving a blank page.
//
// Order: capability probe -> core app (data, controls, text, table, Hansch fits, tour; needs no WebGL and no three) ->
// 3D layer (only when WebGL works). A 3D failure leaves the 2D app running; a core failure is fatal and says what failed.
import { detectCaps } from './caps.js';
import { setProgress, setStatus, showFatal, showNoWebGL } from './fallback.js';

async function main() {
  const caps = detectCaps();
  // start fetching the 3D half in parallel with the core, but only for a browser that can use it; its modules do nothing
  // until bootGl() is called
  const glModule = caps.webgl ? import('./boot-gl.js') : null;
  glModule?.catch(() => {});                      // reported below, where it is awaited
  let core;
  try { core = await import('./boot-core.js'); }
  catch (err) { showFatal(`A script this page needs did not load (${err?.message}). Reload to try again.`); return; }
  try { await core.bootCore(caps); }
  catch (err) { showFatal(err?.phase === 'data' ? `Could not load the data (${err.message}).` : `The page could not be built (${err?.message}).`); return; }
  let gl = false;
  if (!caps.webgl) showNoWebGL('nowebgl');
  else {
    setStatus('Starting the 3D scene…');
    let mod;
    try { mod = await glModule; } catch (err) { console.error(err); showNoWebGL('load', err); }
    if (mod) {
      try { mod.bootGl(); gl = true; setProgress(3); }
      catch (err) { console.error(err); showNoWebGL('init', err); }
    }
  }
  try { core.startTour({ gl }); }
  catch (err) { showFatal(`The page could not be built (${err?.message}).`); }
}
main();
