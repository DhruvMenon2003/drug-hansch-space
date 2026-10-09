// GL boot. Attaches the 3D scene to the already-running page. Imported dynamically by main.js after boot-core, so a
// missing WebGL or a failed three.js load cannot take the 2D page down with it. Call bootGl() before startTour().
import * as THREE from 'three';
import { $ } from './kernel.js';
import { initScene, stage } from './gl/scene.js';
import { initScenery } from './gl/scenery.js';
import { bindPointer, bindStageTools, camTo, frame } from './gl/render.js';
import { initMolEvents, molv } from './gl/molviewer.js';

/** Create the scene, wire its events and start the render loop. Throws when WebGL is unavailable. */
export function bootGl() {
  initScene();
  initScenery();
  bindPointer($('#space'), $('.stage-inner'));
  initMolEvents();
  bindStageTools();
  stage.renderer.setAnimationLoop(frame);
  if (window.__hansch) Object.assign(window.__hansch, { stage, molv, camTo, THREE });
}
