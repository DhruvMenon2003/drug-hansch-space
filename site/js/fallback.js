// Layer 1. The stage status line and the fatal-error message. Pure DOM, no three.
import { $ } from './kernel.js';

/** Replace the status text over the stage. */
export function setStatus(text) {
  const el = $('#stage-status');
  if (el) el.textContent = text;
}
/** Hide the status line once the scene is ready. */
export function hideStatus() {
  const el = $('#stage-status');
  if (el) el.hidden = true;
}
/** Boot failed: log it and say so in the status line (the text the page has always shown). */
export function showFatal(err) {
  console.error(err);
  setStatus(`Could not load the data (${err?.message}).`);
}
