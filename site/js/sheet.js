// Layer 2. The drug panel as a sheet. On phones, tablets and landscape phones #detail is fixed to the bottom of the screen with
// three heights: peek (name and three numbers, about 96 px), half (50 svh) and full (88 svh). On a mouse-driven desktop window it
// stays a card in the text column and a selection scrolls it into view instead. CSS (css/layout.css) draws the heights from
// #detail[data-sheet]; this module owns the state, the handle button (a real button with aria-expanded) and the keyboard.
import { $, ORDER, app, bus, cap, fx } from './kernel.js';
import { desktop, isSheetMode } from './layout.js';

const ORDER_UP = ['peek', 'half', 'full'];
let state = 'closed';

/** The current sheet state: closed | peek | half | full. */
export const sheetState = () => state;

const panel = () => $('#detail');
function paint() {
  const el = panel(), open = state !== 'closed' && isSheetMode();
  if (el) el.dataset.sheet = state;
  const handle = $('#sheet-handle');
  if (handle) {
    handle.setAttribute('aria-expanded', String(state === 'half' || state === 'full'));
    const t = $('#sheet-state');
    if (t) t.textContent = state === 'peek' ? 'Show details' : state === 'half' ? 'Show all details' : 'Show less';
  }
  if (open) document.body.dataset.sheetOpen = state; else delete document.body.dataset.sheetOpen;
  measure();
}
/** Height of the open sheet, for the elements that must stay above it (back-to-top button). */
function measure() {
  const el = panel(), open = el && state !== 'closed' && isSheetMode();
  document.documentElement.style.setProperty('--sheet-h', open ? `${Math.round(el.getBoundingClientRect().height)}px` : '0px');
}

/** Set the sheet to `next` (closed | peek | half | full). Has no visible effect on a desktop card. */
export function setSheet(next) {
  if (next === state) return;
  state = next;
  paint();
}

/** Step the sheet one state up (peek > half > full) or down; going down from peek closes it. */
function step(dir) {
  if (state === 'closed') return;
  const i = ORDER_UP.indexOf(state) + dir;
  setSheet(i < 0 ? 'closed' : ORDER_UP[Math.min(i, ORDER_UP.length - 1)]);
}

function renderPeek(index) {
  const d = app.drugs[index];
  if (!d) return;
  const t = $('#sheet-title'), m = $('#sheet-metrics');
  if (t) t.textContent = cap(d.name);
  if (m) m.textContent = `log P ${fx(d.d.logp, 1)} · MR ${fx(d.d.mr, 0)} · TPSA ${fx(d.d.tpsa, 0)}`;
}

/**
 * Bind the sheet: it opens in the peek state on every selection (a 3D tap, the search box, a table row), the handle cycles
 * peek > half > full > peek, a drag on it moves one state, Escape inside the sheet collapses one state, the Close button closes it.
 * @returns {() => void} undo
 */
export function initSheet() {
  const ac = new AbortController(), { signal } = ac;
  const handle = $('#sheet-handle'), close = $('#sheet-close'), el = panel();
  let opener = null;
  const offSel = bus.on('selection', ({ index, reveal }) => {
    renderPeek(index);
    if (isSheetMode()) { if (state === 'closed') setSheet('peek'); }
    else if (reveal !== false) el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });   // desktop: bring the card into view, no animation (the tour must not see a long scroll)
  }, ORDER.UI);
  // a drag on the handle: up opens one state, down closes one; a tap cycles
  let drag = null, suppress = false;
  handle?.addEventListener('pointerdown', e => { drag = { y: e.clientY, id: e.pointerId }; handle.setPointerCapture?.(e.pointerId); }, { signal });
  handle?.addEventListener('pointerup', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag = null;
    if (Math.abs(dy) > 24) { suppress = true; step(dy < 0 ? 1 : -1); setTimeout(() => { suppress = false; }, 50); }
  }, { signal });
  handle?.addEventListener('pointercancel', () => { drag = null; }, { signal });
  handle?.addEventListener('click', () => {
    if (suppress) return;
    opener = document.activeElement;
    setSheet(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek');
  }, { signal });
  close?.addEventListener('click', () => {
    setSheet('closed');
    const back = $('#space');
    (opener?.isConnected && opener !== close && opener.offsetParent !== null ? opener : back && !back.hidden ? back : document.body).focus?.({ preventScroll: true });
  }, { signal });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || state === 'closed' || !isSheetMode() || !el?.contains(document.activeElement)) return;
    e.preventDefault();
    step(-1);
    if (state === 'closed') ($('#space') && !$('#space').hidden ? $('#space') : document.body).focus?.({ preventScroll: true });
  }, { signal });
  // a layout that changes the panel between sheet and card
  desktop.addEventListener('change', () => {
    if (isSheetMode() && state === 'closed' && app.selected >= 0) { renderPeek(app.selected); setSheet('peek'); } else paint();
  }, { signal });
  const ro = new ResizeObserver(measure);
  if (el) ro.observe(el);
  paint();
  return () => { ac.abort(); offSel(); ro.disconnect(); state = 'closed'; paint(); };
}
