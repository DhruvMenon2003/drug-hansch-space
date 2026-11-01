// Layer 2. One computed comparison state feeds both identities, ruler and difference.
// Conceptual reference (not copied code): MbappeWU/explorable@4a72bfa,
// gallery/noise-cancelling.html:329–347,375–394 (shared params/readout/drawing),
// gallery/planetary-gears.html:438–473 (anchored labels). MIT; see project notices.
import { cap, esc, fx } from './kernel.js';
import { identityWarning } from './inquiry-math.js';

const DESCRIPTORS = {
  tpsa: { label: 'TPSA', unit: 'Å²', full: 'Topological polar surface area' },
  logp: { label: 'log P', unit: '', full: 'RDKit Crippen log P' },
  mr: { label: 'Molar refractivity', unit: 'cm³/mol', full: 'Molar refractivity' },
};
const heavyAtoms = d => Number.isFinite(d.d?.heavy) ? d.d.heavy : (String(d.smiles).match(/Cl|Br|[BCNOPSFI]|\[[^\]]+\]|[cnops]/g) || []).length;
// Ruler extent is a labelled pair window, not the cohort scale or nearest-neighbour metric.
function params({ anchor, other, descriptor = 'tpsa' }) {
  const key = Object.hasOwn(DESCRIPTORS, descriptor) ? descriptor : 'tpsa';
  const a = anchor?.d?.[key], b = other?.d?.[key], valid = Number.isFinite(a) && Number.isFinite(b);
  const gap = valid ? Math.abs(b - a) : 0;
  const pad = Math.max(gap * .25, Math.max(Math.abs(a || 0), Math.abs(b || 0)) * .03, .05);
  const lo = valid ? Math.min(a, b) - pad : 0, hi = valid ? Math.max(a, b) + pad : 1;
  return { anchor, other, key, ...DESCRIPTORS[key], a, b, valid, delta: valid ? b - a : null,
    lo, hi, x: v => 42 + (v - lo) / (hi - lo) * 436 };
}

export function initPair(host, { loadSmilesDrawer, onDescriptor = () => {} } = {}) {
  let current = null, depictionKey = '', version = 0, disposed = false;
  host.innerHTML = `<section class="inquiry-pair" aria-label="Compare two stored structures">
    <div class="pair-structures">${['a', 'b'].map((id, i) => `<div class="pair-record"><p class="pair-role">${i ? 'B · Compare' : 'A · Pinned'}</p><h4 data-pair-name="${id}"></h4><div class="pair-depiction" data-pair-structure="${id}"></div><p class="pair-value" data-pair-value="${id}"></p></div>`).join('')}</div>
    <div class="pair-descriptors" role="group" aria-label="Descriptor to compare">${Object.entries(DESCRIPTORS).map(([key, d]) => `<button type="button" data-pair-descriptor="${key}" aria-pressed="false" title="${d.full}">${d.label}</button>`).join('')}</div>
    <p class="pair-difference" role="status" aria-live="polite"></p>
    <figure class="pair-ruler"><svg viewBox="0 0 520 128" role="img"></svg><figcaption></figcaption></figure>
    <p class="pair-method">Stored RDKit descriptors · 2D drawings from curated SMILES. Activity cannot be compared from these descriptors.</p>
  </section>`;
  const q = s => host.querySelector(s);
  async function depict(d, target, ticket) {
    target.replaceChildren();
    const unavailable = text => { if (!disposed && ticket === version) { target.textContent = text; target.removeAttribute('aria-busy'); } };
    if (identityWarning(d)) { unavailable('Structure withheld: identity mapping needs review.'); return; }
    if (!d?.smiles) { unavailable('No stored structure.'); return; }
    if (heavyAtoms(d) > 110) { unavailable('Large structure: use Structure & sources for an optional drawing.'); return; }
    target.textContent = 'Drawing structure…'; target.setAttribute('aria-busy', 'true');
    try {
      const SD = await loadSmilesDrawer();
      if (disposed || ticket !== version) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `2D structure of ${cap(d.name)}`);
      const drawer = new SD.SvgDrawer({ width: 300, height: 210, bondThickness: 1.2, padding: 14, compactDrawing: false });
      SD.parse(d.smiles, tree => {
        if (disposed || ticket !== version) return;
        try { drawer.draw(tree, svg, matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); svg.removeAttribute('style'); target.replaceChildren(svg); target.removeAttribute('aria-busy'); }
        catch { unavailable('Structure drawing unavailable.'); }
      }, () => unavailable('Structure drawing unavailable.'));
    } catch { unavailable('Structure drawing unavailable.'); }
  }
  function render(input) {
    if (disposed) return;
    current = input;
    host.hidden = !input?.anchor || !input?.other;
    if (host.hidden) { version++; depictionKey = ''; return; }
    const p = params(input), unit = p.unit ? ` ${p.unit}` : '';
    for (const [id, d, value] of [['a', p.anchor, p.a], ['b', p.other, p.b]]) {
      q(`[data-pair-name="${id}"]`).textContent = cap(d.name);
      q(`[data-pair-value="${id}"]`).textContent = Number.isFinite(value) ? `${fx(value, 3)}${unit}` : 'Missing descriptor';
    }
    const key = `${p.anchor.cid}|${p.anchor.smiles}|${p.other.cid}|${p.other.smiles}|${matchMedia('(prefers-color-scheme: dark)').matches}`;
    if (key !== depictionKey) { depictionKey = key; const ticket = ++version; depict(p.anchor, q('[data-pair-structure="a"]'), ticket); depict(p.other, q('[data-pair-structure="b"]'), ticket); }
    for (const button of host.querySelectorAll('[data-pair-descriptor]')) button.setAttribute('aria-pressed', String(button.dataset.pairDescriptor === p.key));
    const svg = q('.pair-ruler svg');
    svg.setAttribute('aria-label', p.valid ? `${p.full}: ${cap(p.anchor.name)} ${fx(p.a, 3)}, ${cap(p.other.name)} ${fx(p.b, 3)}${unit}. Pair window, not population scale.` : 'Comparison unavailable: a descriptor is missing.');
    svg.innerHTML = p.valid ? `<path class="pair-axis" d="M42 64H478M42 59V69M478 59V69"/><path class="pair-bracket" d="M${p.x(p.a)} 43V53H${p.x(p.b)}V85"/><circle class="pair-mark-a" cx="${p.x(p.a)}" cy="64" r="5"/><circle class="pair-mark-b" cx="${p.x(p.b)}" cy="64" r="5"/><text x="${p.x(p.a)}" y="32" text-anchor="middle">A</text><text x="${p.x(p.b)}" y="108" text-anchor="middle">B</text>` : '';
    q('.pair-ruler figcaption').textContent = p.valid ? `${p.full} · pair window ${fx(p.lo, 3)} to ${fx(p.hi, 3)}${unit}` : 'Both stored values are needed to draw this ruler.';
    q('.pair-difference').innerHTML = p.valid ? `<strong>${p.delta > 0 ? '+' : ''}${esc(fx(p.delta, 3))}${esc(unit)}</strong><span>${esc(cap(p.other.name))} minus ${esc(cap(p.anchor.name))}</span>` : '<span>No difference calculated: missing descriptor.</span>';
  }
  const click = e => { const button = e.target.closest('[data-pair-descriptor]'); if (!button || !current) return; const descriptor = button.dataset.pairDescriptor; render({ ...current, descriptor }); onDescriptor(descriptor); };
  host.addEventListener('click', click);
  return { render, dispose() { disposed = true; version++; host.removeEventListener('click', click); } };
}
