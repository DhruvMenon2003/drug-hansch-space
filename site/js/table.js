// Layer 3. The data table: the accessible, non-pointer view of the scatter (the drugs in the current view with their axis values).
import { app, bus, ORDER, $, cap, esc, fx } from './kernel.js';
import { AX } from './model.js';
import { selectDrug } from './view.js';

/** Rebuild the table from app.visible and the current axes. */
export function renderTable() {
  const v = app.view, ax = ['x', 'y', 'z'].filter(a => !AX[v[a]].pseudo);
  $('#table thead').innerHTML = `<tr><th scope="col">Drug</th><th scope="col">ATC</th>${ax.map(a => `<th scope="col">${esc(AX[v[a]].label)}</th>`).join('')}<th scope="col">pChEMBL</th></tr>`;
  const rows = [...app.visible].sort((a, b) => a.name.localeCompare(b.name));
  $('#table tbody').innerHTML = rows.map(d => `<tr data-cid="${d.cid}" tabindex="0" aria-selected="${app.drugs[app.selected]?.cid === d.cid}"><td>${esc(cap(d.name))}</td><td>${esc(d.atc[0]?.code || '')}</td>${ax.map(a => `<td>${fx(AX[v[a]].get(d), AX[v[a]].dec)}</td>`).join('')}<td>${d.act ? fx(d.act.p, 1) : '–'}</td></tr>`).join('');
}

/** Bind the table's listeners and keep it in step with layout and selection. Runs last on `layout`, as it always did. */
export function initTable() {
  $('#table').addEventListener('click', e => { const tr = e.target.closest('tr[data-cid]'); if (tr) selectDrug(+tr.dataset.cid); });
  $('#table').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-cid]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectDrug(+tr.dataset.cid); } });
  $('#table-details').addEventListener('toggle', () => { if ($('#table-details').open) renderTable(); });
  bus.on('layout', () => { if ($('#table-details').open) renderTable(); }, ORDER.LATE);
  bus.on('selection', ({ cid }) => document.querySelectorAll('#table tbody tr').forEach(tr => tr.setAttribute('aria-selected', +tr.dataset.cid === cid)));
}
