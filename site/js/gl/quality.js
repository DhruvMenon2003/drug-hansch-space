// GL layer helper (imports nothing, so it is unit-testable in node). The adaptive resolution governor.
//
// Rungs: the device pixel ratio capped at 2, then 1.5, 1 and 0.75 (never below 0.75, never above min(devicePixelRatio, 2)).
// Frame times arrive only from continuous runs (the scheduler hands over dt = 0 after a pause), smoothed with an EMA:
//   - one rung down when the EMA stays above 24 ms for 20 frames in a row (a frame time no display refresh explains),
//   - one rung up when the EMA stays "fast" for 90 frames in a row, where fast means within 1.25 x the display's refresh
//     interval. The interval is measured, not assumed: the 10th percentile of the last 120 rAF gaps, clamped to 6.9 to 17 ms
//     (a 144 Hz to a 60 Hz display). An absolute threshold (the first version used 12 ms) can never be met on a 60 Hz display,
//     whose frames come every 16.7 ms at best, so the page would never have recovered after a transient slowdown.
//   - anything between "fast" and 24 ms resets both counters (hysteresis); the band is narrow on a 60 Hz display (20.8 to 24 ms).
//   - flap guard: a rise that is followed by a drop within 600 frames doubles the number of fast frames the next rise needs
//     (up to 32 x), so a device that is fast at one rung and slow at the next does not toggle the canvas size every two seconds.
// After 200 ms without interaction the page renders one crisp frame at the full cap (`idle()`); the next continuous
// frame returns to the rung the governor learned (`active()`), so a slow machine does not pay for the crisp frame twice.

export const HI_MS = 24, DROP_FRAMES = 20, RISE_FRAMES = 90, FLOOR = 0.75, RUNGS = [2, 1.5, 1, 0.75];
/** Refresh-interval estimate: clamp range (ms), the "fast" factor, the default until enough gaps are seen, the window and its quantile. */
export const INTERVAL_MIN = 6.9, INTERVAL_MAX = 17, FAST_FACTOR = 1.25, DEFAULT_INTERVAL = 16.7, GAP_WINDOW = 120, GAP_MIN_SAMPLES = 16, GAP_QUANTILE = 0.1;
/** Gaps below this are not display refreshes (a callback fired twice in one frame, a test feed): left out of the estimate. */
export const GAP_PLAUSIBLE_MIN = 5;
/** A drop within this many frames of a rise counts as flapping; the rise threshold doubles per flap, at most (1 << MAX_BACKOFF) x. */
export const FLAP_FRAMES = 600, MAX_BACKOFF = 5;

/** Rungs for a device pixel ratio: the cap first, then every fixed rung below it. */
export function ladder(dpr, cap = 2) {
  const top = Math.min(dpr || 1, cap);          // the cap always wins; a ratio below the floor (browser zoomed out) is simply the only rung
  const out = [top];
  for (const r of RUNGS) if (r < top - 1e-6 && r >= FLOOR - 1e-6) out.push(r);
  return out;
}

/** The EMA a fresh verdict starts from: inside the hysteresis band of a 60 Hz display, so it counts for neither side. */
const NEUTRAL_EMA = 18;

/**
 * @param {{ dpr?: number, apply: (ratio: number) => void }} o  apply() must resize the renderer AND draw before the next paint
 */
export function createGovernor({ dpr = 1, apply }) {
  let rungs = ladder(dpr), level = 0, ema = NEUTRAL_EMA, hi = 0, lo = 0, crisp = false, injectOnly = false;
  let gaps = [], interval = DEFAULT_INTERVAL, sinceEstimate = 0;    // refresh-interval estimate from recent rAF gaps
  let frames = 0, lastRise = -Infinity, backoff = 0;                // flap guard
  const ratio = () => rungs[Math.min(level, rungs.length - 1)];
  /** 10th percentile of the recent gaps, clamped to what real displays do (144 Hz .. 60 Hz). */
  const estimate = () => {
    if (gaps.length < GAP_MIN_SAMPLES) return DEFAULT_INTERVAL;
    const sorted = [...gaps].sort((a, b) => a - b);
    return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, sorted[Math.floor((sorted.length - 1) * GAP_QUANTILE)]));
  };
  const gov = {
    /** The pixel ratio the renderer should currently use (full cap while crisp). */
    get ratio() { return crisp ? rungs[0] : ratio(); },
    get level() { return level; },
    /** The rung the governor has settled on (differs from `ratio` only while the idle crisp frame is shown). */
    get learned() { return ratio(); },
    get ema() { return ema; },
    get rungs() { return [...rungs]; },
    get crisp() { return crisp; },
    /** The measured display refresh interval in ms (default 16.7 until 16 gaps were seen). */
    get interval() { return interval; },
    /** An EMA at or below this many ms counts as fast: 1.25 x the refresh interval. */
    get fastMs() { return FAST_FACTOR * interval; },
    /** Consecutive fast frames the next rise needs (90, doubled per recent flap). */
    get riseNeed() { return RISE_FRAMES * 2 ** backoff; },
    /** Feed one frame time in ms. Returns true when the pixel ratio changed (apply() has been called). */
    sample(dt, fromScheduler = false) {
      if (fromScheduler && injectOnly) return false;
      if (!(dt > 0) || dt > 2000) return false;
      frames++;
      if (dt >= GAP_PLAUSIBLE_MIN) {
        gaps.push(dt);
        if (gaps.length > GAP_WINDOW) gaps.shift();
        if (++sinceEstimate >= 8 || gaps.length === GAP_MIN_SAMPLES) { sinceEstimate = 0; interval = estimate(); }
      }
      ema = ema * 0.9 + dt * 0.1;
      if (ema > HI_MS) { hi++; lo = 0; } else if (ema <= FAST_FACTOR * interval) { lo++; hi = 0; } else { hi = lo = 0; }
      if (hi >= DROP_FRAMES && level < rungs.length - 1) {
        backoff = frames - lastRise < FLAP_FRAMES ? Math.min(backoff + 1, MAX_BACKOFF) : 0;
        return gov._move(level + 1);
      }
      if (lo >= gov.riseNeed && level > 0) { lastRise = frames; return gov._move(level - 1); }
      if (hi >= DROP_FRAMES || lo >= gov.riseNeed) hi = lo = 0;      // nothing to move to (the floor, the cap): do not count for ever
      return false;
    },
    _move(next) {
      level = next;
      hi = lo = 0;
      ema = NEUTRAL_EMA;           // a new resolution gets a fresh verdict
      if (!crisp) apply(ratio());
      return true;
    },
    /** 200 ms of calm: show the full-resolution frame. Returns true when the ratio changed. */
    idle() {
      if (level === 0 || crisp) return false;
      crisp = true;
      apply(rungs[0]);
      return true;
    },
    /** Interaction resumed: go back to the learned rung. Returns true when the ratio changed. */
    active() {
      if (!crisp) return false;
      crisp = false;
      apply(ratio());
      return true;
    },
    /** The device pixel ratio changed (browser zoom, another monitor): rebuild the rungs, keep the level when possible. */
    setDpr(next) {
      const was = gov.ratio;
      rungs = ladder(next);
      level = Math.min(level, rungs.length - 1);
      hi = lo = 0;
      if (Math.abs(gov.ratio - was) > 1e-6) { apply(gov.ratio); return true; }
      return false;
    },
    /** Forget everything learned and return to the full cap (tests start from a known state). Returns true when the ratio changed. */
    reset() {
      const was = gov.ratio;
      level = 0; hi = lo = 0; ema = NEUTRAL_EMA; crisp = false;
      gaps = []; interval = DEFAULT_INTERVAL; sinceEstimate = 0; frames = 0; lastRise = -Infinity; backoff = 0;
      if (Math.abs(rungs[0] - was) > 1e-6) { apply(rungs[0]); return true; }
      return false;
    },
    /** Tests: ignore real frame times so injected ones are the only input. */
    injectOnly(on) { injectOnly = !!on; },
  };
  return gov;
}
