/* Figure pipeline in the sci-figure-gen manner: results -> figure JSON -> SVG (and PDF).
   The JSON is the source of truth; both renderers only read it. Canvas units are px at 300 dpi. */
(function (root) {
  'use strict';
  var C = root.Core || (typeof require !== 'undefined' ? require('./core.js') : null);
  var PT = 300 / 72;      // px per typographic point
  var MM = 300 / 25.4;    // px per millimetre

  // ---------- journal presets (sci-figure-gen references/journal-templates.md) ----------
  var JOURNALS = {
    nature:  { name: 'Nature', widths: { single: 89, onehalf: 120, double: 183 }, max_height_mm: 247, min_font_pt: 5, max_font_pt: 7, panel_pt: 8, panel_format: 'lowercase_bold', min_image_dpi: 450 },
    cell:    { name: 'Cell', widths: { single: 85, onehalf: 114, double: 174 }, max_height_mm: 234, min_font_pt: 6, max_font_pt: 8, panel_pt: 9, panel_format: 'uppercase_parens' },
    science: { name: 'Science', widths: { single: 55, onehalf: 115, double: 174 }, max_height_mm: 234, min_font_pt: 6, max_font_pt: 8, panel_pt: 9, panel_format: 'uppercase_parens' },
    pnas:    { name: 'PNAS', widths: { single: 87, onehalf: 114, double: 178 }, max_height_mm: 232, min_font_pt: 6, max_font_pt: 8, panel_pt: 9, panel_format: 'uppercase_bold' },
    lancet:  { name: 'The Lancet', widths: { single: 89, onehalf: 120, double: 183 }, max_height_mm: 247, min_font_pt: 8, max_font_pt: 9, panel_pt: 10, panel_format: 'uppercase_bold' },
    nejm:    { name: 'NEJM', widths: { single: 84, onehalf: 120, double: 174 }, max_height_mm: 234, min_font_pt: 8, max_font_pt: 9, panel_pt: 10, panel_format: 'uppercase_bold' }
  };
  // sci-figure-gen "soft but lively" palette
  var PALETTE = { near_black: '#2D2D2D', dark_gray: '#5A5A5A', soft_orange: '#E6B47C', soft_blue: '#90BCDF', soft_teal: '#70BAA6',
    soft_yellow: '#F1DF8E', muted_blue: '#7499C1', soft_vermillion: '#D29583', soft_mauve: '#C499BA', light_gray: '#EDEDED', white: '#FFFFFF' };

  // ---------- Helvetica metrics (Adobe AFM; Arial is metric-compatible) ----------
  var HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  var EXTRA_W = { '−': 584, '–': 556, '—': 1000, '×': 584, '±': 584, '≥': 549, '≤': 549, '’': 222, '‘': 222,
    '“': 333, '”': 333, '·': 278, '°': 400, 'µ': 556, ' ': 278, 'χ': 549, '²': 333, '→': 1000 };
  function charW(ch, bold) {
    var c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return (bold ? HELV_B : HELV)[c - 32];
    return EXTRA_W[ch] || 556;
  }
  function textW(str, size, bold) {
    var w = 0; str = String(str);
    for (var i = 0; i < str.length; i++) w += charW(str[i], bold);
    return w * size / 1000;
  }
  // "*P* = 0.077" -> [{t:'P', i:true}, {t:' = 0.077'}]
  function runsOf(content) {
    var parts = String(content).split('*'), out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i] !== '') out.push({ t: parts[i], i: i % 2 === 1 });
    return out;
  }
  function plain(content) { return String(content).replace(/\*/g, ''); }
  // "Randomized, double-blind" is; "observational", "not randomized", "non-randomised" and an empty design are not.
  function isRandomized(design) {
    var d = String(design || '');
    return /\brandomi[sz]/i.test(d) && !/\b(?:not|non|un)[-\s]?randomi[sz]/i.test(d);
  }
  function wrapLines(str, maxW, size, bold, maxLines) {
    var words = String(str).split(/\s+/).filter(Boolean), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (!cur || textW(t, size, bold) <= maxW) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) lines = lines.slice(0, maxLines - 1).concat(lines.slice(maxLines - 1).join(' '));
    return lines.length ? lines : [''];
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function mix(hex, t) { // blend a colour toward white: t = 1 keeps it, t = 0 gives white
    var n = parseInt(hex.slice(1), 16), ch = [n >> 16 & 255, n >> 8 & 255, n & 255];
    return '#' + ch.map(function (v) { return ('0' + Math.round(255 - (255 - v) * t).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  function lc(s) { s = String(s || ''); return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; }
  function panelText(fmt, i) {
    var ch = 'abcdefgh'[i];
    return fmt === 'uppercase_parens' ? '(' + ch.toUpperCase() + ')' : fmt === 'uppercase_bold' ? ch.toUpperCase() : ch;
  }

  // ---------- style.json ----------
  function makeStyle(o) {
    var j = JOURNALS[o.journal] || JOURNALS.nature;
    var label = Math.min(j.max_font_pt, Math.max(j.min_font_pt, 7));
    var grey = o.palette === 'grey';
    return {
      style_id: (o.styleId || 'dose_trend') + '_' + (o.journal || 'nature'),
      palette: grey
        ? { reference: '#EDEDED', dose: '#B5B5B5', marker: '#5A5A5A', group: '#DDDDDD', text: PALETTE.near_black, subtext: PALETTE.dark_gray, canvas: '#FFFFFF' }
        : { reference: PALETTE.light_gray, dose: PALETTE.soft_blue, marker: PALETTE.muted_blue, group: '#DDDDDD', text: PALETTE.near_black, subtext: PALETTE.dark_gray, canvas: '#FFFFFF' },
      typography: { font: 'Arial, Helvetica, sans-serif', label_pt: label, tick_pt: Math.max(j.min_font_pt, label - 1), panel_pt: j.panel_pt, min_pt: j.min_font_pt, max_pt: j.max_font_pt },
      stroke: { default_pt: 0.5, emphasis_pt: 0.75, color: PALETTE.near_black },
      journal_template: { name: j.name, column: o.column || 'double', width_mm: j.widths[o.column || 'double'], width_px: Math.round(j.widths[o.column || 'double'] * MM),
        max_height_mm: j.max_height_mm, min_font_pt: j.min_font_pt, panel_format: j.panel_format }
    };
  }

  // ---------- results -> figure JSON ----------
  // res: Core.analyze() output.  o: figure options.  Returns { figure, style }.
  function buildFigure(res, o) {
    o = o || {};
    var style = makeStyle(o), jt = style.journal_template, pal = style.palette, ty = style.typography;
    var W = jt.width_px, m = Math.round(1.2 * MM);
    var fs = ty.label_pt * PT, fsT = ty.tick_pt * PT, fsP = ty.panel_pt * PT, lh = fsT * 1.22;
    var sw = style.stroke.default_pt * PT, ink = style.stroke.color;
    var els = [], cons = [], groups = [], anns = [];
    var ev = res.event || 'the event', evl = lc(ev);
    var study = o.study || {};
    var panels = [];
    var wantA = o.panelA === 'image' ? (o.image && o.image.href ? 'image' : 'schematic') : (o.panelA === 'none' ? 'none' : 'schematic');
    var hasC = (res.pairs || []).length > 0;
    var pAlt = o.alt || 'two';
    function pick(t) { return pAlt === 'two' ? t.pTwo : pAlt === 'inc' ? t.pInc : t.pDec; }

    function text(id, content, x, y, extra) {
      var a = { id: id, type: 'text', content: content, x: r1(x), y: r1(y), font_size: r1(fsT), text_color: pal.text, anchor: 'start' };
      if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
      anns.push(a); return a;
    }
    function pathEl(id, d, panel, extra) {
      var e = { id: id, type: 'custom_path', path_d: d, fill: 'none', stroke: ink, stroke_width: r1(sw), panel_id: panel };
      if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
      els.push(e); return e;
    }
    function panelLabel(i, x, y) {
      var id = 'abcdefgh'[i]; panels.push(id);
      text('panel_label_' + id, panelText(jt.panel_format, i), x, y + fsP * 0.76, { font_size: r1(fsP), font_weight: 'bold', panel_id: id });
      return id;
    }
    var headH = fsP * 1.25; // band that holds the panel letter and the panel's one-line annotation

    // ----- panel: trial design (vector schematic, sci-figure-gen "schematic" conventions) -----
    function schematic(pi, x0, y0, w) {
      var id = panelLabel(pi, x0, y0);
      var arms = res.groups, k = arms.length, narrow = w < 1400;
      var top = y0 + headH + fsT * 0.9;
      var armH = Math.round(fsT * 1.75), gap = Math.round(fsT * 0.42);
      var nDoseArms = arms.filter(function (g) { return g.role !== 'ref'; }).length;
      var band = nDoseArms > 1 && study.groupLabel ? Math.round(fsT * 1.45) : 0; // room for the group's label above the dose arms
      var armsH = k * armH + (k - 1) * gap + band;
      var popW = narrow ? w * 0.255 : w * 0.17, outW = narrow ? w * 0.225 : w * 0.17;
      var rS = fsT * 1.25; // half-diagonal of the randomization diamond
      var gapA = narrow ? w * 0.04 : w * 0.05;
      var armX0 = x0 + popW + gapA + 2 * rS + gapA;
      var armX1 = x0 + w - outW - gapA * 1.25;
      var armW = armX1 - armX0, cy = top + armsH / 2;
      var nTot = study.nTotal || arms.reduce(function (a, g) { return a + g.n; }, 0);
      var popLines = wrapLines(study.population || 'Patients', popW - fsT * 1.5, fsT, true, 4);
      var popH = Math.max(armH * 2.4, (popLines.length + 1.6) * lh + fsT * 0.6);
      els.push({ id: 'node_population', type: 'rectangle', label: popLines.join('\n'), sublabel: '*n* = ' + nTot, x: r1(x0 + popW / 2), y: r1(cy), width: r1(popW), height: r1(popH), rx: r1(fsT * 0.35),
        fill: mix(PALETTE.soft_orange, 0.45), stroke: ink, stroke_width: r1(sw), font_size: r1(fsT), font_weight: 'bold', text_color: pal.text, panel_id: id });
      var rx = x0 + popW + gapA + rS;
      // The branching node says only what the design says: the CONSORT "R" diamond when the design mentions
      // randomization, otherwise a plain allocation node, so a non-randomized study is not drawn as a trial.
      var randomized = isRandomized(study.design);
      if (randomized) els.push({ id: 'node_allocation', type: 'diamond', label: 'R', x: r1(rx), y: r1(cy), width: r1(2 * rS), height: r1(2 * rS), fill: '#FFFFFF', stroke: ink, stroke_width: r1(sw),
        font_size: r1(fsT), font_weight: 'bold', text_color: pal.text, panel_id: id, notes: 'Randomization (R) shown as a branching node' });
      else els.push({ id: 'node_allocation', type: 'circle', x: r1(rx), y: r1(cy), width: r1(rS * 0.9), height: r1(rS * 0.9), fill: '#FFFFFF', stroke: ink, stroke_width: r1(sw), panel_id: id,
        notes: 'Allocation to groups shown as a branching node' + (study.design ? ' (' + study.design + ')' : '; the design was not given') });
      // The design note sits under the node when there is room; in a narrow figure it joins the duration line.
      var dLines = narrow || !study.design ? [] : wrapLines(study.design, gapA * 2 + 2 * rS - fsT * 0.2, fsT, false, 3);
      dLines.forEach(function (ln, i) { text('ann_design_' + i, ln, rx, cy + rS + lh * (i + 1), { anchor: 'middle', panel_id: id }); });
      cons.push({ id: 'conn_population_to_allocation', from: 'node_population', to: 'node_allocation', type: 'solid_arrow', stroke: PALETTE.dark_gray, stroke_width: r1(sw), path_style: 'straight' });
      var doseIdx = 0, nDose = nDoseArms, members = [], yCur = top;
      var trunkIn = rx + rS + gapA * 0.45, trunkOut = armX1 + gapA * 0.55;
      arms.forEach(function (g, i) {
        var isRef = g.role === 'ref';
        if (!isRef && doseIdx === 0) yCur += band;
        var y = yCur + armH / 2; yCur += armH + gap;
        var tint = isRef ? pal.reference : mix(pal.dose, nDose > 1 ? 0.4 + 0.6 * doseIdx / (nDose - 1) : 1);
        if (!isRef) doseIdx++;
        var nid = 'node_arm_' + i;
        els.push({ id: nid, type: 'rectangle', label: g.label, sublabel: '*n* = ' + g.n, label_align: 'left', sublabel_align: 'right', x: r1((armX0 + armX1) / 2), y: r1(y), width: r1(armW), height: armH, rx: r1(fsT * 0.3),
          fill: tint, stroke: ink, stroke_width: r1(sw), font_size: r1(fsT), font_weight: 'bold', text_color: pal.text, group_id: isRef ? null : 'group_dose_arms', panel_id: id });
        if (!isRef) members.push(nid);
        cons.push({ id: 'conn_allocation_to_arm_' + i, from: 'node_allocation', to: nid, type: 'solid_arrow', stroke: PALETTE.dark_gray, stroke_width: r1(sw), path_style: 'orthogonal', via_x: r1(trunkIn) });
        cons.push({ id: 'conn_arm_' + i + '_to_outcome', from: nid, to: 'node_outcome', type: 'line', stroke: PALETTE.dark_gray, stroke_width: r1(sw), path_style: 'orthogonal', via_x: r1(trunkOut) });
      });
      if (members.length > 1 && study.groupLabel) {
        groups.push({ id: 'group_dose_arms', label: study.groupLabel, label_position: 'top-right', members: members, fill: pal.group, fill_opacity: 0.15, stroke: '#999999', stroke_dash: '4,2', padding: r1(gap * 0.5), font_size: r1(fsT), panel_id: id });
      }
      var outLines = wrapLines(study.outcome || 'Events recorded', outW - fsT * 1.5, fsT, true, 4);
      var outH = Math.max(armH * 2.4, (outLines.length + 1.6) * lh + fsT * 0.6);
      var ox = x0 + w - outW / 2;
      els.push({ id: 'node_outcome', type: 'rectangle', label: outLines.join('\n'), sublabel: ev.charAt(0).toUpperCase() + ev.slice(1), x: r1(ox), y: r1(cy), width: r1(outW), height: r1(outH), rx: r1(fsT * 0.35),
        fill: mix(PALETTE.soft_teal, 0.4), stroke: ink, stroke_width: r1(sw), border_style: 'double', font_size: r1(fsT), font_weight: 'bold', text_color: pal.text, panel_id: id, notes: 'Double border marks the key output' });
      cons.push({ id: 'conn_trunk_to_outcome', from: 'node_arm_' + Math.floor((k - 1) / 2), to: 'node_outcome', type: 'solid_arrow', stroke: PALETTE.dark_gray, stroke_width: r1(sw), path_style: 'orthogonal', via_x: r1(trunkOut), arrow_only: true });
      var bottom = top + armsH;
      var note = narrow ? [study.design, study.duration].filter(Boolean).join('; ') : study.duration;
      if (note) {
        var ty0 = bottom + gap + fsT * 0.55;
        pathEl('timeline', 'M' + r1(armX0) + ' ' + r1(ty0 - fsT * 0.3) + ' V' + r1(ty0 + fsT * 0.3) + ' M' + r1(armX0) + ' ' + r1(ty0) + ' H' + r1(armX1) + ' M' + r1(armX1) + ' ' + r1(ty0 - fsT * 0.3) + ' V' + r1(ty0 + fsT * 0.3), id, { stroke: PALETTE.dark_gray });
        var nLines = wrapLines(note, w * 0.9, fsT, false, 2), nW = Math.max.apply(null, nLines.map(function (t) { return textW(t, fsT); }));
        var ncx = Math.min(Math.max((armX0 + armX1) / 2, x0 + nW / 2), x0 + w - nW / 2);
        nLines.forEach(function (ln, i) { text('ann_duration_' + i, ln, ncx, ty0 + lh * (i + 1), { anchor: 'middle', panel_id: id }); });
        bottom = ty0 + lh * nLines.length + fsT * 0.3;
      }
      bottom = Math.max(bottom, cy + rS + lh * dLines.length + fsT * 0.3, cy + popH / 2, cy + outH / 2);
      return bottom - y0;
    }

    // ----- panel: an illustration supplied as an image (a BioRender export, for example) -----
    function picture(pi, x0, y0, w, maxH) {
      var id = panelLabel(pi, x0, y0);
      var im = o.image, ar = im.height / im.width, top = y0 + headH;
      var iw = w, ih = iw * ar;
      if (maxH && ih > maxH) { ih = maxH; iw = ih / ar; }
      els.push({ id: 'illus_trial_design', type: 'illustration', illustration_type: 'image', image_href: im.href, x: r1(x0 + w / 2), y: r1(top + ih / 2), width: r1(iw), height: r1(ih), panel_id: id,
        notes: im.credit || 'Supplied illustration' });
      return headH + ih;
    }

    // ----- panel: incidence by group -----
    function incidence(pi, x0, y0, w, plotH) {
      var id = panelLabel(pi, x0, y0), g = res.groups, k = g.length;
      var STEPS = [[10, 2], [20, 5], [30, 10], [40, 10], [50, 10], [60, 20], [80, 20], [100, 20]];
      var maxHi = Math.max.apply(null, g.map(function (q) { return 100 * q.hi; })), ys = STEPS[STEPS.length - 1];
      if (!o.yFull) for (var q = 0; q < STEPS.length; q++) if (maxHi <= STEPS[q][0]) { ys = STEPS[q]; break; }
      var yMax = ys[0], yStep = ys[1], tick = 0.9 * MM;
      var yTitle = o.yTitle || ('Patients with ' + evl + ' (%)');
      var yLines = wrapLines(yTitle, plotH + fs * 3, fs, false, 2);
      var mL = yLines.length * fs * 1.2 + fsT * 0.5 + textW(String(yMax), fsT) + fsT * 0.35 + tick;
      var px0 = x0 + mL, px1 = x0 + w - sw, py0 = y0 + headH + fsT * 0.4, py1 = py0 + plotH, band = (px1 - px0) / k;
      function Y(v) { return py1 - v / yMax * plotH; }
      var tr = res.trend;
      if (tr && tr.computable) {
        var exact = o.pA === 'exact', p = pick(exact ? tr.exact : tr);
        var tail = '*P* ' + C.fmtPeq(p) + (pAlt !== 'two' ? ' (one-sided)' : '');
        var lead = (exact ? (tr.exact.method === 'mc' ? 'Permutation ' : 'Exact ') : '') + 'Cochran–Armitage trend test, ';
        if (textW(plain(lead + tail), fsT) > px1 - x0 - fsP * 1.6) lead = exact ? 'Exact trend test, ' : 'Trend test, ';
        text('ann_trend_test', lead + tail, px1, y0 + fsP * 0.76, { anchor: 'end', panel_id: id });
      }
      pathEl('axis_incidence', 'M' + r1(px0) + ' ' + r1(py0) + ' V' + r1(py1) + ' H' + r1(px1), id);
      var td = '';
      for (var v = 0; v <= yMax + 1e-9; v += yStep) {
        td += 'M' + r1(px0 - tick) + ' ' + r1(Y(v)) + ' H' + r1(px0) + ' ';
        text('tick_y_' + v, String(v), px0 - tick - fsT * 0.35, Y(v) + fsT * 0.35, { anchor: 'end', panel_id: id });
      }
      pathEl('ticks_incidence', td.trim(), id);
      yLines.forEach(function (ln, i) { text('title_y_' + i, ln, x0 + fs * 0.85 + i * fs * 1.2, py0 + plotH / 2, { anchor: 'middle', rotate: -90, font_size: r1(fs), panel_id: id }); });
      var labLines = g.map(function (q) { return wrapLines(q.label, band - fsT * 0.3, fsT, false, 2); });
      var nL = Math.max.apply(null, labLines.map(function (l) { return l.length; }));
      var cap = fsT * 0.32;
      g.forEach(function (q, i) {
        var cx = px0 + band * (i + 0.5), yP = Y(100 * q.p), yLo = Y(100 * q.lo), yHi = Y(100 * q.hi), isRef = q.role === 'ref';
        var fill = isRef ? pal.reference : pal.dose;
        if (o.style !== 'points') {
          var bw = Math.min(band * 0.58, 7.5 * MM);
          if (q.r > 0) els.push({ id: 'bar_' + i, type: 'rectangle', x: r1(cx), y: r1((yP + py1) / 2), width: r1(bw), height: r1(py1 - yP), rx: 0, fill: fill, stroke: ink, stroke_width: r1(sw), panel_id: id,
            notes: q.label + ': ' + q.r + '/' + q.n + ' = ' + (100 * q.p).toFixed(1) + '%' });
        }
        pathEl('ci_' + i, 'M' + r1(cx) + ' ' + r1(yLo) + ' V' + r1(yHi) + ' M' + r1(cx - cap) + ' ' + r1(yLo) + ' H' + r1(cx + cap) + ' M' + r1(cx - cap) + ' ' + r1(yHi) + ' H' + r1(cx + cap), id,
          { notes: 'Wilson 95% CI ' + (100 * q.lo).toFixed(1) + ' to ' + (100 * q.hi).toFixed(1) + '%' });
        if (o.style === 'points') els.push({ id: 'point_' + i, type: 'circle', x: r1(cx), y: r1(yP), width: r1(fsT * 0.62), height: r1(fsT * 0.62), fill: isRef ? '#FFFFFF' : pal.marker, stroke: ink, stroke_width: r1(sw), panel_id: id });
        labLines[i].forEach(function (ln, j) { text('tick_x_' + i + '_' + j, ln, cx, py1 + fsT * 1.25 + j * lh, { anchor: 'middle', panel_id: id }); });
        text('count_' + i, q.r + '/' + q.n, cx, py1 + fsT * 1.25 + nL * lh, { anchor: 'middle', panel_id: id });
      });
      var xBase = py1 + fsT * 1.25 + (nL + 1) * lh + fs * 0.25;
      var xLines = wrapLines(o.xTitle || 'Dose group', px1 - px0 + fs * 2, fs, false, 2);
      xLines.forEach(function (ln, i) { text('title_x_' + i, ln, (px0 + px1) / 2, xBase + i * fs * 1.2, { anchor: 'middle', font_size: r1(fs), panel_id: id }); });
      return xBase + (xLines.length - 1) * fs * 1.2 + fs * 0.35 - y0;
    }

    // ----- panel: each dose against the reference -----
    function forest(pi, x0, y0, w, plotH) {
      var id = panelLabel(pi, x0, y0), pr = res.pairs, mN = pr.length, refL = lc(res.ref.label);
      var rd = pr.map(function (d) { return C.fmtSigned(100 * d.rd, 1) + ' (' + C.fmtNum(100 * d.lo, 1) + ' to ' + C.fmtNum(100 * d.hi, 1) + ')'; });
      var adj = o.pB !== 'raw' && mN > 1;
      var pv = pr.map(function (d) { return C.fmtP(adj ? d.pHolm : d.p); });
      var rich = w >= 1500; // room for events and both P columns
      var hRD = 'Difference (95% CI)', hP = adj ? 'Adj. *P*' : '*P*';
      var colRD = Math.max.apply(null, rd.map(function (t) { return textW(t, fsT); }).concat(textW(hRD, fsT)));
      var colP = Math.max.apply(null, pv.map(function (t) { return textW(t, fsT); }).concat(textW(plain(hP), fsT)));
      var labL = pr.map(function (d) { return wrapLines(d.label, Math.max(11 * MM, 0.22 * w), fsT, false, 2); });
      var wLab = Math.max.apply(null, labL.map(function (ls) { return Math.max.apply(null, ls.map(function (t) { return textW(t, fsT); })); }));
      var g1 = fsT * 0.9, tick = 0.9 * MM;
      var evs = pr.map(function (d) { return d.r + '/' + d.n; }), hEv = 'Events/*n*', hRef = 'vs ' + refL + ' ' + res.ref.r + '/' + res.ref.n;
      var colEv = rich ? Math.max.apply(null, evs.map(function (t) { return textW(t, fsT); }).concat(textW(plain(hEv), fsT))) + g1 * 1.6 : 0;
      var rawP = pr.map(function (d) { return C.fmtP(d.p); });
      var colRaw = rich && adj ? Math.max.apply(null, rawP.map(function (t) { return textW(t, fsT); }).concat(textW('P', fsT))) + g1 * 1.6 : 0;
      var px0 = x0 + wLab + colEv + g1, px1 = x0 + w - (g1 + colRD + colRaw + g1 * 1.3 + colP), py0 = y0 + headH + fsT * 0.4, py1 = py0 + plotH;
      var plotW = Math.max(9 * MM, px1 - px0); px1 = px0 + plotW;
      var lo = Math.min.apply(null, pr.map(function (d) { return 100 * d.lo; }).concat(0)), hi = Math.max.apply(null, pr.map(function (d) { return 100 * d.hi; }).concat(0));
      var step = (hi - lo) <= 40 ? 10 : (hi - lo) <= 120 ? 20 : 50, a, b;
      function ft(v) { return (v < 0 ? C.MINUS : '') + Math.abs(v); }
      for (var gd = 0; gd < 6; gd++) {
        a = Math.floor(lo / step) * step; b = Math.ceil(hi / step) * step; if (a === b) b = a + step;
        var wd = Math.max(textW(ft(a), fsT), textW(ft(b), fsT));
        if (((b - a) / step + 1) * (wd + fsT * 0.5) <= plotW + wd) break;
        step *= 2;
      }
      function X(v) { return px0 + (v - a) / (b - a) * plotW; }
      text('head_difference', hRD, px1 + g1, y0 + fsP * 0.76, { panel_id: id });
      text('head_p', hP, x0 + w, y0 + fsP * 0.76, { anchor: 'end', panel_id: id });
      if (rich) {
        text('head_events', hEv, x0 + wLab + colEv, y0 + fsP * 0.76, { anchor: 'end', panel_id: id });
        text('head_reference', hRef, (px0 + px1) / 2, y0 + fsP * 0.76, { anchor: 'middle', panel_id: id });
        if (colRaw) text('head_p_raw', '*P*', x0 + w - colP - g1 * 1.3, y0 + fsP * 0.76, { anchor: 'end', panel_id: id });
      }
      pathEl('zero_line', 'M' + r1(X(0)) + ' ' + r1(py0) + ' V' + r1(py1), id, { stroke: PALETTE.dark_gray, stroke_dash: '3,3', notes: 'No difference from ' + refL });
      pathEl('axis_difference', 'M' + r1(px0) + ' ' + r1(py1) + ' H' + r1(px1), id);
      var td = '';
      for (var v = a; v <= b + 1e-9; v += step) {
        td += 'M' + r1(X(v)) + ' ' + r1(py1) + ' V' + r1(py1 + tick) + ' ';
        text('tick_d_' + (v < 0 ? 'm' : '') + Math.abs(v), ft(v), X(v), py1 + tick + fsT * 1.05, { anchor: 'middle', panel_id: id });
      }
      pathEl('ticks_difference', td.trim(), id);
      var pitch = plotH / mN, cap = fsT * 0.32;
      pr.forEach(function (d, i) {
        var y = py0 + pitch * (i + 0.5), xl = X(100 * d.lo), xh = X(100 * d.hi);
        pathEl('diff_ci_' + i, 'M' + r1(xl) + ' ' + r1(y) + ' H' + r1(xh) + ' M' + r1(xl) + ' ' + r1(y - cap) + ' V' + r1(y + cap) + ' M' + r1(xh) + ' ' + r1(y - cap) + ' V' + r1(y + cap), id,
          { notes: 'Newcombe 95% CI for ' + d.label + ' minus ' + refL });
        els.push({ id: 'diff_point_' + i, type: 'circle', x: r1(X(100 * d.rd)), y: r1(y), width: r1(fsT * 0.62), height: r1(fsT * 0.62), fill: pal.marker, stroke: ink, stroke_width: r1(sw), panel_id: id });
        var ls = labL[i], off = y + fsT * 0.35 - (ls.length - 1) * lh / 2;
        ls.forEach(function (ln, j) { text('row_label_' + i + '_' + j, ln, x0 + wLab, off + j * lh, { anchor: 'end', panel_id: id }); });
        text('row_difference_' + i, rd[i], px1 + g1, y + fsT * 0.35, { panel_id: id });
        text('row_p_' + i, pv[i], x0 + w, y + fsT * 0.35, { anchor: 'end', panel_id: id });
        if (rich) {
          text('row_events_' + i, evs[i], x0 + wLab + colEv, y + fsT * 0.35, { anchor: 'end', panel_id: id });
          if (colRaw) text('row_p_raw_' + i, rawP[i], x0 + w - colP - g1 * 1.3, y + fsT * 0.35, { anchor: 'end', panel_id: id });
        }
      });
      var tLines = wrapLines('Difference from ' + refL + ' (percentage points)', w - fs, fs, false, 2);
      var tW = Math.max.apply(null, tLines.map(function (t) { return textW(t, fs); }));
      var cx = Math.min(Math.max((px0 + px1) / 2, x0 + tW / 2), x0 + w - tW / 2), base = py1 + tick + fsT * 1.05 + fs * 1.35;
      tLines.forEach(function (ln, i) { text('title_d_' + i, ln, cx, base + i * fs * 1.2, { anchor: 'middle', font_size: r1(fs), panel_id: id }); });
      return base + (tLines.length - 1) * fs * 1.2 + fs * 0.35 - y0;
    }

    // ----- arrange the panels -----
    var gapX = Math.round(5 * MM), gapY = Math.round(3.2 * MM), inner = W - 2 * m, y = m, pi = 0, H;
    var wide = jt.width_mm >= 150;
    if (wide) {
      var plotH = Math.round(Math.min(46, Math.max(34, jt.width_mm * 0.24)) * MM);
      if (wantA === 'schematic') {
        y += schematic(pi++, m, y, inner) + gapY;
        var wB = hasC ? Math.round(inner * 0.42) : Math.round(inner * 0.6);
        var hB = incidence(pi++, m, y, wB, plotH), hC = hasC ? forest(pi++, m + wB + gapX, y, inner - wB - gapX, plotH) : 0;
        y += Math.max(hB, hC);
      } else if (wantA === 'image') {
        var wA = Math.round(inner * 0.56), hA = picture(pi++, m, y, wA, plotH + fsT * 4.6);
        var hB2 = incidence(pi++, m + wA + gapX, y, inner - wA - gapX, plotH);
        y += Math.max(hA, hB2);
        if (hasC) { y += gapY; y += forest(pi++, m, y, inner, Math.max(res.pairs.length * 3.6 * MM, 12 * MM)); }
      } else {
        var wB3 = hasC ? Math.round(inner * 0.42) : inner;
        var hB3 = incidence(pi++, m, y, wB3, plotH), hC3 = hasC ? forest(pi++, m + wB3 + gapX, y, inner - wB3 - gapX, plotH) : 0;
        y += Math.max(hB3, hC3);
      }
    } else {
      var plotH2 = Math.round(Math.min(40, Math.max(27, jt.width_mm * 0.42)) * MM);
      if (wantA === 'schematic') y += schematic(pi++, m, y, inner) + gapY;
      else if (wantA === 'image') y += picture(pi++, m, y, inner, 0) + gapY;
      y += incidence(pi++, m, y, inner, plotH2);
      if (hasC) { y += gapY; y += forest(pi++, m, y, inner, Math.max(res.pairs.length * 3.6 * MM, 12 * MM)); }
    }
    H = Math.ceil(y + m);

    var figure = {
      figure_meta: { figure_id: o.figureId || 'fig1', title: ev.charAt(0).toUpperCase() + ev.slice(1) + ' by dose group', caption: caption(res, o, panels, wantA),
        figure_type: 'schematic + datavis', orientation: W >= H ? 'landscape' : 'portrait', panels: panels },
      canvas: { width: W, height: H, units: 'px at 300 dpi', width_mm: jt.width_mm, height_mm: r1(H / MM), background: '#FFFFFF', margin: m, border: o.border === false ? null : { stroke: '#E0E0E0', stroke_width: r1(sw) } },
      elements: els, connectors: cons, groups: groups, annotations: anns, legend: null
    };
    return { figure: figure, style: style };
  }

  // Figure legend, written from the same data the figure was built from.
  function caption(res, o, panels, wantA) {
    var evl = lc(res.event), tr = res.trend, s = [], i = 0, alt = o.alt || 'two';
    var title = res.event.charAt(0).toUpperCase() + res.event.slice(1) + ' by dose group.';
    function tag() { return panels.length > 1 ? panels[i++] + ', ' : ''; }
    function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
    var rnd = isRandomized(o.study && o.study.design);
    if (wantA !== 'none') s.push(tag() + cap((rnd ? 'trial' : 'study') + ' design: ' + lc((o.study && o.study.population) || 'patients') + ' were ' + (rnd ? 'randomized' : 'allocated') + ' to ' + res.groups.length + ' groups' + (o.study && o.study.duration ? ' (' + lc(o.study.duration) + ')' : '') + '.'));
    var a = tag() + cap('percentage of patients with ' + evl + ' in each group; ' + (o.style === 'points' ? 'points' : 'bars') + ' show the percentage and error bars the Wilson 95% confidence interval, with patients with the event over patients in the group under the axis.');
    if (tr && tr.computable) {
      var sc = res.scoreType === 'rank' ? 'equally spaced scores' : 'scores of ' + tr.scores.map(C.fmtScore).join(', ');
      a += ' P value from the ' + (alt === 'two' ? 'two-sided' : 'one-sided') + ' Cochran–Armitage test for trend' + (o.pA === 'exact' ? (tr.exact.method === 'mc' ? ' (Monte Carlo permutation distribution)' : ' (exact conditional distribution)') : '') + ' with ' + sc + '.';
    }
    s.push(a);
    if ((res.pairs || []).length) s.push(tag() + cap('difference in the percentage of patients with ' + evl + ' between each dose group and ' + lc(res.ref.label) + ' (points) with Newcombe hybrid-score 95% confidence intervals (bars); P values from two-sided Fisher’s exact tests' + (o.pB !== 'raw' && res.pairs.length > 1 ? ', Holm-adjusted.' : '.')));
    return title + ' ' + s.join(' ');
  }

  // ---------- validation (the skill's checklist, plus the journal's type limits) ----------
  function validate(fig, style) {
    var out = [], ids = {}, jt = style && style.journal_template, ty = style && style.typography;
    function dup(id) { if (!id) { out.push('An item has no id.'); return; } if (ids[id]) out.push('Duplicate id: ' + id + '.'); ids[id] = true; }
    (fig.elements || []).forEach(function (e) { dup(e.id); });
    (fig.annotations || []).forEach(function (a) { dup(a.id); });
    (fig.connectors || []).forEach(function (c) { dup(c.id); if (!ids[c.from]) out.push('Connector ' + c.id + ' starts at a missing element: ' + c.from + '.'); if (!ids[c.to]) out.push('Connector ' + c.id + ' ends at a missing element: ' + c.to + '.'); });
    (fig.groups || []).forEach(function (g) { (g.members || []).forEach(function (mm) { if (!ids[mm]) out.push('Group ' + g.id + ' lists a missing member: ' + mm + '.'); }); });
    if (ty) {
      var small = 0, big = 0;
      (fig.annotations || []).concat(fig.elements || []).forEach(function (t) {
        if (!t.font_size || (!t.content && !t.label)) return;
        var pt = t.font_size / PT;
        if (pt < ty.min_pt - 0.05) small++;
        if (pt > ty.max_pt + 0.05 && !/^panel_label_/.test(t.id)) big++;
      });
      if (small) out.push(small + ' text item' + (small > 1 ? 's are' : ' is') + ' below the ' + ty.min_pt + ' pt minimum for ' + jt.name + '.');
      if (big) out.push(big + ' text item' + (big > 1 ? 's are' : ' is') + ' above the ' + ty.max_pt + ' pt maximum for ' + jt.name + '.');
    }
    if (jt && fig.canvas && fig.canvas.height / MM > jt.max_height_mm) out.push('The figure is ' + r1(fig.canvas.height / MM) + ' mm tall; ' + jt.name + ' allows ' + jt.max_height_mm + ' mm.');
    return out;
  }

  // ---------- JSON -> display list (shared by the SVG and PDF renderers) ----------
  function box(e) { return { x0: e.x - e.width / 2, x1: e.x + e.width / 2, y0: e.y - e.height / 2, y1: e.y + e.height / 2 }; }
  function displayList(fig) {
    var L = [], byId = {}, cv = fig.canvas;
    (fig.elements || []).forEach(function (e) { byId[e.id] = e; });
    L.push({ op: 'rect', x: 0, y: 0, w: cv.width, h: cv.height, fill: cv.background || '#FFFFFF' });
    if (cv.border) L.push({ op: 'rect', x: cv.border.stroke_width / 2, y: cv.border.stroke_width / 2, w: cv.width - cv.border.stroke_width, h: cv.height - cv.border.stroke_width, stroke: cv.border.stroke, sw: cv.border.stroke_width });
    (fig.groups || []).forEach(function (g) {
      var bs = (g.members || []).map(function (id) { return byId[id]; }).filter(Boolean).map(box);
      if (!bs.length) return;
      var pad = g.padding || 0, fsz = g.font_size || 25;
      var x0 = Math.min.apply(null, bs.map(function (b) { return b.x0; })) - pad, x1 = Math.max.apply(null, bs.map(function (b) { return b.x1; })) + pad;
      var y0 = Math.min.apply(null, bs.map(function (b) { return b.y0; })) - pad - (g.label ? fsz * 1.15 : 0), y1 = Math.max.apply(null, bs.map(function (b) { return b.y1; })) + pad;
      L.push({ op: 'open', id: g.id });
      L.push({ op: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, rx: fsz * 0.3, fill: g.fill, fillOpacity: g.fill_opacity, stroke: g.stroke, sw: fsz * 0.06, dash: g.stroke_dash });
      if (g.label) {
        var right = g.label_position === 'top-right', mid = g.label_position === 'top-center';
        L.push({ op: 'text', x: right ? x1 - pad - fsz * 0.2 : mid ? (x0 + x1) / 2 : x0 + pad + fsz * 0.2, y: y0 + fsz * 0.95, runs: runsOf(g.label), size: fsz, anchor: right ? 'end' : mid ? 'middle' : 'start', fill: '#5A5A5A' });
      }
      L.push({ op: 'close' });
    });
    (fig.connectors || []).forEach(function (c) {
      var a = byId[c.from], b = byId[c.to]; if (!a || !b) return;
      var ba = box(a), bb = box(b), sx = ba.x1, sy = a.y, ex = bb.x0, ey = b.y, pts;
      if (c.path_style === 'orthogonal') { var vx = c.via_x !== undefined ? c.via_x : (sx + ex) / 2; pts = [[sx, sy], [vx, sy], [vx, ey], [ex, ey]]; }
      else pts = [[sx, sy], [ex, ey]];
      (c.waypoints || []).forEach(function (w, i) { pts.splice(1 + i, 0, w); });
      var arrow = c.type === 'solid_arrow' || c.type === 'dashed_arrow', size = (c.stroke_width || 2) * 4.2;
      var last = pts[pts.length - 1], prev = pts[pts.length - 2], ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
      var draw = c.arrow_only ? pts.slice(-2) : pts.slice();
      if (arrow) { draw = draw.map(function (p) { return p.slice(); }); draw[draw.length - 1] = [last[0] - Math.cos(ang) * size * 0.9, last[1] - Math.sin(ang) * size * 0.9]; }
      L.push({ op: 'path', id: c.id, d: draw.map(function (p, i) { return (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }).join(' '), stroke: c.stroke || '#5A5A5A', sw: c.stroke_width || 2, dash: c.type === 'dashed_arrow' ? '6,4' : null });
      if (arrow) L.push({ op: 'arrow', x: last[0], y: last[1], angle: ang, size: size, fill: c.stroke || '#5A5A5A' });
    });
    var panel = null;
    function setPanel(p) { if (p === panel) return; if (panel !== null) L.push({ op: 'close' }); if (p !== null) L.push({ op: 'open', id: 'panel_' + p }); panel = p; }
    function nodeText(e) {
      var fsz = e.font_size || 25, lhh = fsz * 1.22, b = box(e), bold = e.font_weight === 'bold';
      var lines = e.label ? String(e.label).split('\n') : [], inline = e.sublabel && e.sublabel_align === 'right';
      var nBlock = lines.length + (e.sublabel && !inline ? 1 : 0), y0 = e.y - (nBlock - 1) * lhh / 2 + fsz * 0.35, padX = fsz * 0.55;
      lines.forEach(function (ln, i) {
        L.push({ op: 'text', x: e.label_align === 'left' ? b.x0 + padX : e.x, y: y0 + i * lhh, runs: runsOf(ln), size: fsz, bold: bold, italic: e.font_style === 'italic', anchor: e.label_align === 'left' ? 'start' : 'middle', fill: e.text_color || '#2D2D2D' });
      });
      if (e.sublabel) L.push({ op: 'text', x: inline ? b.x1 - padX : e.x, y: inline ? e.y + fsz * 0.35 : y0 + lines.length * lhh, runs: runsOf(e.sublabel), size: fsz, anchor: inline ? 'end' : 'middle', fill: e.text_color || '#2D2D2D' });
    }
    (fig.elements || []).forEach(function (e) {
      setPanel(e.panel_id || null);
      var b = e.width !== undefined ? box(e) : null, st = { id: e.id, fill: e.fill, stroke: e.stroke, sw: e.stroke_width, dash: e.stroke_dash, title: e.notes };
      function put(o2) { Object.keys(st).forEach(function (k2) { if (o2[k2] === undefined) o2[k2] = st[k2]; }); L.push(o2); }
      if (e.type === 'rectangle') {
        put({ op: 'rect', x: b.x0, y: b.y0, w: e.width, h: e.height, rx: e.rx || 0 });
        if (e.border_style === 'double') { var ins = (e.stroke_width || 2) * 2.2; L.push({ op: 'rect', x: b.x0 + ins, y: b.y0 + ins, w: e.width - 2 * ins, h: e.height - 2 * ins, rx: Math.max(0, (e.rx || 0) - ins), stroke: e.stroke, sw: e.stroke_width }); }
      } else if (e.type === 'ellipse' || e.type === 'circle') put({ op: 'ellipse', cx: e.x, cy: e.y, rx: e.width / 2, ry: e.height / 2 });
      else if (e.type === 'diamond') put({ op: 'poly', pts: [[e.x, b.y0], [b.x1, e.y], [e.x, b.y1], [b.x0, e.y]] });
      else if (e.type === 'hexagon') { var q = e.width * 0.22; put({ op: 'poly', pts: [[b.x0 + q, b.y0], [b.x1 - q, b.y0], [b.x1, e.y], [b.x1 - q, b.y1], [b.x0 + q, b.y1], [b.x0, e.y]] }); }
      else if (e.type === 'custom_path') put({ op: 'path', d: e.path_d });
      else if (e.type === 'illustration' && e.image_href) L.push({ op: 'image', id: e.id, x: b.x0, y: b.y0, w: e.width, h: e.height, href: e.image_href, title: e.notes });
      if (e.label || e.sublabel) nodeText(e);
    });
    setPanel(null);
    L.push({ op: 'open', id: 'labels' });
    (fig.annotations || []).forEach(function (a) {
      if (a.type && a.type !== 'text') return;
      L.push({ op: 'text', id: a.id, x: a.x, y: a.y, runs: runsOf(a.content), size: a.font_size || 25, bold: a.font_weight === 'bold', italic: a.font_style === 'italic', anchor: a.anchor || 'start', rotate: a.rotate || 0, fill: a.text_color || '#2D2D2D' });
    });
    L.push({ op: 'close' });
    return L;
  }

  // ---------- SVG ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function renderSVG(fig, style, opt) {
    opt = opt || {};
    var cv = fig.canvas, L = displayList(fig), s = [], jt = style && style.journal_template;
    var wmm = cv.width_mm || r1(cv.width / MM), hmm = r1(cv.height / MM);
    s.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + wmm + 'mm" height="' + hmm + 'mm" viewBox="0 0 ' + cv.width + ' ' + cv.height + '" font-family="' + ((style && style.typography.font) || 'Arial, Helvetica, sans-serif') + '">');
    if (jt) s.push('<!-- Target: ' + esc(jt.name) + ', ' + ({ single: 'single column', onehalf: '1.5 column', double: 'double column' })[jt.column] + ', ' + jt.width_mm + ' mm -->');
    s.push('<title>' + esc(fig.figure_meta.caption || fig.figure_meta.title || '') + '</title>');
    s.push('<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="9" refX="12" refY="4.5" orient="auto"><polygon points="0 0, 12 4.5, 0 9" fill="#5A5A5A"/></marker></defs>');
    function paint(o) {
      var t = ' fill="' + (o.fill && o.fill !== 'none' ? o.fill : 'none') + '"';
      if (o.fillOpacity !== undefined && o.fillOpacity !== null) t += ' fill-opacity="' + o.fillOpacity + '"';
      if (o.stroke && o.stroke !== 'none') { t += ' stroke="' + o.stroke + '" stroke-width="' + r1(o.sw || 1) + '"'; if (o.dash) t += ' stroke-dasharray="' + String(o.dash).split(',').map(function (v) { return r1(parseFloat(v) * (o.sw || 1) / 1.5); }).join(',') + '"'; }
      return t;
    }
    function tip(o) { return opt.tooltips && o.title ? '<title>' + esc(o.title) + '</title>' : ''; }
    function wrap(tag, attrs, o) { var t = tip(o); return '<' + tag + (o.id ? ' id="' + esc(o.id) + '"' : '') + attrs + paint(o) + (t ? '>' + t + '</' + tag + '>' : '/>'); }
    L.forEach(function (o) {
      if (o.op === 'open') s.push('<g id="' + esc(o.id) + '">');
      else if (o.op === 'close') s.push('</g>');
      else if (o.op === 'rect') s.push(wrap('rect', ' x="' + r1(o.x) + '" y="' + r1(o.y) + '" width="' + r1(o.w) + '" height="' + r1(o.h) + '"' + (o.rx ? ' rx="' + r1(o.rx) + '"' : ''), o));
      else if (o.op === 'ellipse') s.push(wrap('ellipse', ' cx="' + r1(o.cx) + '" cy="' + r1(o.cy) + '" rx="' + r1(o.rx) + '" ry="' + r1(o.ry) + '"', o));
      else if (o.op === 'poly') s.push(wrap('polygon', ' points="' + o.pts.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ') + '"', o));
      else if (o.op === 'path') s.push(wrap('path', ' d="' + esc(o.d) + '"', o));
      else if (o.op === 'arrow') s.push('<polygon points="0,0 ' + r1(-o.size) + ',' + r1(-o.size * 0.38) + ' ' + r1(-o.size) + ',' + r1(o.size * 0.38) + '" fill="' + o.fill + '" transform="translate(' + r1(o.x) + ' ' + r1(o.y) + ') rotate(' + r1(o.angle * 180 / Math.PI) + ')"/>');
      else if (o.op === 'image') s.push('<image' + (o.id ? ' id="' + esc(o.id) + '"' : '') + ' x="' + r1(o.x) + '" y="' + r1(o.y) + '" width="' + r1(o.w) + '" height="' + r1(o.h) + '" preserveAspectRatio="xMidYMid meet" href="' + o.href + '" xlink:href="' + o.href + '"/>');
      else if (o.op === 'text') {
        var body = o.runs.map(function (r) { return r.i ? '<tspan font-style="italic">' + esc(r.t) + '</tspan>' : esc(r.t); }).join('');
        s.push('<text' + (o.id ? ' id="' + esc(o.id) + '"' : '') + ' x="' + r1(o.x) + '" y="' + r1(o.y) + '" font-size="' + r1(o.size) + '"' + (o.anchor && o.anchor !== 'start' ? ' text-anchor="' + o.anchor + '"' : '') +
          (o.bold ? ' font-weight="bold"' : '') + (o.italic ? ' font-style="italic"' : '') + ' fill="' + (o.fill || '#2D2D2D') + '"' + (o.rotate ? ' transform="rotate(' + o.rotate + ' ' + r1(o.x) + ' ' + r1(o.y) + ')"' : '') + '>' + body + '</text>');
      }
    });
    s.push('</svg>');
    return s.join('\n');
  }

  // ---------- PDF (vector, live text, one page at the figure's exact size) ----------
  // Text is set in one of two ways. Given opt.fonts (data/pdf_fonts.json), the four styles are embedded as subset
  // TrueType programs, which is what journal preflight looks for ("embed fonts, TrueType 42, not Type 3").
  // Without it the page names the standard Helvetica family and leaves the reader to supply it.
  var SYMBOL = { '−': 0x2D, '≤': 0xA3, '≥': 0xB3, '×': 0xB4, '±': 0xB1, '≠': 0xB9, '≈': 0xBB, 'α': 0x61, 'β': 0x62, 'χ': 0x63, 'δ': 0x64, 'μ': 0x6D, 'σ': 0x73, 'Δ': 0x44, '→': 0xAE };
  var WINANSI = { '–': 0x96, '—': 0x97, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '·': 0xB7, 'µ': 0xB5, '°': 0xB0, '²': 0xB2, ' ': 0x20 };
  var CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
  var SPACES = { '\u00A0': 1, '\u2009': 1, '\u202F': 1, '\u2002': 1, '\u2003': 1 }; // set as an ordinary space
  // Codes that Windows-1252 leaves empty; a character outside that set (a minus sign, a Greek letter) borrows one.
  var FREE_CODES = [0x81, 0x8D, 0x8F, 0x90, 0x9D, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  var FONT_KEYS = ['regular', 'bold', 'italic', 'boldItalic'];
  function b64Bytes(b64) {
    var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function hex(n, digits) { return ('0000' + n.toString(16).toUpperCase()).slice(-digits); }
  function hexRGB(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function f3(v) { return (Math.round(v * 1000) / 1000).toString(); }
  function parsePath(d) { // absolute and relative M L H V C Q Z
    var tok = String(d).match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [], i = 0, out = [], cx = 0, cy = 0, sx = 0, sy = 0, cmd = null;
    function num() { return parseFloat(tok[i++]); }
    while (i < tok.length) {
      if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
      var rel = cmd === cmd.toLowerCase() && cmd !== 'z', U = cmd.toUpperCase();
      if (U === 'Z') { out.push(['h']); cx = sx; cy = sy; continue; }
      if (U === 'M' || U === 'L') { var x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0); out.push([U === 'M' ? 'm' : 'l', x, y]); cx = x; cy = y; if (U === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; } }
      else if (U === 'H') { cx = num() + (rel ? cx : 0); out.push(['l', cx, cy]); }
      else if (U === 'V') { cy = num() + (rel ? cy : 0); out.push(['l', cx, cy]); }
      else if (U === 'C') { var a = [num(), num(), num(), num(), num(), num()]; if (rel) a = a.map(function (v, j) { return v + (j % 2 ? cy : cx); }); out.push(['c'].concat(a)); cx = a[4]; cy = a[5]; }
      else if (U === 'Q') { var q = [num(), num(), num(), num()]; if (rel) q = q.map(function (v, j) { return v + (j % 2 ? cy : cx); });
        out.push(['c', cx + 2 / 3 * (q[0] - cx), cy + 2 / 3 * (q[1] - cy), q[2] + 2 / 3 * (q[0] - q[2]), q[3] + 2 / 3 * (q[1] - q[3]), q[2], q[3]]); cx = q[2]; cy = q[3]; }
      else i++;
    }
    return out;
  }
  function jpegInfo(bytes) { // width, height and channel count from the SOF marker
    var i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      var mk = bytes[i + 1];
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { h: bytes[i + 5] << 8 | bytes[i + 6], w: bytes[i + 7] << 8 | bytes[i + 8], n: bytes[i + 9] };
      i += 2 + (bytes[i + 2] << 8 | bytes[i + 3]);
    }
    return null;
  }
  function dataUrlBytes(href) {
    var m = /^data:([^;,]+);base64,(.*)$/.exec(href); if (!m) return null;
    var bin = typeof atob === 'function' ? atob(m[2]) : Buffer.from(m[2], 'base64').toString('binary'), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes: u };
  }
  function renderPDF(fig, style, opt) {
    var cv = fig.canvas, L = displayList(fig), k = 72 / 300, Wp = cv.width * k, Hp = cv.height * k, c = [], images = [];
    var embed = opt && opt.fonts && opt.fonts.fonts ? opt.fonts.fonts : null;
    var usedFont = [false, false, false, false, false], usedCode = {}, borrowed = {}, codeToCp = {}, nBorrowed = 0;
    function embeddedCode(ch) { // character → single-byte code under Windows-1252 plus borrowed slots
      var cp = ch.charCodeAt(0), code;
      if (SPACES[ch]) { cp = 32; code = 32; }
      else if (cp >= 32 && cp < 127) code = cp;
      else if (CP1252[ch] !== undefined) code = CP1252[ch];
      else if (cp >= 0xA1 && cp <= 0xFF) code = cp;
      else if (borrowed[ch] !== undefined) code = borrowed[ch];
      else if (embed.regular.widths[cp] !== undefined && nBorrowed < FREE_CODES.length) code = borrowed[ch] = FREE_CODES[nBorrowed++];
      else { cp = 63; code = 63; } // not in the font: a question mark, so the gap is visible in proof
      codeToCp[code] = cp; usedCode[code] = true;
      return code;
    }
    c.push(f3(k) + ' 0 0 ' + f3(-k) + ' 0 ' + f3(Hp) + ' cm', '0 J 0 j');
    function blend(hex, op) { var a = hexRGB(hex); return a.map(function (v) { return 1 - (1 - v) * op; }); }
    function setPaint(o) {
      var fill = o.fill && o.fill !== 'none', stroke = o.stroke && o.stroke !== 'none';
      if (fill) c.push((o.fillOpacity !== undefined && o.fillOpacity !== null ? blend(o.fill, o.fillOpacity) : hexRGB(o.fill)).map(f3).join(' ') + ' rg');
      if (stroke) { c.push(hexRGB(o.stroke).map(f3).join(' ') + ' RG', f3(o.sw || 1) + ' w');
        c.push(o.dash ? '[' + String(o.dash).split(',').map(function (v) { return f3(parseFloat(v) * (o.sw || 1) / 1.5); }).join(' ') + '] 0 d' : '[] 0 d'); }
      return fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n';
    }
    function ellipse(cx, cy, rx, ry) { var q = 0.5522847498;
      return f3(cx + rx) + ' ' + f3(cy) + ' m ' + [[cx + rx, cy + q * ry, cx + q * rx, cy + ry, cx, cy + ry], [cx - q * rx, cy + ry, cx - rx, cy + q * ry, cx - rx, cy], [cx - rx, cy - q * ry, cx - q * rx, cy - ry, cx, cy - ry], [cx + q * rx, cy - ry, cx + rx, cy - q * ry, cx + rx, cy]]
        .map(function (a) { return a.map(f3).join(' ') + ' c'; }).join(' ') + ' h'; }
    function rrect(x, y, w, h, r) {
      if (!r) return f3(x) + ' ' + f3(y) + ' ' + f3(w) + ' ' + f3(h) + ' re';
      r = Math.min(r, w / 2, h / 2); var q = r * 0.5522847498, x1 = x + w, y1 = y + h;
      return [f3(x + r) + ' ' + f3(y) + ' m', f3(x1 - r) + ' ' + f3(y) + ' l', [x1 - r + q, y, x1, y + r - q, x1, y + r].map(f3).join(' ') + ' c', f3(x1) + ' ' + f3(y1 - r) + ' l', [x1, y1 - r + q, x1 - r + q, y1, x1 - r, y1].map(f3).join(' ') + ' c',
        f3(x + r) + ' ' + f3(y1) + ' l', [x + r - q, y1, x, y1 - r + q, x, y1 - r].map(f3).join(' ') + ' c', f3(x) + ' ' + f3(y + r) + ' l', [x, y + r - q, x + r - q, y, x + r, y].map(f3).join(' ') + ' c', 'h'].join(' ');
    }
    function pdfStr(bytes) { var s = '('; bytes.forEach(function (b) { s += b === 40 || b === 41 || b === 92 ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + ('00' + b.toString(8)).slice(-3) : String.fromCharCode(b); }); return s + ')'; }
    function textOp(o) {
      var total = 0, segs = [];
      o.runs.forEach(function (r) { // split each run into stretches of one font
        var cur = null;
        for (var i = 0; i < r.t.length; i++) {
          var ch = r.t[i], italic = r.i || o.italic, idx = (o.bold ? 1 : 0) + (italic ? 2 : 0), code, w;
          if (embed) { code = embeddedCode(ch); w = embed[FONT_KEYS[idx]].widths[codeToCp[code]] || 0; }
          else {
            var sym = SYMBOL[ch] !== undefined;
            code = sym ? SYMBOL[ch] : (ch.charCodeAt(0) < 127 ? ch.charCodeAt(0) : (WINANSI[ch] || (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63)));
            w = charW(ch, o.bold && !sym); if (sym) idx = 4;
          }
          usedFont[idx] = true;
          var font = 'F' + (idx + 1);
          if (!cur || cur.font !== font) { cur = { font: font, bytes: [] }; segs.push(cur); }
          cur.bytes.push(code);
          total += w * o.size / 1000;
        }
      });
      var th = (o.rotate || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th), shift = o.anchor === 'middle' ? -total / 2 : o.anchor === 'end' ? -total : 0;
      var x = o.x + shift * co, y = o.y + shift * si;
      var out = ['BT', hexRGB(o.fill || '#2D2D2D').map(f3).join(' ') + ' rg', [co, si, si, -co, x, y].map(f3).join(' ') + ' Tm'];
      segs.forEach(function (sg) { out.push('/' + sg.font + ' ' + f3(o.size) + ' Tf', pdfStr(sg.bytes) + ' Tj'); });
      out.push('ET'); c.push(out.join(' '));
    }
    L.forEach(function (o) {
      if (o.op === 'rect') { var p = setPaint(o); c.push(rrect(o.x, o.y, o.w, o.h, o.rx || 0) + ' ' + p); }
      else if (o.op === 'ellipse') { var p2 = setPaint(o); c.push(ellipse(o.cx, o.cy, o.rx, o.ry) + ' ' + p2); }
      else if (o.op === 'poly') { var p3 = setPaint(o); c.push(o.pts.map(function (pt, i) { return f3(pt[0]) + ' ' + f3(pt[1]) + (i ? ' l' : ' m'); }).join(' ') + ' h ' + p3); }
      else if (o.op === 'path') { var p4 = setPaint(o); c.push(parsePath(o.d).map(function (sg) { return sg.slice(1).map(f3).join(' ') + (sg.length > 1 ? ' ' : '') + sg[0]; }).join(' ') + ' ' + p4); }
      else if (o.op === 'arrow') { var co = Math.cos(o.angle), si = Math.sin(o.angle), s2 = o.size, hw = s2 * 0.38;
        c.push(hexRGB(o.fill).map(f3).join(' ') + ' rg ' + [[o.x, o.y], [o.x - co * s2 + si * hw, o.y - si * s2 - co * hw], [o.x - co * s2 - si * hw, o.y - si * s2 + co * hw]].map(function (pt, i) { return f3(pt[0]) + ' ' + f3(pt[1]) + (i ? ' l' : ' m'); }).join(' ') + ' h f'); }
      else if (o.op === 'text') textOp(o);
      else if (o.op === 'image') { var du = dataUrlBytes(o.href), info = du && /jpe?g/.test(du.mime) ? jpegInfo(du.bytes) : null;
        if (info) { images.push({ bytes: du.bytes, info: info }); c.push('q ' + [o.w, 0, 0, -o.h, o.x, o.y + o.h].map(f3).join(' ') + ' cm /Im' + images.length + ' Do Q'); } }
    });
    // assemble the file
    var enc = function (str) { var u = new Uint8Array(str.length); for (var i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 255; return u; };
    var parts = [], offs = [], len = 0;
    function add(u) { parts.push(u); len += u.length; }
    function obj(n, body, stream) { offs[n] = len; add(enc(n + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\n'))); if (stream) { add(stream); add(enc('\nendstream\n')); } add(enc('endobj\n')); }
    add(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
    var content = enc(c.join('\n')), baseNames = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Symbol'];
    var next = 5, fontRes = [], later = [], cp1252At = {}; // objects 1–4 are the catalog, page tree, page and content
    Object.keys(CP1252).forEach(function (ch) { cp1252At[CP1252[ch]] = ch.charCodeAt(0); });
    usedFont.forEach(function (used, i) {
      if (!used) return;
      var nFont = next++;
      fontRes.push('/F' + (i + 1) + ' ' + nFont + ' 0 R');
      if (!embed) { later.push([nFont, '<< /Type /Font /Subtype /Type1 /BaseFont /' + baseNames[i] + (i === 4 ? '' : ' /Encoding /WinAnsiEncoding') + ' >>']); return; }
      var f = embed[FONT_KEYS[i]], nDesc = next++, nFile = next++, nUni = next++, name = 'DTAAA' + 'ABCD'[i] + '+' + f.name, widths = [], diffs = [], pairs = [];
      for (var code = 0; code < 256; code++) { // every code the encoding defines gets its width, used here or not
        var cp = codeToCp[code] !== undefined ? codeToCp[code] : (code >= 32 && code < 127) || code >= 0xA0 ? code : cp1252At[code];
        widths.push(cp !== undefined ? (f.widths[cp] || 0) : 0);
      }
      Object.keys(borrowed).forEach(function (ch) { diffs.push(borrowed[ch] + ' /uni' + hex(ch.charCodeAt(0), 4)); });
      Object.keys(usedCode).forEach(function (code) { pairs.push('<' + hex(+code, 2) + '> <' + hex(codeToCp[code], 4) + '>'); });
      var cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n';
      for (var at = 0; at < pairs.length; at += 100) { var part = pairs.slice(at, at + 100); cmap += part.length + ' beginbfchar\n' + part.join('\n') + '\nendbfchar\n'; }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      var file = b64Bytes(f.data), uni = enc(cmap);
      later.push([nFont, '<< /Type /Font /Subtype /TrueType /BaseFont /' + name + ' /FirstChar 0 /LastChar 255 /Widths [' + widths.join(' ') + '] /FontDescriptor ' + nDesc + ' 0 R /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding' +
        (diffs.length ? ' /Differences [' + diffs.join(' ') + ']' : '') + ' >> /ToUnicode ' + nUni + ' 0 R >>']);
      later.push([nDesc, '<< /Type /FontDescriptor /FontName /' + name + ' /Flags ' + (32 + (i >= 2 ? 64 : 0)) + ' /FontBBox [' + f.bbox.join(' ') + '] /ItalicAngle ' + f.italicAngle + ' /Ascent ' + f.ascent + ' /Descent ' + f.descent +
        ' /CapHeight ' + f.capHeight + ' /StemV ' + f.stemV + ' /FontFile2 ' + nFile + ' 0 R >>']);
      later.push([nFile, '<< /Length ' + file.length + ' /Length1 ' + f.length1 + ' /Filter /FlateDecode >>', file]);
      later.push([nUni, '<< /Length ' + uni.length + ' >>', uni]);
    });
    var xo = images.map(function (im, i) { var n = next++;
      later.push([n, '<< /Type /XObject /Subtype /Image /Width ' + im.info.w + ' /Height ' + im.info.h + ' /ColorSpace ' + (im.info.n === 1 ? '/DeviceGray' : im.info.n === 4 ? '/DeviceCMYK' : '/DeviceRGB') + ' /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>', im.bytes]);
      return '/Im' + (i + 1) + ' ' + n + ' 0 R'; }).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f3(Wp) + ' ' + f3(Hp) + '] /Contents 4 0 R /Resources << /Font << ' + fontRes.join(' ') + ' >>' + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> >>');
    obj(4, '<< /Length ' + content.length + ' >>', content);
    later.forEach(function (o) { obj(o[0], o[1], o[2]); });
    var nInfo = next++, title = plain((fig.figure_meta && fig.figure_meta.title) || 'Figure').replace(/[^\x20-\x7e]/g, '-').replace(/[()\\]/g, '');
    obj(nInfo, '<< /Title (' + title + ') /Producer (Dose-Trend Analyzer) >>');
    var xref = len, count = nInfo + 1, x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var n = 1; n < count; n++) x += ('0000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    add(enc(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info ' + nInfo + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    var out = new Uint8Array(len), at = 0;
    parts.forEach(function (u) { out.set(u, at); at += u.length; });
    return out;
  }

  var Fig = { PT: PT, MM: MM, JOURNALS: JOURNALS, PALETTE: PALETTE, textW: textW, wrapLines: wrapLines, isRandomized: isRandomized, makeStyle: makeStyle, buildFigure: buildFigure, caption: caption,
    validate: validate, displayList: displayList, renderSVG: renderSVG, renderPDF: renderPDF, parsePath: parsePath, jpegInfo: jpegInfo, HELV: HELV, HELV_B: HELV_B };
  if (typeof module !== 'undefined' && module.exports) module.exports = Fig;
  root.Fig = Fig;
})(typeof window !== 'undefined' ? window : globalThis);
