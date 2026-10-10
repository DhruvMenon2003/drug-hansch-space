// Layer 2. Everything the page says when something is missing or still loading: the status line with its progress bar,
// the 2D-only mode (no WebGL, or the 3D layer failed to load) and the fatal-error message. Pure DOM, no three. Every hook
// is optional: a hook the shell has not provided is skipped, never an error, and none is created here (except a text span
// inside the status line, so the <progress> bar the shell put there survives a text change).
import { $ } from './kernel.js';
import { announce } from './announce.js';

/** Replace the status text over the stage (the progress bar inside the status line is kept). */
export function setStatus(text) {
  const el = $('#stage-status');
  if (!el) return;
  let t = el.querySelector('.status-text');
  if (!t) {
    t = document.createElement('span');
    t.className = 'status-text';
    for (const n of [...el.childNodes]) if (n.nodeType === 3) n.remove();
    el.insertBefore(t, el.firstChild);
  }
  t.textContent = text;
}
/** Show the status line again with new text (e.g. while the graphics context is being restored). */
export function showStatus(text) {
  setStatus(text);
  const el = $('#stage-status');
  if (el) el.hidden = false;
}
/** Loading phase 1..4 (data, layout, scene, first frame) on the shell's <progress id="load-progress">. */
export function setProgress(n) {
  const p = $('#load-progress');
  if (p) p.value = n;
}
/** Hide the status line once the scene is ready. */
export function hideStatus() {
  const el = $('#stage-status');
  if (el) el.hidden = true;
}

const NO_WEBGL = 'WebGL is not available in this browser. The 3D view is off; the controls, the data table and the drug search still work.';
const GL_FAILED = 'The 3D view could not be started';

/**
 * 2D-only mode: reveal the shell's #fallback-2d, hide the canvas area and the 3D-only tools, and keep the rest of the
 * app (controls, tour text, Hansch fits, table, drug panel with its 2D depiction) running.
 * @param {'nowebgl'|'load'|'init'} [why] nowebgl: no WebGL context; load: the 3D module failed to load; init: it failed to start
 * @param {unknown} [err] the underlying error, appended to the message for the two failure kinds
 * @returns {string} the message shown
 */
export function showNoWebGL(why = 'nowebgl', err) {
  const detail = err ? ` (${err?.message || err})` : '';
  const msg = why === 'nowebgl' ? NO_WEBGL
    : `${GL_FAILED}${why === 'load' ? ': a script it needs did not load' : ''}${detail}. The controls, the data table and the drug search still work.`;
  document.documentElement.classList.add('no-webgl');
  for (const sel of ['#space', '#labels', '#btn-reset', '#btn-spin', '#btn-expand', '#btn-png', '#btn-vr', '#btn-ar', '.mol-wrap']) {
    for (const el of document.querySelectorAll(sel)) el.hidden = true;
  }
  const box = $('#fallback-2d');
  if (box) {
    box.hidden = false;
    const text = box.querySelector('[data-fallback-text]') || box.querySelector('p');
    if (text) text.textContent = msg;
    const open = $('#fallback-table');
    if (open && !open.dataset.bound) {
      open.dataset.bound = '1';
      open.addEventListener('click', () => {
        const d = $('#table-details');
        if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); d.querySelector('summary')?.focus(); }
      });
    }
  } else setStatus(msg);   // shell hook absent: the status line is the only place left to say it
  const st = $('#stage-status');
  if (st && box) st.hidden = true;
  announce(msg, 'assertive');
  return msg;
}

/**
 * The page could not start at all: log it and say so. `what` is a message or an Error; callers pick the wording, so
 * a script that failed to load is never reported as bad data.
 * @param {string|Error} what
 */
export function showFatal(what) {
  console.error(what);
  const msg = typeof what === 'string' ? what : String(what?.message || what);
  const box = $('#fatal');
  if (!box) { setStatus(msg); return msg; }
  box.hidden = false;
  const text = box.querySelector('#fatal-msg') || box.querySelector('[data-fatal-text]') || box.querySelector('p');
  if (text) text.textContent = msg;
  const reload = $('#fatal-reload');
  if (reload && !reload.dataset.bound) { reload.dataset.bound = '1'; reload.addEventListener('click', () => location.reload()); }
  const st = $('#stage-status');
  if (st) st.hidden = true;
  announce(msg, 'assertive');
  return msg;
}
