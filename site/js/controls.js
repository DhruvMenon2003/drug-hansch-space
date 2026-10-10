// Layer 3. The Explore panel: axis, colour and filter selects, the ATC chips and the drug search. It mirrors the view
// state into the DOM (on view:patched) and writes user changes back through setView; it never touches the GL scene.
import { app, bus, $, cap, esc } from './kernel.js';
import { announce } from './announce.js';
import { AX, l1sOf, passes } from './model.js';
import { selectDrug, setView } from './view.js';

/** Copy the current view into the form controls. */
export function syncControls() {
  const v = app.view;
  for (const a of ['x', 'y', 'z']) $('#ax-' + a).value = v[a];
  $('#color-by').value = v.color;
  fillAtcSelects();
  $('#f-route').value = v.route;
  $('#f-small').checked = v.small;
  $('#h-group').value = v.group && app.groups.has(v.group) ? v.group : $('#h-group').value;
}

/** Fill the three ATC filter selects with the codes that occur, narrowed by the levels above. */
export function fillAtcSelects() {
  const v = app.view, names = app.meta.atc_names, codes = new Set();
  for (const d of app.drugs) for (const a of d.atc) { codes.add(a.code[0]); codes.add(a.code.slice(0, 3)); codes.add(a.code.slice(0, 4)); }
  const opt = (c, sel) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} ${esc(cap(names[c] || ''))}</option>`;
  const all = [...codes].sort();
  $('#f-l1').innerHTML = '<option value="">All groups</option>' + all.filter(c => c.length === 1).map(c => opt(c, v.l1)).join('');
  $('#f-l2').innerHTML = '<option value="">All</option>' + all.filter(c => c.length === 3 && (!v.l1 || c.startsWith(v.l1))).map(c => opt(c, v.l2)).join('');
  $('#f-l3').innerHTML = '<option value="">All</option>' + all.filter(c => c.length === 4 && (!v.l2 || c.startsWith(v.l2)) && (!v.l1 || c.startsWith(v.l1))).map(c => opt(c, v.l3)).join('');
}

/** Build the controls and bind their listeners. Needs the data. */
export function initControls() {
  bus.on('view:patched', syncControls);
  for (const a of ['x', 'y', 'z']) {
    const sel = $('#ax-' + a);
    sel.innerHTML = Object.entries(AX).filter(([k]) => a === 'x' ? !AX[k].pseudo : true)
      .map(([k, o]) => `<option value="${k}">${esc(o.long || o.label)}</option>`).join('');
    sel.addEventListener('change', () => setView({ [a]: sel.value, group: null, veber: false }));
  }
  $('#color-by').addEventListener('change', e => setView({ color: e.target.value }));
  // ATC chips: L1 groups by drug count; colours follow the slot a group was given, never its rank
  const count = new Map();
  for (const d of app.drugs) for (const c of l1sOf(d)) count.set(c, (count.get(c) || 0) + 1);
  const l1 = [...count.keys()].sort();
  $('#atc-pick').innerHTML = l1.map(c => `<button type="button" class="chip" data-code="${c}" aria-pressed="false" title="${esc(cap(app.meta.atc_names[c]))}"><span class="sw"></span>${c} ${esc(cap(app.meta.atc_names[c]))} <span class="mono">${count.get(c)}</span></button>`).join('');
  const top3 = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
  app.view.atc = top3;
  $('#atc-pick').addEventListener('click', e => {
    const ch = e.target.closest('.chip');
    if (!ch) return;
    const atc = [...app.view.atc], slot = atc.indexOf(ch.dataset.code);
    if (slot >= 0) atc[slot] = null;
    else { const free = atc.indexOf(null); if (free < 0) return; atc[free] = ch.dataset.code; }
    app.view.atc = atc;
    bus.emit('recolor');
  });
  for (const id of ['f-l1', 'f-l2', 'f-l3']) {
    $('#' + id).addEventListener('change', e => {
      const lvl = id.slice(-2), patch = { [lvl]: e.target.value };
      if (lvl === 'l1') Object.assign(patch, { l2: '', l3: '' });
      if (lvl === 'l2') patch.l3 = '';
      setView(patch);
    });
  }
  const routes = [...new Set(app.drugs.flatMap(d => d.routes))].sort();
  $('#f-route').innerHTML = '<option value="">All routes</option>' + routes.map(r => `<option value="${esc(r)}">${esc(cap(r))}</option>`).join('');
  $('#f-route').addEventListener('change', e => setView({ route: e.target.value }));
  $('#f-small').addEventListener('change', e => setView({ small: e.target.checked, group: null }));
  // search
  $('#drug-names').innerHTML = [...app.drugs].sort((a, b) => a.name.localeCompare(b.name)).map(d => `<option value="${esc(cap(d.name))}">`).join('');
  // Enter and the later 'change' (on blur) used to run the search twice; an Enter-handled query is consumed by that change.
  let enterQuery = null, note = null;
  const say = text => {
    const input = $('#search');
    if (!note && input) {
      note = document.createElement('p');
      note.id = 'search-note';
      note.className = 'small';
      note.setAttribute('role', 'note');
      (input.closest('.field') || input.parentNode).appendChild(note);
    }
    if (note) { note.textContent = text; note.hidden = !text; }
    if (text) input?.setAttribute('aria-invalid', 'true'); else input?.removeAttribute('aria-invalid');
  };
  const find = () => {
    const raw = $('#search').value.trim(), q = raw.toLowerCase();
    if (!q) { say(''); return; }
    const d = app.drugs.find(x => x.name.toLowerCase() === q) || app.drugs.find(x => x.name.toLowerCase().startsWith(q));
    if (!d) {
      const msg = `No drug named “${raw}”.`;
      say(msg);
      announce(msg);
      return;
    }
    say('');
    if (!passes(d)) setView({ l1: '', l2: '', l3: '', route: '', small: false, group: null });
    selectDrug(d.cid);
  };
  $('#search').addEventListener('change', () => { const q = $('#search').value; if (q === enterQuery) { enterQuery = null; return; } find(); });
  $('#search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); enterQuery = $('#search').value; find(); } });
  $('#search').addEventListener('input', () => { if (note && note.textContent) say(''); });
}
