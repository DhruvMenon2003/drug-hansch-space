// ---------- frontispiece: the molecule ----------
// Drawn at once as a flat ball-and-stick projection; a lit 3D version replaces it when an engine has loaded.
// Both read the same orientation, so the swap does not jump. No engine, no problem: the flat drawing stays,
// and it turns too. The build names the engine: PlayCanvas fetched from a CDN for the one-file page, or the
// host site's own copy of three.js where nothing may be loaded from another origin.
(() => {
  const M = STUDY.molecule, fig = $('fig-molecule');
  if (!M || !fig) return;
  const stage = fig.querySelector('.stage'), flat = fig.querySelector('canvas.flat'), ctx = flat.getContext('2d');
  const HERO = /*__HERO_ENGINE__*/null; // { kind: 'playcanvas' | 'three', src }
  const FOV = 24, DIST = 21.5; // degrees, ångström
  const RADIUS = { C: 0.43, N: 0.41, O: 0.40, S: 0.52, H: 0.25 }, BOND = 0.105;
  const dark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = () => ({ C: dark() ? '#a3a9b1' : '#50555c', H: dark() ? '#eef0f2' : '#e3e6e9', N: css('--c2'), O: css('--c1'), S: dark() ? '#e0bf55' : '#c9a227', bond: dark() ? '#7b828b' : '#9aa0a7' });
  const view = { yaw: -0.55, pitch: 0.3, vy: 0, vp: 0, held: false, idle: 3, dirty: true };

  // ----- flat projection -----
  let W = 0, H = 0;
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth; H = stage.clientHeight;
    flat.width = Math.round(W * dpr); flat.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.dirty = true;
  };
  function turn(p) { // yaw about the vertical axis, then pitch about the horizontal one
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const x = p[0] * cy + p[2] * sy, z0 = -p[0] * sy + p[2] * cy;
    return [x, p[1] * cp - z0 * sp, p[1] * sp + z0 * cp];
  }
  function shade(hex, t) { // t > 0 lightens, t < 0 darkens
    const n = parseInt(hex.slice(1), 16), ch = [n >> 16 & 255, n >> 8 & 255, n & 255];
    return 'rgb(' + ch.map((v) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t))).join(',') + ')';
  }
  function drawFlat() {
    const pal = palette(), f = (H / 2) / Math.tan(FOV * Math.PI / 360);
    const P = M.atoms.map((a) => { const q = turn(a.slice(1)), s = f / (DIST - q[2]); return { el: a[0], q, s, x: W / 2 + q[0] * s, y: H / 2 - q[1] * s }; });
    const items = P.map((p) => ({ z: p.q[2], atom: p }));
    M.bonds.forEach(([i, j, order]) => {
      const a = P[i], b = P[j], d = [b.q[0] - a.q[0], b.q[1] - a.q[1], b.q[2] - a.q[2]], len = Math.hypot(...d);
      const ta = RADIUS[a.el] * 0.85 / len, tb = 1 - RADIUS[b.el] * 0.85 / len;
      const pt = (t) => { const z = a.q[2] + d[2] * t, s = f / (DIST - z); return [W / 2 + (a.q[0] + d[0] * t) * s, H / 2 - (a.q[1] + d[1] * t) * s, s]; };
      items.push({ z: (a.q[2] + b.q[2]) / 2 - 0.01, bond: [pt(ta), pt(tb)], order });
    });
    items.sort((u, v) => u.z - v.z);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.bond) {
        const [p, q] = it.bond, s = (p[2] + q[2]) / 2, nx = -(q[1] - p[1]), ny = q[0] - p[0], nl = Math.hypot(nx, ny) || 1;
        const offs = it.order === 2 ? [-1, 1] : [0];
        ctx.strokeStyle = pal.bond; ctx.lineWidth = BOND * 2 * s * (it.order === 2 ? 0.72 : 1);
        for (const o of offs) {
          const ox = nx / nl * o * BOND * 1.5 * s, oy = ny / nl * o * BOND * 1.5 * s;
          ctx.beginPath(); ctx.moveTo(p[0] + ox, p[1] + oy); ctx.lineTo(q[0] + ox, q[1] + oy); ctx.stroke();
        }
      } else {
        const a = it.atom, r = RADIUS[a.el] * a.s, col = pal[a.el] || pal.C;
        const g = ctx.createRadialGradient(a.x - r * 0.35, a.y - r * 0.4, r * 0.1, a.x, a.y, r);
        g.addColorStop(0, shade(col, 0.5)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.28));
        ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      }
    }
  }

  // ----- the lit version -----
  let live = null;
  const hex01 = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const strands = (order) => (order === 2 ? [-1, 1] : [0]);
  function startThree(THREE) {
    const gl = el('canvas', { class: 'gl', 'aria-hidden': 'true' });
    stage.append(gl);
    const renderer = new THREE.WebGLRenderer({ canvas: gl, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(FOV, 1, 1, 60);
    cam.position.set(0, 0, DIST);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const lamp = (euler, intensity) => { const l = new THREE.DirectionalLight(0xffffff, intensity); const e = new THREE.Euler(...euler.map((d) => d * Math.PI / 180)); l.position.set(0, 0, 1).applyEuler(e).multiplyScalar(10); scene.add(l); };
    lamp([-48, 32, 0], 2.6); lamp([30, -140, 0], 0.9);
    const mats = {};
    const paint = () => {
      const pal = palette();
      for (const k of Object.keys(pal)) {
        const m = mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ metalness: 0 }));
        m.color.setRGB(...hex01(pal[k]), THREE.SRGBColorSpace); m.roughness = k === 'bond' ? 0.75 : 0.5; m.needsUpdate = true;
      }
    };
    paint();
    const mol = new THREE.Group();
    scene.add(mol);
    const sphere = new THREE.SphereGeometry(1, 36, 24), tube = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
    M.atoms.forEach(([sym, x, y, z]) => {
      const m = new THREE.Mesh(sphere, mats[sym] || mats.C), r = RADIUS[sym] || 0.4;
      m.position.set(x, y, z); m.scale.setScalar(r); mol.add(m);
    });
    const up = new THREE.Vector3(0, 1, 0);
    M.bonds.forEach(([i, j, order]) => {
      const a = new THREE.Vector3(...M.atoms[i].slice(1)), b = new THREE.Vector3(...M.atoms[j].slice(1));
      const dir = b.clone().sub(a), len = dir.length(); dir.normalize();
      const mid = a.clone().add(b).multiplyScalar(0.5), q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const side = dir.clone().cross(Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
      strands(order).forEach((o) => {
        const m = new THREE.Mesh(tube, mats.bond), t = BOND * (order === 2 ? 0.72 : 1);
        m.position.copy(mid).addScaledVector(side, o * BOND * 1.5); m.quaternion.copy(q); m.scale.set(t, len, t); mol.add(m);
      });
    });
    const pose = () => { mol.rotation.set(view.pitch, view.yaw, 0, 'XYZ'); renderer.render(scene, cam); };
    const size = () => { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); pose(); };
    new ResizeObserver(size).observe(stage);
    size(); pose();
    requestAnimationFrame(() => fig.classList.add('live'));
    live = { pose, paint: () => { paint(); pose(); } };
    window.__hero = { engine: 'three r' + THREE.REVISION, entities: mol.children.length };
  }
  function startPlayCanvas(pc) {
    const gl = el('canvas', { class: 'gl', 'aria-hidden': 'true' });
    stage.append(gl);
    const app = new pc.Application(gl, { graphicsDeviceOptions: { alpha: true, antialias: true, powerPreference: 'low-power' } });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    app.autoRender = false;
    app.scene.ambientLight = new pc.Color(0.5, 0.52, 0.56);
    const cam = new pc.Entity('camera');
    cam.addComponent('camera', { clearColor: new pc.Color(0, 0, 0, 0), fov: FOV, nearClip: 1, farClip: 60 });
    cam.setPosition(0, 0, DIST);
    app.root.addChild(cam);
    const lamp = (name, euler, intensity) => { const e = new pc.Entity(name); e.addComponent('light', { type: 'directional', color: new pc.Color(1, 1, 1), intensity, castShadows: false }); e.setEulerAngles(...euler); app.root.addChild(e); };
    lamp('key', [48, 32, 0], 1.25); lamp('rim', [-30, -140, 0], 0.45);
    const mats = {};
    const colour = (hex) => new pc.Color(...hex01(hex));
    const paint = () => {
      const pal = palette();
      for (const k of Object.keys(pal)) {
        const m = mats[k] || (mats[k] = new pc.StandardMaterial());
        m.diffuse = colour(pal[k]); m.useMetalness = false; m.specular = new pc.Color(0.22, 0.22, 0.22); m.gloss = k === 'bond' ? 0.35 : 0.62;
        m.update();
      }
    };
    paint();
    const mol = new pc.Entity('molecule');
    app.root.addChild(mol);
    M.atoms.forEach(([sym, x, y, z]) => {
      const e = new pc.Entity(sym), d = 2 * (RADIUS[sym] || 0.4);
      e.addComponent('render', { type: 'sphere', material: mats[sym] || mats.C });
      e.setLocalPosition(x, y, z); e.setLocalScale(d, d, d); mol.addChild(e);
    });
    const up = new pc.Vec3(0, 1, 0);
    M.bonds.forEach(([i, j, order]) => {
      const a = new pc.Vec3(...M.atoms[i].slice(1)), b = new pc.Vec3(...M.atoms[j].slice(1));
      const dir = new pc.Vec3().sub2(b, a), len = dir.length(); dir.normalize();
      const mid = new pc.Vec3().add2(a, b).mulScalar(0.5);
      const axis = new pc.Vec3().cross(up, dir), q = new pc.Quat();
      if (axis.length() < 1e-6) q.setFromAxisAngle(pc.Vec3.RIGHT, dir.y > 0 ? 0 : 180);
      else q.setFromAxisAngle(axis.normalize(), Math.acos(clamp(dir.y, -1, 1)) * 180 / Math.PI);
      // a second strand for double bonds, offset sideways in the plane the neighbours define
      const side = new pc.Vec3().cross(dir, Math.abs(dir.z) < 0.9 ? pc.Vec3.BACK : pc.Vec3.RIGHT).normalize();
      strands(order).forEach((o) => {
        const e = new pc.Entity('bond'), t = BOND * 2 * (order === 2 ? 0.72 : 1);
        e.addComponent('render', { type: 'cylinder', material: mats.bond });
        e.setLocalPosition(mid.x + side.x * o * BOND * 1.5, mid.y + side.y * o * BOND * 1.5, mid.z + side.z * o * BOND * 1.5);
        e.setLocalRotation(q); e.setLocalScale(t, len, t); mol.addChild(e);
      });
    });
    const qx = new pc.Quat(), qy = new pc.Quat();
    const pose = () => {
      qx.setFromAxisAngle(pc.Vec3.RIGHT, view.pitch * 180 / Math.PI); qy.setFromAxisAngle(pc.Vec3.UP, view.yaw * 180 / Math.PI);
      mol.setLocalRotation(qx.mul(qy));
      app.renderNextFrame = true;
    };
    const size = () => { app.resizeCanvas(stage.clientWidth, stage.clientHeight); app.renderNextFrame = true; };
    new ResizeObserver(size).observe(stage);
    app.start(); size(); pose();
    app.once('frameend', () => fig.classList.add('live'));
    live = { pose, paint: () => { paint(); app.renderNextFrame = true; } };
    window.__hero = { engine: 'playcanvas ' + pc.version, entities: mol.children.length };
  }
  function loadEngine() {
    if (!HERO || !HERO.src) return;
    const net = navigator.connection;
    if (net && net.saveData) return;
    try { if (!document.createElement('canvas').getContext('webgl2')) return; } catch { return; }
    const fail = (err) => console.warn('3D view unavailable, keeping the flat drawing.', err);
    if (HERO.kind === 'three') { import(HERO.src).then((THREE) => { try { startThree(THREE); } catch (err) { fail(err); } }, fail); return; }
    const s = document.createElement('script');
    s.async = true;
    s.onload = () => { try { startPlayCanvas(window.pc); } catch (err) { fail(err); } };
    s.onerror = fail;
    s.src = HERO.src;
    document.head.append(s);
  }
  // Fetch the engine only when the molecule is on screen and the browser is idle.
  const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600));
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    if (document.readyState === 'complete') whenIdle(loadEngine); else window.addEventListener('load', () => whenIdle(loadEngine), { once: true });
  }).observe(fig);

  // ----- turning it -----
  let lx = 0, ly = 0, pid = null;
  stage.addEventListener('pointerdown', (e) => { pid = e.pointerId; lx = e.clientX; ly = e.clientY; view.held = true; view.vy = view.vp = 0; try { stage.setPointerCapture(pid); } catch { /* best effort */ } });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    view.yaw += dx * 0.011; view.pitch = clamp(view.pitch + dy * 0.011, -1.35, 1.35);
    view.vy = dx * 0.011 * 60; view.vp = dy * 0.011 * 60; view.idle = 0; view.dirty = true;
  });
  const release = (e) => { if (e.pointerId === pid) { pid = null; view.held = false; } };
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  stage.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-0.16, 0], ArrowRight: [0.16, 0], ArrowUp: [0, -0.16], ArrowDown: [0, 0.16] }[e.key];
    if (!step) return;
    e.preventDefault();
    view.yaw += step[0]; view.pitch = clamp(view.pitch + step[1], -1.35, 1.35); view.idle = 0; view.dirty = true;
  });
  animate(fig, (time, dt) => {
    if (!view.held) {
      if (Math.abs(view.vy) + Math.abs(view.vp) > 0.01) { // coast after a flick
        view.yaw += view.vy * dt; view.pitch = clamp(view.pitch + view.vp * dt, -1.35, 1.35);
        const k = Math.exp(-4.5 * dt); view.vy *= k; view.vp *= k; view.dirty = true;
      } else if (!calm.matches) {
        view.idle += dt;
        if (view.idle > 2.5) { view.yaw += 0.14 * dt; view.dirty = true; } // slow turn when left alone
      }
    }
    if (!view.dirty) return;
    view.dirty = false;
    if (live) live.pose(); else drawFlat();
  });
  new ResizeObserver(fit).observe(stage);
  fit(); drawFlat();
  redraws.push(() => { view.dirty = true; if (live) live.paint(); });
})();
