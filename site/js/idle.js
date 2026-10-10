// Layer 0. Run work when the browser is idle. requestIdleCallback where it exists, a timer where it does not (Safari), and
// a cooperative slicer for long synchronous jobs so that no single task blocks input for long. Touches no DOM at import time.

/**
 * Call `fn` when the main thread is idle, at the latest after `timeout` ms. Returns a cancel function.
 * Without requestIdleCallback it uses setTimeout(fn, fallbackMs) and passes a deadline object with a 12 ms budget.
 * @param {(deadline: { timeRemaining: () => number, didTimeout: boolean }) => void} fn
 * @param {{ timeout?: number, fallbackMs?: number }} [o]
 * @returns {() => void}
 */
export function whenIdle(fn, { timeout = 2000, fallbackMs = 200 } = {}) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback(id);
  }
  const t0 = performance.now();
  const id = setTimeout(() => fn({ timeRemaining: () => Math.max(0, 12 - (performance.now() - t0)), didTimeout: true }), fallbackMs);
  return () => clearTimeout(id);
}

/** Resolve after the first frame that follows `now` has been painted (rAF, then a task); a hidden tab resolves after 400 ms. */
export function afterPaint() {
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 400);                       // rAF does not run in a background tab
  });
}

/**
 * Run a generator to the end in slices: each slice runs while the idle deadline has more than `minLeft` ms (or until
 * `sliceMs` have passed without a deadline), then the rest waits for the next idle period. The generator yields at points where
 * it is safe to stop; its return value resolves the promise. Rejects when the generator throws; `cancel()` abandons the job.
 * @template T
 * @param {() => Generator<unknown, T, unknown>} makeGen
 * @param {{ sliceMs?: number, minLeft?: number, timeout?: number, fallbackMs?: number }} [o]
 * @returns {{ done: Promise<T>, cancel: () => void }}
 */
export function runSliced(makeGen, { sliceMs = 12, minLeft = 4, timeout = 2000, fallbackMs = 100 } = {}) {
  let cancelWait = () => {}, cancelled = false, gen;
  const done = new Promise((resolve, reject) => {
    const step = deadline => {
      if (cancelled) return;
      try {
        gen ||= makeGen();
        const t0 = performance.now();
        for (;;) {
          const r = gen.next();
          if (r.done) return resolve(r.value);
          const left = deadline?.timeRemaining ? deadline.timeRemaining() : sliceMs;
          if (left < minLeft || performance.now() - t0 >= sliceMs) break;
        }
        cancelWait = whenIdle(step, { timeout, fallbackMs });
      } catch (err) { reject(err); }
    };
    cancelWait = whenIdle(step, { timeout, fallbackMs });
  });
  return { done, cancel() { cancelled = true; cancelWait(); } };
}
