// GL boot. Attaches the 3D scene to the already-running page. Imported dynamically by main.js after boot-core, so a
// missing WebGL or a failed three.js load cannot take the 2D page down with it. Call bootGl() before startTour().
import * as THREE from 'three';
import { $, bus } from './kernel.js';
import { announce } from './announce.js';
import { showStatus, hideStatus } from './fallback.js';
import { initScene, resize, stage, watchContext } from './gl/scene.js';
import { initScenery } from './gl/scenery.js';
import { bindPointer, bindStageTools, camTo, renderFrame } from './gl/render.js';
import { initMolEvents, molv } from './gl/molviewer.js';

/**
 * Create the scene, wire its events and start the on-demand render loop. Throws when WebGL is unavailable.
 * @returns {{ dispose: () => void }} dispose() undoes everything bootGl() did (listeners, observers, GL objects, bus subscriptions)
 */
export function bootGl() {
  const disposeScene = initScene();
  const offScenery = initScenery();
  const offPointer = bindPointer($('#space'), $('.stage-inner'));
  const offMol = initMolEvents();
  const offTools = bindStageTools();
  const ac = new AbortController();
  // A lost context stops drawing (nothing would repaint on its own now that the loop is on demand) and says so; when the
  // browser restores it, three.js re-creates its GPU objects on the next draw, so redraw at once and rebuild the scene content.
  watchContext($('#space'), {
    onLost() {
      stage.loop.pause();
      showStatus('Graphics context lost, restoring the 3D view…');
      announce('The 3D view lost its graphics context and is restoring.', 'assertive');
    },
    onRestored() {
      stage.loop.resume();
      resize();
      bus.emit('layout', { instant: true });
      stage.loop.renderNow();
      hideStatus();
      announce('The 3D view was restored.');
    },
  }, ac.signal);
  stage.loop.setRender(renderFrame);
  stage.loop.invalidate();
  if (window.__hansch) Object.assign(window.__hansch, { stage, molv, camTo, THREE, stats: stage.loop.stats, quality: stage.quality, loop: stage.loop });
  const gl = {
    dispose() {
      ac.abort(); offTools(); offPointer(); offMol(); offScenery(); disposeScene();
      if (window.__hansch?.gl === gl) delete window.__hansch.gl;
    },
  };
  if (window.__hansch) window.__hansch.gl = gl;
  return gl;
}
