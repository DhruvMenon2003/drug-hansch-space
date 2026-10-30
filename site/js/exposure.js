// Layer 1. Steady-state exposure arithmetic: the one place a dose becomes a concentration on this page.
//
// The therapeutic index elsewhere on this page is a ratio of two in-vitro potencies, and it says nothing about dose.
// These functions are what it takes to say something about dose: a dose, a dosing interval, a bioavailability for
// the route it is given by, and the molecule's own measured human clearance and fraction unbound turn into an
// average free plasma concentration, which can finally be put next to the hERG potency and the activity.
//
// Everything here is average steady state, never a peak. A Cmax is higher than the average by a factor that depends
// on absorption and on the interval, and the margin that regulators ask about is a Cmax margin, so a margin computed
// here is the friendlier of the two numbers and is labelled as such wherever it is shown.
//
// Pure arithmetic, no DOM, no state: every input arrives as an argument so the whole of it can be tested.
import { fin } from './kernel.js';

/** A free fraction is a fraction. Anything outside (0, 1] is not one, whatever the table says. */
export const isFu = v => fin(v) && v > 0 && v <= 1;

/**
 * Average total plasma concentration at steady state, in mg/L.
 *
 *     Css = F · Dose / (CL · tau)
 *
 * with CL in mL/min/kg scaled by body weight, which is how the measured human table reports it: those clearances
 * come from intravenous studies, so they are systemic clearances and F belongs on the dose, not on them.
 * @param {{dose: number, tau: number, f: number, cl: number, weight: number}} o dose mg, interval h, F 0-1,
 *   clearance mL/min/kg, weight kg  @returns {number|null} mg/L, or null when an input is missing or impossible
 */
export function cssTotal({ dose, tau, f, cl, weight = 70 }) {
  if (![dose, tau, f, cl, weight].every(fin)) return null;
  if (dose <= 0 || tau <= 0 || cl <= 0 || weight <= 0 || f <= 0 || f > 1) return null;
  const clLh = cl * 0.06 * weight;                 // mL/min/kg -> L/h
  return (f * dose) / (clLh * tau);
}

/** mg/L to mol/L for a molecule of this molar mass. */
export const molar = (mgPerL, mw) => (fin(mgPerL) && fin(mw) && mw > 0 ? mgPerL / (mw * 1000) : null);

/** mol/L as a p-value (-log10), the scale the activity and hERG numbers are already on. */
export const pOf = c => (fin(c) && c > 0 ? -Math.log10(c) : null);

/**
 * The whole chain for one drug on one route: dose to free concentration to the two margins.
 *
 * Both margins are differences on the p-scale, where a larger number is a smaller concentration, so they read as
 * free exposure minus potency: the hERG margin is log10(hERG IC50 / free concentration), and 1.5 is the thirtyfold
 * gap usually quoted as the bar for a peak concentration. This is an average, so the same number here is the weaker
 * claim. `coverage` is the same difference against the activity: positive means the free concentration sits below
 * the concentration the molecule needs in a dish to act on its target, which is true of many real drugs and is a
 * statement about an assay, not a verdict on whether the drug works.
 * @returns {{css: number, cssMolar: number, free: number, pFree: number, margin: number|null,
 *   coverage: number|null, fold: number|null}|null}
 */
export function exposure({ dose, tau, f, cl, fu, mw, weight = 70, herg = null, act = null }) {
  const css = cssTotal({ dose, tau, f, cl, weight });
  if (css === null || !isFu(fu)) return null;
  const cssMolar = molar(css, mw);
  if (cssMolar === null) return null;
  const free = cssMolar * fu;
  const pFree = pOf(free);
  if (pFree === null) return null;
  const margin = fin(herg) ? pFree - herg : null;        // p-scale: larger p is a smaller concentration
  return {
    css, cssMolar, free, pFree,
    margin,
    coverage: fin(act) ? pFree - act : null,
    fold: margin === null ? null : 10 ** margin,
  };
}

/**
 * Bioavailability by route. Only one route sets F without an experiment, and it sets it by definition; every other
 * route has to be told, because F is a property of a formulation and a person, not of a route, and guessing one
 * here would put a number on the page that no measurement stands behind.
 */
export const F_BY_ROUTE = {
  INTRAVENOUS: 1, INTRAVASCULAR: 1, INTRACARDIAC: 1, INTRA_ARTERIAL: 1, 'INTRA-ARTERIAL': 1,
};
export const routeF = route => F_BY_ROUTE[String(route || '').toUpperCase().replace(/\s+/g, '_')] ?? null;
/** Short enough for a table cell; the panel's own copy carries the full reason once, above the table. */
export const routeFWhy = route => (routeF(route) === 1 ? 'by definition' : 'your assumption');

/**
 * How much the margin moves when a guessed input is wrong by a factor. Exposure is linear in F and in dose and
 * inverse in clearance, so every one of them moves the margin by the same log10, which is worth showing next to a
 * number the reader had to assume.
 */
export const shift = factor => (fin(factor) && factor > 0 ? Math.log10(factor) : null);
