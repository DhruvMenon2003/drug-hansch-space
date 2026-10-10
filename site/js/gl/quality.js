// GL layer helper (imports nothing, so it is unit-testable in node). The adaptive resolution governor.
//
// Rungs: the device pixel ratio capped at 2, then 1.5, 1 and 0.75 (never below 0.75, never above min(devicePixelRatio, 2)).
// Frame times arrive only from continuous runs (the scheduler hands over dt = 0 after a pause), smoothed with an EMA:
//   - one rung down when the EMA stays above 24 ms for 20 frames in a row,
//   - one rung up when it stays below 12 ms for 90 frames in a row (hysteresis: 12 < ema < 24 resets both counters).
// After 200 ms without interaction the page renders one crisp frame at the full cap (`idle()`); the next continuous
// frame returns to the rung the governor learned (`active()`), so a slow machine does not pay for the crisp frame twice.

export const HI_MS = 24, LO_MS = 12, DROP_FRAMES = 20, RISE_FRAMES = 90, FLOOR = 0.75, RUNGS = [2, 1.5, 1, 0.75];

/** Rungs for a device pixel ratio: the cap first, then every fixed rung below it. */
export function ladder(dpr, cap = 2) {
  const top = Math.min(dpr || 1, cap);          // the cap always wins; a ratio below the floor (browser zoomed out) is simply the only rung
  const out = [top];
  for (const r of RUNGS) if (r < top - 1e-6 && r >= FLOOR - 1e-6) out.push(r);
  return out;
}

/**
 * @param {{ dpr?: number, apply: (ratio: number) => void }} o  apply() must resize the renderer AND draw before the next paint
 */
export function createGovernor({ dpr = 1, apply }) {
  let rungs = ladder(dpr), level = 0, ema = (HI_MS + LO_MS) / 2, hi = 0, lo = 0, crisp = false, injectOnly = false;
  const ratio = () => rungs[Math.min(level, rungs.length - 1)];
  const gov = {
    /** The pixel ratio the renderer should currently use (full cap while crisp). */
    get ratio() { return crisp ? rungs[0] : ratio(); },
    get level() { return level; },
    /** The rung the governor has settled on (differs from `ratio` only while the idle crisp frame is shown). */
    get learned() { return ratio(); },
    get ema() { return ema; },
    get rungs() { return [...rungs]; },
    get crisp() { return crisp; },
    /** Feed one frame time in ms. Returns true when the pixel ratio changed (apply() has been called). */
    sample(dt, fromScheduler = false) {
      if (fromScheduler && injectOnly) return false;
      if (!(dt > 0) || dt > 2000) return false;
      ema = ema * 0.9 + dt * 0.1;
      if (ema > HI_MS) { hi++; lo = 0; } else if (ema < LO_MS) { lo++; hi = 0; } else { hi = lo = 0; }
      if (hi >= DROP_FRAMES && level < rungs.length - 1) return gov._move(level + 1);
      if (lo >= RISE_FRAMES && level > 0) return gov._move(level - 1);
      if (hi >= DROP_FRAMES || lo >= RISE_FRAMES) hi = lo = 0;
      return false;
    },
    _move(next) {
      level = next;
      hi = lo = 0;
      ema = (HI_MS + LO_MS) / 2;   // a new resolution gets a fresh verdict
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
      level = 0; hi = lo = 0; ema = (HI_MS + LO_MS) / 2; crisp = false;
      if (Math.abs(rungs[0] - was) > 1e-6) { apply(rungs[0]); return true; }
      return false;
    },
    /** Tests: ignore real frame times so injected ones are the only input. */
    injectOnly(on) { injectOnly = !!on; },
  };
  return gov;
}
