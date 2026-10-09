// xr-emulator.mjs - reusable WebXR emulation helper for Playwright (Chromium, headless OK).
//
// Wraps the Immersive Web Emulation Runtime (npm "iwer" 2.5.0, optional "@iwer/sem" 2.5.0 for
// synthetic planes/hit-test). THIS IS AN EMULATOR: it replaces navigator.xr with a JS implementation of the
// WebXR Device API and drives it with scripted poses. It proves your WebXR *code paths* run (session
// start, frame loop, input events, hit-test plumbing, session end). It does NOT prove anything about real
// optics, tracking, controller models, comfort, performance on a headset, or browser-specific XR quirks.
//
// Usage (in a Playwright script):
//   import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
//   import { installXR, CHROMIUM_GL_ARGS } from './xr-emulator.mjs';
//   const browser = await chromium.launch({ args: CHROMIUM_GL_ARGS });
//   const page = await (await browser.newContext()).newPage();
//   const xr = await installXR(page, { device: 'quest3', sem: 'floor' });   // BEFORE page.goto()
//   await page.goto(url);
//   await page.click('#enter-vr');                                           // real click = user activation
//   await xr.waitForSession('immersive-vr');
//   await xr.selectAt([0, 1.4, -2]);                                         // aim right controller + trigger
//   await xr.endSession();
//
// Coordinates: every "world point" you pass is in the app's primary XR reference space (the first one it
// requests; Three.js uses 'local-floor' => floor at y=0, i.e. plain Three world coordinates when the rig is at
// the origin). set_transform() poses are applied verbatim in that same space for the 'local-floor' case
// (IWER's local-floor offset is identity) - the helper converts via the session origin offset anyway.

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Chromium launch args that give working WebGL in this sandbox (software GL). */
export const CHROMIUM_GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const IWER_UMD = require.resolve('iwer/build/iwer.min.js'); // UMD -> globalThis.IWER (works as a plain <script>)
const SEM_UMD = require.resolve('@iwer/sem/build/iwer-sem.min.js'); // UMD -> globalThis.IWER_SEM (needs IWER first)
const SEM_CAPTURES = require.resolve('@iwer/sem/captures/office_small.json');

/** Minimal synthetic room for hit-test: a 10x10 m floor at y=0 (+ a 1x1 m table top at y=0.75). */
export function floorEnvironment({ table = true } = {}) {
  const ents = [{
    uuid: '00000000-0000-4000-8000-000000000001', semanticLabel_META: 'FLOOR',
    // SEM plane convention (verified vs Meta captures): geometry is built in the local XZ plane facing DOWN (-Y),
    // so a flat, UP-facing floor/table needs a 180deg rotation about X: quaternion (1,0,0,0). Using -90deg
    // (the "three.js" habit) yields a VERTICAL plane and bogus hit-test results. bounded2D offset.y runs along local +Z.
    locatable_META: { orientation: { x: 1, y: 0, z: 0, w: 0 }, position: { x: 0, y: 0, z: 0 } },
    bounded2D_META: { offset: { x: -5, y: -5 }, extent: { width: 10, height: 10 } },
  }];
  if (table) {
    ents.push({
      uuid: '00000000-0000-4000-8000-000000000002', semanticLabel_META: 'TABLE',
      locatable_META: { orientation: { x: 1, y: 0, z: 0, w: 0 }, position: { x: 0, y: 0.75, z: -1.5 } },
      bounded2D_META: { offset: { x: -0.5, y: -0.5 }, extent: { width: 1, height: 1 } },
    });
  }
  return { type: 'scene', version: 1, spatialEntities: ents };
}

/**
 * Install the emulator into `page` BEFORE any page script runs (page.addInitScript).
 * Call before page.goto(). Returns a driver object.
 *
 * @param {import('playwright').Page} page
 * @param {object} [opts]
 * @param {'quest3'|'quest2'|'questpro'|'phone-ar'} [opts.device='quest3']
 * @param {boolean} [opts.stereo=false]  true -> two views (side-by-side viewports) like a headset
 * @param {false|'floor'|'office'|object} [opts.sem=false]  synthetic environment for hit-test results
 * @param {[number,number,number]} [opts.headPosition=[0,1.6,0]]
 * @param {boolean} [opts.domOverlayShim]  default true for phone-ar: sets session.domOverlayState (SHIM, see notes)
 */
export async function installXR(page, opts = {}) {
  const o = { device: 'quest3', stereo: false, sem: false, headPosition: [0, 1.6, 0], ...opts };
  if (o.domOverlayShim === undefined) o.domOverlayShim = o.device === 'phone-ar';
  const useSem = !!o.sem;
  await page.addInitScript({ content: fs.readFileSync(IWER_UMD, 'utf8') });
  if (useSem) await page.addInitScript({ content: fs.readFileSync(SEM_UMD, 'utf8') });
  let envJson = null;
  if (useSem) {
    envJson = o.sem === 'floor' ? floorEnvironment() : o.sem === 'office' ? JSON.parse(fs.readFileSync(SEM_CAPTURES, 'utf8')) : o.sem;
  }
  await page.addInitScript(({ device, stereo, headPosition, useSem, envJson, domOverlayShim }) => {
    const I = globalThis.IWER;
    const phone = {
      name: 'Phone AR (emulated, ARCore-like)', controllerConfig: undefined,
      supportedSessionModes: ['inline', 'immersive-ar'],
      supportedFeatures: ['viewer', 'local', 'local-floor', 'hit-test', 'anchors', 'dom-overlay'],
      supportedFrameRates: [30, 60], isSystemKeyboardSupported: false, internalNominalFrameRate: 60,
      environmentBlendModes: { 'immersive-ar': 'alpha-blend' }, interactionMode: 'screen-space',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    };
    const cfg = { quest3: I.metaQuest3, quest2: I.metaQuest2, questpro: I.metaQuestPro, 'phone-ar': phone }[device];
    if (!cfg) throw new Error('installXR: unknown device ' + device);
    const dev = new I.XRDevice(cfg, { stereoEnabled: !!stereo });
    dev.position.set(headPosition[0], headPosition[1], headPosition[2]);
    // forceInstall: headless Chromium already has a native navigator.xr that reports "unsupported".
    dev.installRuntime({ forceInstall: true });
    globalThis.__iwerDevice = dev;
    globalThis.__xrFrameCount = 0;
    // Count every XR frame delivered to the app (independent of the app's own counters).
    const proto = I.XRSession.prototype;
    const origRaf = proto.requestAnimationFrame;
    proto.requestAnimationFrame = function (cb) {
      return origRaf.call(this, (t, f) => { globalThis.__xrFrameCount++; return cb(t, f); });
    };
    if (useSem) {
      dev.installSEM(globalThis.IWER_SEM.SyntheticEnvironmentModule);
      dev.sem.loadEnvironment(envJson);
      dev.sem.scene.updateMatrixWorld(true); // sem.render() (which does this) only runs in immersive-ar frames
      globalThis.__iwerSem = dev.sem;
      // @iwer/sem bundles its own three r184 which sets window.__THREE__; drop it so the app's own three
      // import does not log "Multiple instances of Three.js being imported".
      try { delete globalThis.__THREE__; } catch (_) { globalThis.__THREE__ = undefined; }
    }
    if (domOverlayShim) {
      // IWER does not implement DOM Overlay at all. This shim only lets the app's `session.domOverlayState`
      // code path run; the real UA behaviours (overlay promoted to top layer, :xr-overlay, beforexrselect) are NOT emulated.
      const origReq = I.XRSystem.prototype.requestSession;
      I.XRSystem.prototype.requestSession = function (mode, init) {
        return origReq.call(this, mode, init).then((session) => {
          if (session.enabledFeatures.includes('dom-overlay') && init && init.domOverlay && init.domOverlay.root) {
            Object.defineProperty(session, 'domOverlayState', { value: { type: 'screen' }, configurable: true });
            init.domOverlay.root.setAttribute('data-xr-overlay-shim', 'screen');
          }
          return session;
        });
      };
    }
  }, { device: o.device, stereo: o.stereo, headPosition: o.headPosition, useSem, envJson, domOverlayShim: !!o.domOverlayShim });
  return makeDriver(page, o);
}

function makeDriver(page, o) {
  const call = (method, params = {}) => page.evaluate(([m, p]) => globalThis.__iwerDevice.remote.dispatch(m, p), [method, params]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const driver = {
    options: o,
    /** Raw access to IWER's RemoteControlInterface (get_transform, set_transform, look_at, animate_to, select, ...). */
    dispatch: call,
    /** Capability manifest of the remote interface. */
    describe: () => page.evaluate(() => globalThis.__iwerDevice.remote.describe()),
    /** { sessionActive, sessionMode, enabledFeatures, deviceName, visibilityState, ... } */
    status: () => call('get_session_status'),
    /** Poll until a session (optionally of `mode`) is active. Resolves to the status. */
    async waitForSession(mode, timeout = 15000) {
      const t0 = Date.now();
      for (;;) {
        const s = await call('get_session_status');
        if (s.sessionActive && (!mode || s.sessionMode === mode)) return s;
        if (Date.now() - t0 > timeout) throw new Error(`waitForSession(${mode}) timed out; status=${JSON.stringify(s)}`);
        await sleep(100);
      }
    },
    /** Wait until `session` ended (sessionActive=false). */
    async waitForSessionEnd(timeout = 10000) {
      const t0 = Date.now();
      for (;;) {
        const s = await call('get_session_status');
        if (!s.sessionActive) return s;
        if (Date.now() - t0 > timeout) throw new Error('waitForSessionEnd timed out');
        await sleep(100);
      }
    },
    /** XR frames delivered to the app via session.requestAnimationFrame since page load. */
    frameCount: () => page.evaluate(() => globalThis.__xrFrameCount),
    /** Wait for `n` more XR frames (rendered by the app's XR animation loop). Resolves to the new total. */
    async waitForFrames(n = 30, timeout = 60000) {
      const start = await driver.frameCount();
      const t0 = Date.now();
      for (;;) {
        const c = await driver.frameCount();
        if (c - start >= n) return c;
        if (Date.now() - t0 > timeout) throw new Error(`waitForFrames(${n}) timed out at ${c - start}`);
        await sleep(50);
      }
    },
    /** Teleport/aim the headset. { position:[x,y,z], lookAt:[x,y,z] } (lookAt is in the app's XR space, keeps head level). */
    async setHeadPose({ position, lookAt, orientation } = {}) {
      if (position) await call('set_transform', { device: 'headset', position: v3(position), ...(orientation ? { orientation } : {}) });
      else if (orientation) await call('set_transform', { device: 'headset', orientation });
      if (lookAt) await call('look_at', { device: 'headset', target: v3(lookAt) });
      return call('get_transform', { device: 'headset' });
    },
    /**
     * Move/aim a controller (or hand when input mode is 'hand'). hand: 'left'|'right'.
     * { position:[x,y,z] (global == local-floor space), lookAt:[x,y,z] (XR space), orientation:{x,y,z,w} }
     */
    async moveController(hand = 'right', { position, lookAt, orientation } = {}) {
      const device = await deviceId(hand);
      if (position) await call('set_transform', { device, position: v3(position), ...(orientation ? { orientation } : {}) });
      else if (orientation) await call('set_transform', { device, orientation });
      if (lookAt) await call('look_at', { device, target: v3(lookAt) });
      return call('get_transform', { device });
    },
    /** Press+release the primary button (trigger / pinch). Fires selectstart, select, selectend on the session. */
    async pressSelect(hand = 'right', { duration = 0.12 } = {}) {
      return call('select', { device: await deviceId(hand), duration });
    },
    /**
     * Aim `hand` at `worldPoint` (app XR-space coords) and fire select. This is the "click a 3D pick in VR" primitive.
     * opts.from: controller position to aim from (default: waist-high, 0.25 m to the side, 0.3 m in front of the head x/z).
     */
    async selectAt(worldPoint, { hand = 'right', from, duration = 0.12 } = {}) {
      const side = hand === 'left' ? -1 : 1;
      const head = await call('get_transform', { device: 'headset' });
      const pos = from || [head.position.x + 0.25 * side, Math.max(0.8, head.position.y - 0.3), head.position.z - 0.3];
      await driver.moveController(hand, { position: pos, lookAt: worldPoint });
      await driver.waitForFrames(2); // let the app render a frame with the new pose before the trigger
      return driver.pressSelect(hand, { duration });
    },
    /**
     * Press+release a named controller button: 'squeeze' (grip), 'trigger', 'thumbstick' (click), 'a-button'|'x-button',
     * 'b-button'|'y-button'. Fires the matching 'squeeze'/'select' events for squeeze/trigger. Uses XRController.updateButtonValue
     * directly because RemoteControlInterface.set_gamepad_state indexes buttons differently from the real gamepad layout.
     */
    async pressButton(hand = 'right', id = 'squeeze', { frames = 4 } = {}) {
      const set = (v) => page.evaluate(([h, b, val]) => { globalThis.__iwerDevice.controllers[h].updateButtonValue(b, val); }, [hand, id, v]);
      await set(1); await driver.waitForFrames(frames); await set(0); await driver.waitForFrames(frames);
    },
    /** Set thumbstick axes (-1..1) on a controller; the app sees gamepad.axes[2], axes[3] (xr-standard). */
    async setThumbstick(hand = 'right', x = 0, y = 0) {
      await page.evaluate(([h, ax, ay]) => { globalThis.__iwerDevice.controllers[h].updateAxes('thumbstick', ax, ay); }, [hand, x, y]);
      await driver.waitForFrames(3);
    },
    /** Hold (value 1) / release (0) the primary button without the auto-release. */
    async setSelectValue(hand, value) { return call('set_select_value', { device: await deviceId(hand), value }); },
    /** 'controller' | 'hand' - switches which input sources are connected (hand-tracking path). */
    async setInputMode(mode) { return call('set_input_mode', { mode }); },
    /** Connect/disconnect an input device, e.g. setConnected('controller-left', false). */
    async setConnected(device, connected) { return call('set_connected', { device, connected }); },
    getTransform: (device = 'headset') => call('get_transform', { device }),
    /** End the active session (same as the user pressing the system "exit" button). Resolves after the 'end' event. */
    async endSession() { const r = await call('end_session'); await driver.waitForSessionEnd(); return r; },
    /**
     * Best-effort screen tap for phone AR (targetRayMode 'screen' / transient input). IWER has NO touch emulation, so this
     * injects a synthetic XRInputSource for one frame and fires selectstart/select/selectend on the session.
     * ndc: [-1..1, -1..1] (0,0 = screen centre). This is a TEST DOUBLE of Chrome-Android behaviour, not emulation.
     */
    async tapScreen(ndc = [0, 0]) {
      return page.evaluate(([nx, ny]) => new Promise((resolve, reject) => {
        const I = globalThis.IWER, dev = globalThis.__iwerDevice;
        const session = dev.activeSession;
        if (!session) return reject(new Error('no active session'));
        session.requestAnimationFrame((t, frame) => {
          try {
            const tanY = Math.tan(dev.fovy / 2), cd = dev.canvasDimensions || { width: innerWidth, height: innerHeight };
            const d = [nx * tanY * (cd.width / cd.height), ny * tanY, -1];
            const len = Math.hypot(...d); d[0] /= len; d[1] /= len; d[2] /= len;
            // basis with -Z = d, up = +Y  (column-major mat4)
            const z = [-d[0], -d[1], -d[2]];
            let x = Math.abs(z[1]) > 0.999 ? [1, 0, 0] : [z[2], 0, -z[0]]; const xl = Math.hypot(...x) || 1; x = x.map((c) => c / xl); // |z.y|~1 => straight up/down: pick +X
            const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
            const m = new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1]);
            const space = new I.XRSpace(dev.viewerSpace, m);
            const src = new I.XRInputSource('none', 'screen', [], space);
            const ps = session[I.P_SESSION];
            ps.activeInputSources.push(src);
            session.dispatchEvent(new I.XRInputSourcesChangeEvent('inputsourceschange', { session, added: [src], removed: [] }));
            for (const type of ['selectstart', 'select', 'selectend']) session.dispatchEvent(new I.XRInputSourceEvent(type, { frame, inputSource: src }));
            resolve({ ok: true, dir: d.map((v) => +v.toFixed(3)) });
          } catch (e) { reject(e); }
        });
      }), ndc);
    },
    /** SEM helpers (only when installXR({sem})). */
    sem: {
      /** Replace the synthetic environment with a JSON scene (see floorEnvironment()). */
      load: (json) => page.evaluate((j) => { globalThis.__iwerSem.loadEnvironment(j); globalThis.__iwerSem.scene.updateMatrixWorld(true); }, json),
      /** Show the environment planes/boxes (debug draw in the emulator canvas). */
      show: (v = true) => page.evaluate((b) => { globalThis.__iwerSem.planesVisible = b; globalThis.__iwerSem.boundingBoxesVisible = b; }, v),
      /** Direct ray query against the synthetic environment: origin+dir in XR space -> hit positions (no session needed). */
      raycast: (origin, dir) => page.evaluate(([o, d]) => {
        const I = globalThis.IWER, sem = globalThis.__iwerSem; // build a ray pose matrix: origin + rotation taking -Z to dir
        const z = [-d[0], -d[1], -d[2]]; const zl = Math.hypot(...z); z[0] /= zl; z[1] /= zl; z[2] /= zl;
        let x = Math.abs(z[1]) > 0.999 ? [1, 0, 0] : [z[2], 0, -z[0]]; const xl = Math.hypot(...x) || 1; x = x.map((c) => c / xl);
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        const m = new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]);
        return sem.computeHitTestResults(m).map((mm) => [mm[12], mm[13], mm[14]]);
      }, [origin, dir]),
    },
  };
  async function deviceId(hand) {
    const st = await page.evaluate(() => globalThis.__iwerDevice.primaryInputMode);
    return `${st === 'hand' ? 'hand' : 'controller'}-${hand}`;
  }
  return driver;
}

const v3 = (a) => (Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] } : a);
