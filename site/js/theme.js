// Layer 1. CSS design tokens as values the canvas code can use, and theme-change detection.
import { app, bus, darkQuery } from './kernel.js';

const TOKEN_KEYS = ['panel', 'ink', 'ink-2', 'muted', 'line', 'grid', 'accent', 'mark', 'point', 's1', 's2', 's3', 'q1', 'q2', 'q3', 'q4', 'q5', 'surface-alpha', 'bg'];   // bg: the page background, read by the PNG export

/** Read the colour tokens of the active theme from the root element's computed style into app.tokens. */
export function readTokens() {
  const cs = getComputedStyle(document.documentElement), t = {};
  for (const k of TOKEN_KEYS) t[k] = cs.getPropertyValue('--' + k).trim();
  app.tokens = t;
}

function onTheme() {
  readTokens();
  bus.emit('theme');
}

/** Start watching for theme changes (OS preference or the data-theme attribute); emits `theme` after re-reading the tokens. */
export function initTheme() {
  darkQuery.addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
