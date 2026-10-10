// Layer 1. Screen-reader announcements through the page's single live region (#sr-live, provided by the shell) and the
// bus subscriptions that feed it. announce() debounces by 150 ms (the last message wins), re-announces identical text,
// clears the region after 4 s, and never throws when the region is absent.
import { app, bus, cap, fin, fx } from './kernel.js';

const DEBOUNCE_MS = 150, CLEAR_MS = 4000;
let timer = 0, clearTimer = 0;

function write(text, priority) {
  const el = document.getElementById('sr-live');
  if (!el) return;
  clearTimeout(clearTimer);
  const wantsAssertive = priority === 'assertive';
  if (wantsAssertive) el.setAttribute('aria-live', 'assertive');
  else el.setAttribute('aria-live', 'polite');
  el.textContent = '';                              // an unchanged string would not be re-read
  el.textContent = text;
  clearTimer = setTimeout(() => { el.textContent = ''; }, CLEAR_MS);
}

/**
 * Queue `text` for the live region. A newer call within 150 ms replaces it; 'assertive' is written at once.
 * @param {string} text @param {'polite'|'assertive'} [priority]
 */
export function announce(text, priority = 'polite') {
  clearTimeout(timer);
  if (!text) return;
  if (priority === 'assertive') { timer = 0; write(text, priority); return; }
  timer = setTimeout(() => { timer = 0; write(text, priority); }, DEBOUNCE_MS);
}

/** "Selected Dexamethasone. log P 1.9, TPSA 94." for the drug at `index`. */
export function describeDrug(index) {
  const d = app.drugs[index];
  if (!d) return '';
  const parts = [];
  if (fin(d.d.logp)) parts.push(`log P ${fx(d.d.logp, 1)}`);
  if (fin(d.d.tpsa)) parts.push(`TPSA ${fx(d.d.tpsa, 0)}`);
  return `Selected ${cap(d.name)}.${parts.length ? ' ' + parts.join(', ') + '.' : ''}`;
}

/**
 * Announce every selection, in ONE message: the debounce keeps only the last call, so a drug that is already outside the
 * current view (a click on a Hansch point, a search that leaves a filter on) says so here instead of in a second message
 * that this one would replace. Other modules call announce() themselves for their own events.
 */
export function initAnnounce() {
  bus.on('selection', ({ index }) => {
    const d = app.drugs[index], text = describeDrug(index);
    announce(d && !app.visible.includes(d) ? `${text} ${cap(d.name)} is not in the current view.` : text);
  });
}
