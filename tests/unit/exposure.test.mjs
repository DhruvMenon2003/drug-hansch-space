import test from 'node:test';
import assert from 'node:assert/strict';
import { cssTotal, exposure, isFu, molar, pOf, routeF, routeFWhy, shift } from '../../site/js/exposure.js';

// 100 mg once a day into a 70 kg person whose clearance is 10 mL/min/kg: 10 x 0.06 x 70 = 42 L/h, so
// (100 mg / 24 h) / 42 L/h = 0.09921 mg/L. Every other number below hangs off that one.
const BASE = { dose: 100, tau: 24, f: 1, cl: 10, weight: 70 };

test('steady-state concentration is dose over clearance and interval', () => {
  assert.ok(Math.abs(cssTotal(BASE) - 0.099206) < 1e-6);
  assert.equal(cssTotal({ ...BASE, f: 0.5 }), cssTotal(BASE) / 2);          // linear in F
  assert.equal(cssTotal({ ...BASE, dose: 200 }), cssTotal(BASE) * 2);        // and in dose
  assert.ok(Math.abs(cssTotal({ ...BASE, cl: 20 }) - cssTotal(BASE) / 2) < 1e-12);   // inverse in clearance
});

test('an impossible or missing input gives no number rather than a wrong one', () => {
  for (const bad of [{ dose: 0 }, { tau: 0 }, { cl: -1 }, { f: 0 }, { f: 1.5 }, { weight: 0 }, { dose: undefined }, { cl: NaN }]) {
    assert.equal(cssTotal({ ...BASE, ...bad }), null, JSON.stringify(bad));
  }
});

test('a free fraction has to be a fraction', () => {
  assert.equal(isFu(0.1), true);
  assert.equal(isFu(1), true);
  assert.equal(isFu(0), false);
  assert.equal(isFu(1.2), false);
  assert.equal(isFu(null), false);
});

test('mg/L becomes mol/L through the molar mass, and mol/L becomes a p-value', () => {
  assert.ok(Math.abs(molar(0.099206, 300) - 3.3069e-7) < 1e-11);
  assert.equal(molar(1, 0), null);
  assert.ok(Math.abs(pOf(1e-7) - 7) < 1e-12);
  assert.equal(pOf(0), null);
});

test('the margin is the free exposure against the hERG potency, the right way round', () => {
  const e = exposure({ ...BASE, fu: 0.1, mw: 300, herg: 5, act: 8 });
  assert.ok(Math.abs(e.pFree - 7.4806) < 1e-3);
  assert.ok(e.margin > 0, 'a free concentration below the hERG number is a positive margin');
  assert.ok(Math.abs(e.margin - 2.4806) < 1e-3);
  assert.ok(Math.abs(e.fold - 302.4) < 1);                     // about three hundredfold below the hERG number
  assert.ok(Math.abs(e.coverage + 0.519) < 1e-3);              // and a little above the concentration it acts at
});

test('ten times the dose eats exactly one log unit of margin', () => {
  const low = exposure({ ...BASE, fu: 0.1, mw: 300, herg: 5 });
  const high = exposure({ ...BASE, dose: 1000, fu: 0.1, mw: 300, herg: 5 });
  assert.ok(Math.abs((low.margin - high.margin) - 1) < 1e-9);
  assert.ok(Math.abs(shift(10) - 1) < 1e-12);
  assert.ok(Math.abs(shift(2) - 0.30103) < 1e-5);
  assert.equal(shift(0), null);
});

test('exposure refuses when a measured input is missing, and says nothing instead', () => {
  assert.equal(exposure({ ...BASE, fu: null, mw: 300, herg: 5 }), null);
  assert.equal(exposure({ ...BASE, fu: 0.1, mw: null, herg: 5 }), null);
  assert.equal(exposure({ ...BASE, dose: 0, fu: 0.1, mw: 300, herg: 5 }), null);
  const noHerg = exposure({ ...BASE, fu: 0.1, mw: 300 });
  assert.equal(noHerg.margin, null);                            // the exposure still stands without a potency
  assert.ok(noHerg.pFree > 0);
});

test('only a route that puts the dose in the blood sets its own bioavailability', () => {
  assert.equal(routeF('INTRAVENOUS'), 1);
  assert.equal(routeF('INTRA-ARTERIAL'), 1);
  assert.equal(routeF('ORAL'), null);
  assert.equal(routeF('PARENTERAL'), null);                     // could be any of three routes; it is not an assumption to make
  assert.equal(routeF('RESPIRATORY (INHALATION)'), null);
  assert.equal(routeF(null), null);
  assert.equal(routeFWhy('INTRAVENOUS'), 'by definition');
  assert.equal(routeFWhy('ORAL'), 'your assumption');
});
