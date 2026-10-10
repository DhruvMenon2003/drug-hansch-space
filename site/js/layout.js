// Layer 2. Responsive layout behaviour: what CSS cannot decide on its own. Imports no three and touches no GL object; the GL
// layer reads `layoutState` and listens to the bus events `stage:size` and `stage:expand` that this module emits.
//
//   * the header collapses on scroll-down and returns on scroll-up (phones), with the Contents menu (disclosure pattern)
//   * the stage height policy: body[data-stage] (tour | explore | read) from an IntersectionObserver, body[data-stage-size]
//     (tour | explore | strip) from it, the soft keyboard (a focused field) and the Show 3D button
//   * --sticky-stack (header + stage on phones, the header elsewhere) and the scroll padding for jump links
//   * Expand: the stage over the whole screen (Fullscreen API where there is one), Escape and a Close button, scroll lock
//   * the back-to-top button and the scroll-progress bar
//   * the reading position: remembered while scrolling, restored when the screen turns
//
// Everything is optional: a hook that is not in the page is skipped, nothing here throws without it.
import { $, bus, narrow, reduceMotion } from './kernel.js';
import { announce } from './announce.js';

const mq = q => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {}, removeEventListener() {} });
/** Landscape phones: two columns, a slim static header, the stage as tall as the screen. */
export const landscape = mq('(orientation: landscape) and (max-height: 520px)');
/** A mouse-driven window of at least 701 x 521 px: the drug panel stays a card in the text column; everything else gets the sheet. */
export const desktop = mq('(min-width: 701px) and (min-height: 521px) and (hover: hover) and (pointer: fine)');
export const coarse = mq('(pointer: coarse)');

/** Layout state shared with the GL layer. Mutate it, never reassign it. size: tour | explore | strip. */
export const layoutState = { mode: 'tour', size: 'tour', collapsed: false, expanded: false, headerHidden: false, show3d: false, kb: false, ready: false };

/** The drug panel is a sheet (not a card in the text column). */
export const isSheetMode = () => !desktop.matches;

const html = () => document.documentElement;
const body = () => document.body;
const headerEl = () => $('.masthead');
const stageInner = () => $('.stage-inner');
const cssPx = name => parseFloat(getComputedStyle(html()).getPropertyValue(name));

// ---------------------------------------------------------------------------------------------------------------- the stable screen unit
// CSS sizes the stage and the tour steps in --svh (1% of the SMALL viewport height). A touch browser's own chrome slides in and
// out while the page scrolls, which resizes the viewport by 50 to 100 px without changing its width: the layout must not move
// for that (the stage and every step would change height, the text would jump and the canvas would be re-allocated). So on a
// touch screen --svh is pinned in px and only re-measured when the width changes (a rotation) or the height changes by 150 px or
// more (a real resize). With a mouse the window follows exactly: the CSS value 1svh stands.
let unit = { w: 0, h: 0 };
function updateUnit(force = false) {
  const r = html().style;
  if (!coarse.matches) { r.removeProperty('--svh'); unit = { w: 0, h: 0 }; return; }
  const w = innerWidth, h = innerHeight;
  if (force || !unit.w || w !== unit.w || Math.abs(h - unit.h) >= 150) { unit = { w, h }; r.setProperty('--svh', `${h / 100}px`); }
}

// ---------------------------------------------------------------------------------------------------------------- measured stack
/** Height the stage will have in `size` (tour | explore | strip), from the registered custom properties; the current height if the browser cannot resolve them. */
export function stageHeightFor(size) {
  if (size === 'strip') return cssPx('--stage-strip') || 56;
  const v = cssPx(size === 'explore' ? '--stage-explore' : '--stage-tour');
  return Number.isFinite(v) ? v : (stageInner()?.offsetHeight ?? 0);
}
/** Height of what sticks above the reading area: header + stage on a phone in portrait, the header on a wide layout, nothing on a landscape phone (its header is static). */
export function stackHeight() {
  const head = headerEl()?.offsetHeight ?? 0;
  if (narrow.matches) return head + (stageInner()?.offsetHeight ?? 0);
  return landscape.matches ? 0 : head;
}
/** y (px from the viewport top) of the reading line: 30% down the visible reading area on phones, 62% of the viewport elsewhere. */
export function readingLine() {
  const H = innerHeight, s = stackHeight();
  const y = narrow.matches ? s + 0.3 * (H - s) : 0.62 * H;
  return Math.max(1, Math.min(H - 3, Math.round(y)));
}
function publishStack() {
  const r = html().style;
  r.setProperty('--sticky-stack', `${Math.round(stackHeight())}px`);
  const tools = $('.stage-tools');
  if (tools && (narrow.matches || landscape.matches)) r.setProperty('--tools-w', `${Math.min(tools.scrollWidth, Math.round((stageInner()?.clientWidth ?? 320) * 0.7)) + 8}px`);
}

// ---------------------------------------------------------------------------------------------------------------- the stage size policy
let mode = 'tour';
/** Which section is under the stage-mode line. */
const modeOf = el => (el?.closest?.('.tour') ? 'tour' : el?.closest?.('#explore') ? 'explore' : 'read');

function updateSize() {
  const st = layoutState;
  let size = 'tour';
  if (narrow.matches && !st.expanded) {
    if (st.kb) size = 'strip';
    else if (mode === 'explore') size = 'explore';
    else if (mode === 'read') size = st.show3d ? 'explore' : 'strip';
  }
  const b = body();
  b.dataset.stage = mode;
  b.dataset.stageSize = size;
  const changed = size !== st.size;
  st.mode = mode; st.size = size; st.collapsed = size === 'strip';
  const btn = $('#btn-show3d');
  if (btn) {
    btn.hidden = !(narrow.matches && mode === 'read' && !st.kb && !st.expanded);
    btn.textContent = st.show3d ? 'Hide 3D' : 'Show 3D';
    btn.setAttribute('aria-expanded', String(st.show3d));
  }
  publishStack();
  if (changed) bus.emit('stage:size', { size, collapsed: st.collapsed });
}
function setMode(m) {
  if (m === mode) return;
  mode = m;
  layoutState.show3d = false;                    // a section change puts the stage back to its own height
  updateSize();
}
/** Bring the 3D view up whatever the section (the skip link to the plot, Show 3D). */
export function revealStage() {
  if (layoutState.size === 'strip') { layoutState.kb = false; body().classList.remove('kb'); layoutState.show3d = true; updateSize(); }
}

let modeIo = null, builtFor = { w: 0, h: 0 };
const modeTargets = () => [
  ['.tour', 'tour'], ['#explore', 'explore'], ...(isSheetMode() ? [] : [['#detail', 'read']]), ['#hansch', 'read'],
  ['#table-details', 'read'], ['#method', 'read'], ['#sources', 'read'],
].map(([s, m]) => [s === '#table-details' ? $(s)?.closest('section') : $(s), m]).filter(([el]) => el);
/** The stage mode line (px from the top): just under the stack of the tour (header + the tall stage), where a section's heading becomes readable. */
export const modeLineOf = () => Math.round((headerEl()?.offsetHeight ?? 0) + stageHeightFor('tour') + 8);
function buildModeObserver() {
  modeIo?.disconnect(); modeIo = null;
  builtFor = { w: innerWidth, h: innerHeight };
  if (!narrow.matches || typeof IntersectionObserver !== 'function') { mode = 'tour'; updateSize(); return; }
  const H = innerHeight, line = Math.min(H - 3, modeLineOf());
  const map = new Map(modeTargets());
  modeIo = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) setMode(map.get(e.target)); }, { rootMargin: `-${line}px 0px -${Math.max(0, H - line - 2)}px 0px`, threshold: 0 });
  for (const el of map.keys()) modeIo.observe(el);
  updateSize();
}

function initKeyboardCollapse(signal) {
  const fields = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), select, textarea';
  const set = on => { if (layoutState.kb === on) return; layoutState.kb = on; body().classList.toggle('kb', on); updateSize(); };
  document.addEventListener('focusin', e => { if (narrow.matches && coarse.matches && e.target.matches?.(fields)) set(true); }, { signal });
  document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches?.(fields)) set(false); }, 80), { signal });
}
function initShow3d(signal) {
  $('#btn-show3d')?.addEventListener('click', () => { layoutState.show3d = !layoutState.show3d; updateSize(); }, { signal });
  // "Skip to the 3D plot" must work from a collapsed stage: capture phase, before boot-core's handler focuses the canvas
  document.addEventListener('click', e => { if (e.target.closest?.('a[href="#space-skip"]')) revealStage(); }, { capture: true, signal });
}

// ---------------------------------------------------------------------------------------------------------------- header: collapse on scroll, Contents menu
function setHeaderHidden(h) {
  if (h === layoutState.headerHidden) return;
  layoutState.headerHidden = h;
  body().classList.toggle('header-hidden', h);
}
const menuOpen = () => $('#contents-btn')?.getAttribute('aria-expanded') === 'true';

function initContents(signal) {
  const btn = $('#contents-btn'), menu = $('#contents-menu');
  if (!btn || !menu) return;
  const items = () => [...menu.querySelectorAll('a')];
  const open = on => {
    if (on === menuOpen()) return;
    btn.setAttribute('aria-expanded', String(on));
    menu.hidden = !on;
    if (on) { setHeaderHidden(false); items()[0]?.focus(); }
  };
  btn.addEventListener('click', () => open(!menuOpen()), { signal });
  menu.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    open(false);
    if (a.hasAttribute('data-top')) { e.preventDefault(); toTop(); }
  }, { signal });
  document.addEventListener('keydown', e => {
    if (!menuOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open(false); btn.focus(); return; }
    if (!menu.contains(document.activeElement) && document.activeElement !== btn) return;
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
  }, { signal, capture: true });
  // a click or a focus move outside closes it
  document.addEventListener('click', e => { if (menuOpen() && !e.target.closest?.('#contents')) open(false); }, { signal });
  document.addEventListener('focusin', e => { if (menuOpen() && !e.target.closest?.('#contents')) open(false); }, { signal });
  // the menu has no place on a wide layout: close it when the layout changes shape
  for (const q of [narrow, landscape]) q.addEventListener('change', () => open(false), { signal });
}
/** Smooth scroll to the top (instant under reduced motion); focus goes to the page title so the next Tab starts at the top. */
function toTop() {
  window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
  const h1 = $('.brand h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
}

// ---------------------------------------------------------------------------------------------------------------- scroll: header, back-to-top, progress, reading position
let anchor = null, frozenUntil = 0;
const anchorTargets = () => [...document.querySelectorAll('.step'), ...['#explore', ...(isSheetMode() ? [] : ['#detail']), '#hansch', '#method'].map(s => $(s)), $('#table-details')?.closest('section')].filter(Boolean);
/** Remember which part of the page is under the reading line (and how far into it), so a rotation can put the reader back. */
export function captureAnchor() {
  if (performance.now() < frozenUntil) return;
  const line = readingLine();
  for (const el of anchorTargets()) {
    const r = el.getBoundingClientRect();
    if (r.height && r.top <= line && r.bottom >= line) { anchor = { el, f: (line - r.top) / r.height }; return; }
  }
}
/** Scroll so the remembered part sits at the reading line again (after the screen turned or the layout changed shape). Returns whether it scrolled. */
export function restoreAnchor() {
  if (!anchor?.el?.isConnected) return false;
  const r = anchor.el.getBoundingClientRect(), want = r.top + anchor.f * r.height - readingLine();
  if (Math.abs(want) < 2) return false;
  window.scrollBy({ top: want, behavior: 'instant' });
  return true;
}
/** The remembered place (tests). */
export const anchorOf = () => anchor && { el: anchor.el, f: anchor.f };

function initScroll(signal) {
  const fab = $('#fab-top'), bar = $('#read-progress');
  let lastY = scrollY, acc = 0, ticking = false;
  const run = () => {
    ticking = false;
    const y = scrollY, dy = y - lastY;
    lastY = y;
    const head = headerEl()?.offsetHeight ?? 56;
    if (!narrow.matches || layoutState.expanded || menuOpen() || headerEl()?.contains(document.activeElement) || y <= head) { acc = 0; setHeaderHidden(false); }
    else {
      if (dy * acc < 0) acc = 0;
      acc += dy;
      if (acc > 28) setHeaderHidden(true);
      else if (acc < -12) setHeaderHidden(false);
    }
    if (fab) fab.hidden = layoutState.expanded || y < innerHeight * 0.8;
    if (bar) bar.style.setProperty('--p', String(Math.min(1, Math.max(0, y / Math.max(1, document.documentElement.scrollHeight - innerHeight)))));
    captureAnchor();
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } };
  addEventListener('scroll', onScroll, { passive: true, signal });
  headerEl()?.addEventListener('focusin', () => setHeaderHidden(false), { signal });
  fab?.addEventListener('click', toTop, { signal });
  run();
}

// ---------------------------------------------------------------------------------------------------------------- jump links
let padTimer = 0;
/** Set the scroll padding for a jump to `target`: under the stack the page WILL have when it gets there (the stage changes height as the section arrives). */
function setJumpPad(target) {
  const head = headerEl()?.offsetHeight ?? 0, m = modeOf(target);
  const pad = narrow.matches ? head + stageHeightFor(m === 'tour' ? 'tour' : m === 'explore' ? 'explore' : 'strip') + 12 : landscape.matches ? 12 : head + 12;
  html().style.setProperty('--jump-pad', `${Math.round(pad)}px`);
  clearTimeout(padTimer);
  padTimer = setTimeout(() => html().style.removeProperty('--jump-pad'), 1600);
}
function initAnchors(signal) {
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || a.hasAttribute('data-top')) return;
    let id = '';
    try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch { /* a malformed escape is not an id */ }
    const t = id && document.getElementById(id);
    if (t) setJumpPad(t);
  }, { capture: true, signal });
  // a page opened on #explore: the browser scrolled before the stack was measured
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(1) || ''); } catch { /* not an id */ }
  const t = id && document.getElementById(id);
  if (t) requestAnimationFrame(() => { setJumpPad(t); t.scrollIntoView({ block: 'start', behavior: 'instant' }); });
}

// ---------------------------------------------------------------------------------------------------------------- expand
let fsOwned = false;
async function setExpanded(on) {
  const st = layoutState;
  if (on === st.expanded) return;
  st.expanded = on;
  const btn = $('#btn-expand');
  body().classList.toggle('stage-full', on);
  setHeaderHidden(false);
  if (btn) {
    btn.setAttribute('aria-expanded', String(on));
    btn.setAttribute('aria-label', on ? 'Close the expanded view' : 'Expand view');
    btn.title = on ? 'Close the expanded view (Escape)' : 'Make the 3D view larger';
    btn.textContent = on ? 'Close' : 'Expand view';
    btn.focus({ preventScroll: true });
  }
  updateSize();
  bus.emit('stage:expand', { on });
  announce(on ? 'The 3D view fills the screen. Press Escape or Close to go back.' : 'The 3D view is back in the page.');
  if (on && coarse.matches && document.fullscreenEnabled && !document.fullscreenElement) {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); fsOwned = true; } catch { fsOwned = false; }
  } else if (!on && fsOwned && document.fullscreenElement) {
    fsOwned = false;
    try { await document.exitFullscreen(); } catch { /* already out */ }
  }
}
/** Expand (true) or close (false) the full-screen view; resolves when the state has changed. */
export const setStageExpanded = on => setExpanded(!!on);
/** Show the Expand button: called when the 3D layer is up. */
export function enableExpand() {
  const btn = $('#btn-expand');
  if (btn) btn.hidden = false;
}
function initExpand(signal) {
  $('#btn-expand')?.addEventListener('click', () => setExpanded(!layoutState.expanded), { signal });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && layoutState.expanded && !e.defaultPrevented) { e.preventDefault(); setExpanded(false); }
  }, { signal });
  // the browser's own Escape out of full screen
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && layoutState.expanded && fsOwned) { fsOwned = false; setExpanded(false); } }, { signal });
}

// ---------------------------------------------------------------------------------------------------------------- small things
/** The legend scrolls sideways when it does not fit; a scrolling region must be reachable from the keyboard, so it takes focus only then. */
function initLegend(signal) {
  const el = $('#legend');
  if (!el) return;
  const check = () => {
    const over = el.scrollWidth > el.clientWidth + 1;
    if (over) { el.tabIndex = 0; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Legend (scrolls sideways)'); }
    else { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('aria-label'); }
  };
  const ro = new ResizeObserver(check), mo = new MutationObserver(check);
  ro.observe(el); mo.observe(el, { childList: true, subtree: true, characterData: true });
  signal.addEventListener('abort', () => { ro.disconnect(); mo.disconnect(); });
  check();
}
/** One finger scrolls the page over the stage on a phone; the tour's first hint says how to turn the space then. */
function initTouchHint(signal) {
  const el = $('.step[data-step="space"] .hint');
  if (!el) return;
  const original = el.textContent;
  const apply = () => { el.textContent = narrow.matches && coarse.matches ? 'Two fingers turn and zoom the space (one finger scrolls the page), or tap the expand button for one-finger control. Tap a sphere to name it.' : original; };
  for (const q of [narrow, coarse]) q.addEventListener('change', apply, { signal });
  apply();
}

// ---------------------------------------------------------------------------------------------------------------- init
let off = () => {};
/**
 * Start the responsive layout. Safe to call once the page body exists; a second call replaces the first.
 * @returns {() => void} undo
 */
export function initLayout() {
  off();
  const ac = new AbortController(), { signal } = ac;
  body().classList.add('layout-ready');
  layoutState.ready = true;
  updateUnit(true);
  coarse.addEventListener('change', () => { updateUnit(true); buildModeObserver(); }, { signal });
  initContents(signal);
  initKeyboardCollapse(signal);
  initShow3d(signal);
  initExpand(signal);
  initAnchors(signal);
  initLegend(signal);
  initTouchHint(signal);
  buildModeObserver();
  initScroll(signal);
  publishStack();
  const ro = new ResizeObserver(() => publishStack());
  for (const el of [headerEl(), stageInner(), $('.stage-tools')]) if (el) ro.observe(el);
  // shape changes: rebuild the stage line, close or reopen what the new shape does not have
  const reshape = () => { setHeaderHidden(false); buildModeObserver(); };
  for (const q of [narrow, landscape, desktop]) q.addEventListener('change', reshape, { signal });
  let timer = 0, lastW = innerWidth;
  addEventListener('resize', () => {
    updateUnit();
    if (innerWidth !== lastW) { lastW = innerWidth; frozenUntil = performance.now() + 500; }    // the browser's own scroll adjustments must not replace the remembered place
    clearTimeout(timer);
    timer = setTimeout(() => {
      // a same-width change under 150 px is the browser chrome sliding in or out: nothing to redo
      if (innerWidth === builtFor.w && Math.abs(innerHeight - builtFor.h) < 150) { publishStack(); return; }
      buildModeObserver();
    }, 120);
  }, { signal });
  captureAnchor();
  off = () => { ac.abort(); html().style.removeProperty('--svh'); clearTimeout(timer); clearTimeout(padTimer); modeIo?.disconnect(); ro.disconnect(); body().classList.remove('layout-ready', 'header-hidden', 'stage-full', 'kb'); layoutState.ready = false; };
  return off;
}
/** Re-read everything that depends on the viewport (tests, and the tour after a rotation). */
export function relayout() { buildModeObserver(); }
