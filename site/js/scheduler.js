// Layer 0. Render-on-demand scheduler. A pure frame pump: it knows nothing about three.js or the page, only about
// requestAnimationFrame, the tab's visibility and a `render(t, dt)` callback that answers "do you want another frame?".
//
//   invalidate()          ask for one frame (coalesced: at most one rAF is ever pending)
//   hold(key) / release   keep frames coming while something outside the render function is animating (Spin, a tween)
//   setXR(true)           an XR session owns the loop: this scheduler schedules nothing until setXR(false)
//   pause() / resume()    same for context loss
//   setOnIdle(fn)         called once, `idleMs` after the last frame when nothing asked for more (crisp-frame hook)
//   renderNow()           render synchronously (a resize clears the drawing buffer; a blank canvas must never be visible)
//
// When render() returns false and nothing is held there is NO rAF pending: 0 callbacks per second at idle.
// `dt` passed to render() is the gap since the previous frame only when that frame asked for this one (a continuous
// run); after a pause it is 0, so frame-time governors never see idle gaps.

/**
 * @param {{ doc?: Document|null, raf?: (cb: (t: number) => void) => number, caf?: (id: number) => void, idleMs?: number }} [opts]
 * @returns {{
 *   setRender(fn: (t: number, dt: number) => boolean|void): void, setOnIdle(fn: (() => void)|null): void,
 *   invalidate(): void, renderNow(): void, hold(key: string): void, release(key: string): void,
 *   setXR(on: boolean): void, pause(): void, resume(): void, dispose(): void,
 *   readonly active: boolean, readonly pending: boolean, readonly xr: boolean, readonly paused: boolean,
 *   stats: { frames: number, scheduled: number, idles: number, renderNow: number },
 * }}
 */
export function createScheduler({ doc = typeof document !== 'undefined' ? document : null, raf, caf, idleMs = 200 } = {}) {
  const request = raf || (cb => requestAnimationFrame(cb)), cancel = caf || (id => cancelAnimationFrame(id));
  const stats = { frames: 0, scheduled: 0, idles: 0, renderNow: 0 };
  const holds = new Set();
  let render = () => false, onIdle = null, rafId = 0, idleTimer = 0, xr = false, paused = false, continuous = false, lastT = 0, disposed = false, running = false;

  const hidden = () => !!doc && doc.hidden === true;
  const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; } };
  function schedule() {
    clearIdle();
    if (rafId || xr || paused || disposed || hidden()) return;
    stats.scheduled++;
    rafId = request(tick);
  }
  function armIdle() {
    clearIdle();
    if (!onIdle) return;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (!rafId && !holds.size && !xr && !paused && !disposed && !hidden()) { stats.idles++; onIdle?.(); }
    }, idleMs);
  }
  function run(t, isNow) {
    const dt = continuous && lastT ? t - lastT : 0;
    lastT = t;
    let more = false;
    running = true;
    try { more = render(t, dt) === true; }
    catch (err) { console.error('render failed', err); }   // a throwing frame must not wedge the pump
    finally { running = false; }
    continuous = more || holds.size > 0;
    if (!isNow) stats.frames++;
    if (continuous) schedule();
    else if (!rafId) armIdle();
  }
  function tick(t) {
    rafId = 0;
    if (xr || paused || disposed) return;
    run(t, false);
  }
  const onVisible = () => { if (!hidden()) { continuous = false; schedule(); } };
  doc?.addEventListener('visibilitychange', onVisible);

  return {
    setRender(fn) { render = fn; },
    setOnIdle(fn) { onIdle = fn; },
    invalidate: schedule,
    renderNow() {
      if (xr || paused || disposed) return;
      if (running) { schedule(); return; }          // asked from inside render(): draw again next frame instead of recursing
      stats.renderNow++;
      run(typeof performance !== 'undefined' ? performance.now() : 0, true);
    },
    hold(key) { holds.add(key); schedule(); },
    release(key) { holds.delete(key); },
    setXR(on) {
      xr = !!on;
      if (xr) { if (rafId) { cancel(rafId); rafId = 0; } clearIdle(); continuous = false; }
      else schedule();
    },
    pause() { paused = true; if (rafId) { cancel(rafId); rafId = 0; } clearIdle(); continuous = false; },
    resume() { paused = false; schedule(); },
    dispose() {
      disposed = true;
      if (rafId) { cancel(rafId); rafId = 0; }
      clearIdle();
      doc?.removeEventListener('visibilitychange', onVisible);
    },
    get active() { return !!rafId || holds.size > 0; },
    get pending() { return !!rafId; },
    get xr() { return xr; },
    get paused() { return paused; },
    stats,
  };
}
