// Layer 3. The guided tour: scroll position picks the step, the step sets the view and the camera.
// ScrollTrigger is still the scroll driver at this stage (a classic script that provides window.ScrollTrigger).
import { app, bus, narrow, STEPS } from './kernel.js';
import { setView } from './view.js';

/** Activate tour step `name`: highlight its text, apply its view and ask the scene to fly to its camera pose. */
export function goStep(name) {
  if (app.step === name) return;
  app.step = name;
  document.querySelectorAll('.step').forEach(s => s.classList.toggle('is-active', s.dataset.step === name));
  const st = STEPS[name], gv = st.view.group === 'SERIES' ? app.seriesId : st.view.group ?? null;
  setView({ l1: '', l2: '', l3: '', route: '', small: false, veber: false, ...st.view, group: gv });
  bus.emit('cmd:camera', { preset: name });
}

/** Hook the eight steps to the scroll position and show step 1. */
export function initTour() {
  const { gsap, ScrollTrigger } = window;
  if (!ScrollTrigger) { goStep('space'); return; }
  gsap.registerPlugin(ScrollTrigger);
  document.querySelectorAll('.step').forEach(el => {
    ScrollTrigger.create({
      trigger: el, start: () => (narrow.matches ? 'top 66%' : 'top 62%'), end: () => (narrow.matches ? 'bottom 66%' : 'bottom 62%'),
      onToggle: self => { if (self.isActive) goStep(el.dataset.step); },
    });
  });
  if (!app.step) goStep('space');
  narrow.addEventListener('change', () => window.ScrollTrigger?.refresh());
}
