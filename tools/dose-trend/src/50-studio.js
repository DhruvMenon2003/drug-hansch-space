// ---------- figure studio: results → figure JSON → SVG / PDF / PNG ----------
// The JSON is the source of truth (the sci-figure-gen contract). Options rebuild it from the data;
// edits made in the JSON tab are rendered as they stand until an option or the table changes.
{
  const IMG = '@panel-a-image'; // stands in for the image data in the JSON tab, to keep it readable
  const proof = $('proof'), jsonBox = $('json-box'), styleBox = $('style-box');
  const exportMsg = (t) => { $('export-msg').textContent = t || ''; };
  const opts = () => {
    const f = tool.fig, r = tool.result, ref = r && r.ref;
    return { journal: f.journal, column: f.column, panelA: f.panelA, style: f.style, palette: f.palette, pA: f.pA, pB: f.pB, alt: tool.alt, border: f.border,
      xTitle: f.xTitle, yTitle: f.yTitle, image: tool.image, styleId: tool.isStudy ? lc(STUDY.drug) : 'dose_trend',
      study: { population: f.population, design: f.design || (ref ? 'Randomized' : 'Allocated'), duration: f.duration, outcome: tool.isStudy ? STUDY.outcome : 'Events recorded', groupLabel: tool.isStudy ? STUDY.spanner : '' } };
  };
  const forBox = (fig) => JSON.stringify(fig, (k, v) => (k === 'image_href' ? IMG : v), 1);
  function fillColumns() {
    const j = Fig.JOURNALS[tool.fig.journal], names = { double: 'Double column', onehalf: '1.5 column', single: 'Single column' };
    $('fig-column').replaceChildren(...['double', 'onehalf', 'single'].map((c) => el('option', { value: c, text: names[c] + ', ' + j.widths[c] + ' mm' })));
    $('fig-column').value = tool.fig.column;
  }
  function show(built, note) {
    tool.built = built;
    const { figure, style } = built;
    proof.innerHTML = Fig.renderSVG(figure, style, { tooltips: true }); // text inside is escaped by the renderer
    const node = proof.querySelector('svg'), scale = Math.min(1.75, Math.max(1, 1000 / (figure.canvas.width * 96 / 300)));
    node.setAttribute('width', Math.round(figure.canvas.width * 96 / 300 * scale));
    node.setAttribute('height', Math.round(figure.canvas.height * 96 / 300 * scale));
    node.setAttribute('role', 'img'); node.setAttribute('aria-label', figure.figure_meta.title + '. Details are in the figure legend below.');
    styleBox.value = JSON.stringify(style, null, 1);
    const jt = style.journal_template, ty = style.typography, problems = Fig.validate(figure, style);
    const sizes = (figure.annotations || []).filter((a) => !/^panel_label_/.test(a.id)).map((a) => a.font_size / Fig.PT);
    const span = sizes.length ? Math.min(...sizes).toFixed(0) + (Math.max(...sizes) - Math.min(...sizes) > 0.4 ? '–' + Math.max(...sizes).toFixed(0) : '') : '';
    const img = (figure.elements || []).find((e) => e.type === 'illustration');
    if (!PDF_FONTS) $('fig-pdf-fonts').closest('.row').hidden = true;
    const dpi = img && tool.image ? Math.round(tool.image.width / (img.width / 300)) : 0;
    const minDpi = (Fig.JOURNALS[tool.fig.journal] || {}).min_image_dpi || 300;
    const good = [figure.canvas.width_mm + ' × ' + figure.canvas.height_mm + ' mm (' + jt.name + ' allows ' + jt.max_height_mm + ' mm tall)', 'Text ' + span + ' pt, panel letters ' + ty.panel_pt + ' pt bold', 'Lines ' + style.stroke.default_pt + ' pt',
      'Text stays editable in SVG and PDF', 'RGB colour'];
    const warn = problems.slice();
    if (img && dpi < minDpi) warn.push('The panel a image is ' + dpi + ' dpi at this size and ' + jt.name + ' asks for ' + minDpi + '. Export it from BioRender at that resolution or more and add it with the button above before submitting.');
    $('checks').replaceChildren(...good.map((t) => el('li', { text: t })), ...warn.map((t) => el('li', { class: 'warn', text: t })));
    $('txt-caption').textContent = (tool.fig.journal === 'nature' ? 'Fig. 1 | ' : 'Figure 1. ') + figure.figure_meta.caption + (img && tool.image && /BioRender/.test(tool.image.credit || '') ? ' Panel a created in BioRender.' : '');
    $('fig-size').textContent = 'The proof is enlarged; hover a bar or point to read its values. ' + (note || '');
    $('fig-yt').placeholder = 'Patients with ' + lc(tool.result.event) + ' (%)';
    $('image-row').hidden = tool.fig.panelA !== 'image';
    $('image-note').textContent = tool.image ? (tool.image.credit || '') : 'No image yet: panel a falls back to the vector schematic until you add one.';
  }
  function render() {
    exportMsg('');
    if (!tool.result || !tool.result.ok) {
      tool.built = null;
      proof.replaceChildren(el('p', { class: 'empty', text: 'The figure appears here once the table above is complete.' }));
      jsonBox.value = ''; styleBox.value = ''; clear($('checks')); $('txt-caption').textContent = ''; $('fig-size').textContent = '';
      return;
    }
    const built = Fig.buildFigure(tool.result, opts());
    tool.custom = false;
    jsonBox.value = forBox(built.figure); $('json-msg').textContent = '';
    show(built);
  }
  studio = { render };

  // ----- controls -----
  const bind = (id, key, map, after) => { $(id).onchange = () => { tool.fig[key] = map ? map($(id).value) : $(id).value; after && after(); render(); }; };
  bind('fig-journal', 'journal', null, fillColumns); bind('fig-column', 'column'); bind('fig-panel-a', 'panelA'); bind('fig-style', 'style');
  bind('fig-palette', 'palette'); bind('fig-pa', 'pA'); bind('fig-pb', 'pB');
  $('fig-border').onchange = () => { tool.fig.border = $('fig-border').checked; render(); };
  [['fig-xt', 'xTitle', 'Dose group'], ['fig-yt', 'yTitle', ''], ['fig-pop', 'population', 'Patients'], ['fig-design', 'design', 'Randomized'], ['fig-dur', 'duration', 'for example, 10 days of dosing']].forEach(([id, key, ph]) => {
    $(id).placeholder = ph; $(id).oninput = () => { tool.fig[key] = $(id).value.trim(); render(); };
  });
  $('image-in').onchange = function () {
    const file = this.files && this.files[0]; this.value = '';
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) { exportMsg('Use a PNG or JPEG image for panel a.'); return; }
    const fr = new FileReader();
    fr.onload = () => { const im = new Image(); im.onload = () => { tool.image = { href: fr.result, width: im.naturalWidth, height: im.naturalHeight, credit: 'Your image, ' + im.naturalWidth + ' × ' + im.naturalHeight + ' px.' }; tool.fig.panelA = 'image'; $('fig-panel-a').value = 'image'; render(); }; im.src = fr.result; };
    fr.readAsDataURL(file);
  };
  const tabs = [['tab-proof', 'pane-proof'], ['tab-json', 'pane-json'], ['tab-style', 'pane-style']];
  tabs.forEach(([t, p]) => ($(t).onclick = () => tabs.forEach(([t2, p2]) => { $(t2).setAttribute('aria-selected', String(t2 === t)); $(p2).hidden = p2 !== p; })));
  $('btn-json-apply').onclick = () => {
    let fig;
    try { fig = JSON.parse(jsonBox.value); } catch (e) { $('json-msg').textContent = 'That is not valid JSON: ' + e.message; return; }
    if (!fig || !fig.canvas || !Array.isArray(fig.elements)) { $('json-msg').textContent = 'The JSON needs a canvas and an elements list.'; return; }
    (fig.elements || []).forEach((e) => { if (e.image_href === IMG) e.image_href = tool.image ? tool.image.href : ''; });
    fig.canvas.height_mm = Math.round(fig.canvas.height / Fig.MM * 10) / 10;
    tool.custom = true;
    show({ figure: fig, style: tool.built ? tool.built.style : Fig.makeStyle(opts()) }, 'Showing your edited JSON.');
    $('json-msg').textContent = 'Applied. The proof and every export now come from this JSON.';
    $('tab-proof').click();
  };
  $('btn-json-reset').onclick = render;

  // ----- exports -----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function withDpi(buf, dpi) { // write the resolution into the PNG (pHYs chunk) so layout software reads the right size
    const src = new Uint8Array(buf), chunk = new Uint8Array(21), dv = new DataView(chunk.buffer), ppm = Math.round(dpi / 0.0254);
    dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(src.length + 21);
    out.set(src.subarray(0, 33)); out.set(chunk, 33); out.set(src.subarray(33), 54);
    return new Blob([out], { type: 'image/png' });
  }
  const svgText = () => '<?xml version="1.0" encoding="UTF-8"?>\n' + Fig.renderSVG(tool.built.figure, tool.built.style);
  function raster(dpi) {
    return new Promise((resolve, reject) => {
      const cv0 = tool.built.figure.canvas, wPx = Math.round(cv0.width * dpi / 300), hPx = Math.round(cv0.height * dpi / 300);
      const svg = svgText().replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="' + wPx + '" height="' + hPx + '"');
      const img = new Image();
      img.onload = () => {
        try {
          const cv = el('canvas'); cv.width = wPx; cv.height = hPx;
          const g = cv.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, wPx, hPx); g.drawImage(img, 0, 0, wPx, hPx);
          cv.toBlob((b) => (b ? b.arrayBuffer().then((buf) => resolve(withDpi(buf, dpi)), reject) : reject(new Error('size'))), 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('render'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  // PDF embeds JPEG data directly; a PNG panel is redrawn as JPEG first.
  function figureForPdf() {
    const fig = tool.built.figure, pic = (fig.elements || []).find((e) => e.type === 'illustration' && e.image_href && !/^data:image\/jpe?g/.test(e.image_href));
    if (!pic) return Promise.resolve(fig);
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { const cv = el('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0);
        const copy = JSON.parse(JSON.stringify(fig)); copy.elements.find((e) => e.id === pic.id).image_href = cv.toDataURL('image/jpeg', 0.92); resolve(copy); };
      im.onerror = () => resolve(fig);
      im.src = pic.image_href;
    });
  }
  const stem = () => { const ev = (tool.result && tool.result.event ? tool.result.event : 'figure').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); return 'fig1_' + (ev || 'figure') + '_dose_trend'; };
  function save(filename, data, mime) {
    if (!inClaude) { // opened as a plain file: an ordinary browser download works
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: mime }));
      const a = el('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      exportMsg('Saved ' + filename + '.');
      return Promise.resolve();
    }
    return window.claude.use('downloads').then((d) => {
      if (!d) { exportMsg('Downloads are not available in this view. Use Copy SVG code instead.'); return; }
      return d.save({ filename, data }).then(() => exportMsg('Saved ' + filename + '.'), (e) => {
        const code = e && e.code;
        exportMsg(code === 'declined' ? 'Download cancelled.' : code === 'rate_limited' ? 'A download prompt is already open. Answer it, then try again.' : 'The file could not be saved here. Use Copy SVG code instead.');
      });
    });
  }
  const ready = () => { if (!tool.built) { exportMsg('Complete the table first.'); return false; } exportMsg(''); return true; };
  $('btn-svg').onclick = () => { if (ready()) save(stem() + '.svg', svgText(), 'image/svg+xml'); };
  // Preflight at a journal looks for embedded TrueType fonts. The other choice suits anyone who will reopen the PDF
  // in Illustrator on a machine that has Helvetica and would rather not be asked about a missing font.
  const pdfFonts = () => ($('fig-pdf-fonts').value === 'embed' && PDF_FONTS ? getPdfFonts().then((f) => (f ? { fonts: f } : undefined)) : Promise.resolve(undefined));
  const fontsNote = () => { $('pdf-fonts-note').textContent = $('fig-pdf-fonts').value === 'embed' ? 'Passes a journal’s font check. Arimo is an open face drawn to Arial’s measurements.' : 'Smaller file. The reader’s own Helvetica or Arial is used, and a preflight check may flag the fonts as not embedded.'; };
  $('fig-pdf-fonts').onchange = fontsNote; fontsNote();
  $('btn-pdf').onclick = () => { if (ready()) Promise.all([figureForPdf(), pdfFonts()]).then(([fig, fonts]) => save(stem() + '.pdf', new Blob([Fig.renderPDF(fig, tool.built.style, fonts)], { type: 'application/pdf' }), 'application/pdf')); };
  $('btn-png').onclick = () => {
    if (!ready()) return;
    const dpi = Number($('fig-dpi').value);
    exportMsg('Rendering at ' + dpi + ' dpi…');
    const low = dpi < ((Fig.JOURNALS[tool.fig.journal] || {}).min_image_dpi || 300) ? ' ' + Fig.JOURNALS[tool.fig.journal].name + ' asks for at least ' + Fig.JOURNALS[tool.fig.journal].min_image_dpi + ' dpi.' : '';
    raster(dpi).then((blob) => save(stem() + '_' + dpi + 'dpi.png', blob, 'image/png').then(() => { if (low) exportMsg($('export-msg').textContent + low); }), () => exportMsg('This browser could not render the image at ' + dpi + ' dpi. Choose a lower resolution, or use the SVG or PDF.'));
  };
  $('btn-json').onclick = () => { if (ready()) save(stem() + '.json', JSON.stringify(Object.assign({}, tool.built.figure, { style: tool.built.style }), null, 1), 'application/json'); };
  $('btn-copy-svg').onclick = () => { if (ready()) copyText(svgText(), (ok) => exportMsg(ok ? 'SVG code copied.' : 'Copying is blocked in this view. Use the SVG button instead.')); };
  if (inClaude) window.claude.use('downloads').then((d) => { if (!d) { ['btn-svg', 'btn-pdf', 'btn-png', 'btn-json', 'fig-dpi'].forEach((id) => { $(id).hidden = true; }); $('fig-pdf-fonts').closest('.row').hidden = true; exportMsg('Downloads are not available in this view. Use Copy SVG code.'); } });

  fillColumns();
  window.__tool = tool; // read by the page test
}
loadExample();
setMsg('');
