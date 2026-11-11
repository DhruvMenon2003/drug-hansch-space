// ---------- figures 1–6 ----------
// Pattern: model first (Core), then a draw() that reads state and renders, wired to input or animate().
const U = STUDY.unit || '';
const withUnit = (v) => fmt(v) + (U ? ' ' + U : '');
// Write a readout from parts: strings are plain text, [x] is emphasised. No HTML strings.
function say(node, ...parts) {
  node.replaceChildren(...parts.filter((p) => p !== null && p !== '').map((p) => (Array.isArray(p) ? el('b', { text: String(p[0]) }) : String(p))));
}
function pressed(buttons, on) { buttons.forEach((b) => b.setAttribute('aria-pressed', String(on(b)))); }

// Columns of patient dots. Cases fill from the bottom, so a column also reads as a bar.
function dotColumns(s, n) {
  const k = n.length, pad = s.narrow ? 6 : 26, colW = (s.w - 2 * pad) / k, base = s.h - (s.narrow ? 76 : 60), top = 22, maxN = Math.max(...n);
  let per = 2;
  while (per < 14 && Math.ceil(maxN / per) * Math.min(22, (colW - 28) / per) > base - top) per++;
  const pitch = Math.min(22, (colW - 28) / per, (base - top) / Math.ceil(maxN / per)), rad = pitch * 0.39;
  return { k, base, per, pitch, rad, colW, pad,
    cx: (i) => pad + colW * (i + 0.5),
    pos: (i, j) => [pad + colW * (i + 0.5) + ((j % per) - (per - 1) / 2) * pitch, base - pitch * (Math.floor(j / per) + 0.5)],
    level: (i, r) => base - pitch * r / per,
    countAt: (i, y) => clamp(Math.round((base - y) / pitch * per), 0, n[i]),
    groupAt: (x) => clamp(Math.floor((x - pad) / colW), 0, k - 1) };
}
function drawColumns(s, L, r, opt = {}) {
  const { ctx, w } = s, c1 = css('--c1'), muted = css('--muted'), fg = css('--fg');
  ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L.pad / 2, L.base + 0.5); ctx.lineTo(w - L.pad / 2, L.base + 0.5); ctx.stroke();
  for (let i = 0; i < L.k; i++) {
    for (let j = 0; j < S.n[i]; j++) {
      const [x, y] = L.pos(i, j), on = j < r[i];
      const grow = on && opt.fresh && j >= opt.fresh.was[i] ? 0.55 + 0.45 * opt.fresh.t : 1; // new cases pop in
      if (on) disc(ctx, x, y, L.rad * grow, c1); else disc(ctx, x, y, L.rad - 0.6, null, muted, 1.1);
    }
    label(ctx, S.labels[i], L.cx(i), L.base + 17, fg, 'center', s.narrow ? 12 : 12.5, 600);
    if (s.narrow) { // too tight for one line under each column
      label(ctx, r[i] + ' of ' + S.n[i], L.cx(i), L.base + 34, muted, 'center', 11.5);
      label(ctx, pc1(r[i] / S.n[i]) + '%', L.cx(i), L.base + 50, muted, 'center', 11.5);
    } else label(ctx, r[i] + ' of ' + S.n[i] + ' · ' + pc1(r[i] / S.n[i]) + '%', L.cx(i), L.base + 35, muted, 'center', 12);
    if (opt.sel === i) roundRect(ctx, L.cx(i) - 26, L.base + (s.narrow ? 62 : 46), 52, 2.5, 1, fg);
  }
}

// On a phone the dot figures are as tall as their tallest column needs, two patients to a row.
const dotsNarrow = () => 104 + clamp(Math.ceil(Math.max(...S.n) / 2) * 19, 110, 220);

// Figure 1: the row as patients. Direct manipulation of the counts.
{
  const fig = $('fig-dots'), s = surface(fig.querySelector('canvas'), { narrow: dotsNarrow }), readout = fig.querySelector('.readout');
  const st = { r: S.r.slice(), sel: S.top, focus: false };
  function draw() {
    const L = dotColumns(s, S.n), i = st.sel;
    s.ctx.clearRect(0, 0, s.w, s.h);
    drawColumns(s, L, st.r, { sel: st.focus ? i : -1 });
    const same = st.r[i] === S.r[i];
    say(readout, S.labels[i] + ': ', [st.r[i] + ' of ' + S.n[i]], ' with ' + S.ev + ', which is ', [pc1(st.r[i] / S.n[i]) + '%'],
      '. One patient more or fewer moves that by ' + (100 / S.n[i]).toFixed(1) + ' points.', same ? '' : ' The trial had ' + S.r[i] + '.');
    s.canvas.setAttribute('aria-label', 'Patients with ' + S.ev + ' by group: ' + S.labels.map((l, j) => l + ' ' + st.r[j] + ' of ' + S.n[j]).join(', '));
  }
  const set = (x, y) => { const L = dotColumns(s, S.n); st.sel = L.groupAt(x); st.r[st.sel] = L.countAt(st.sel, y); draw(); };
  drag(s, { down: set, move: set });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    st.sel = clamp(st.sel + d[0], 0, S.k - 1); st.r[st.sel] = clamp(st.r[st.sel] + d[1], 0, S.n[st.sel]); draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  fig.querySelector('[data-role=reset]').onclick = () => { st.r = S.r.slice(); st.sel = S.top; draw(); };
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 2: deal the same cases at random. What does chance alone produce?
{
  const fig = $('fig-shuffle'), s = surface(fig.querySelector('canvas'), { narrow: dotsNarrow }), readout = fig.querySelector('.readout');
  const autoBtn = fig.querySelector('[data-role=auto]');
  const st = { r: null, was: null, count: 0, hits: 0, auto: false, acc: 0, pop: 0, rand: rng(29) };
  function deal() {
    st.was = st.r || S.n.map(() => 0);
    st.r = C.shuffleCounts(S.n, S.R, st.rand); // MODEL: each patient equally likely to be a case, total fixed
    st.count++; if (st.r[S.top] - st.r[0] >= S.gap) st.hits++;
    st.pop = calm.matches ? 1 : 0;
  }
  function draw() {
    const L = dotColumns(s, S.n), { ctx } = s, fg = css('--fg');
    ctx.clearRect(0, 0, s.w, s.h);
    drawColumns(s, L, st.r, { fresh: { was: st.was, t: 1 - Math.pow(1 - st.pop, 3) } });
    // What the trial observed: a tick on each side of the column at that height, clear of the dots.
    ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < L.k; i++) {
      const y = Math.round(L.level(i, S.r[i])), inner = L.per * L.pitch / 2 + 2;
      for (const side of [-1, 1]) { ctx.moveTo(L.cx(i) + side * inner, y); ctx.lineTo(L.cx(i) + side * (inner + 9), y); }
    }
    ctx.stroke();
    if (!s.narrow) label(ctx, 'trial', L.cx(0) - L.per * L.pitch / 2 - 16, L.level(0, S.r[0]), fg, 'right', 11.5);
    const gap = st.r[S.top] - st.r[0];
    say(readout, 'Shuffle ' + st.count.toLocaleString('en-US') + ': ' + S.labels[0] + ' ' + st.r[0] + ', ' + S.labels[S.top] + ' ' + st.r[S.top] + ', a gap of ', [(gap > 0 ? '+' : gap < 0 ? '−' : '') + Math.abs(gap)],
      '. The top dose has finished ' + S.gap + ' or more ahead in ', [st.hits.toLocaleString('en-US') + ' of ' + st.count.toLocaleString('en-US')], ' shuffles (' + (100 * st.hits / st.count).toFixed(st.count < 200 ? 0 : 1) + '%). The trial’s gap was ' + S.gap + '.');
  }
  animate(fig, (time, dt) => {
    let dirty = false;
    if (st.auto) {
      st.acc += dt;
      const period = st.count > 120 ? 0.05 : st.count > 30 ? 0.14 : 0.4; // settle into a faster rhythm
      while (st.acc >= period) { st.acc -= period; deal(); dirty = true; }
    }
    if (st.pop < 1) { st.pop = Math.min(1, st.pop + dt / 0.16); dirty = true; }
    if (dirty) draw();
  });
  fig.querySelector('[data-role=once]').onclick = () => { deal(); draw(); };
  autoBtn.onclick = () => { st.auto = !st.auto; st.acc = 0; autoBtn.setAttribute('aria-pressed', String(st.auto)); autoBtn.textContent = st.auto ? 'Pause' : 'Keep shuffling'; };
  fig.querySelector('[data-role=reset]').onclick = () => { st.count = 0; st.hits = 0; deal(); draw(); };
  deal(); st.pop = 1;
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 3: the trend statistic as a balance. Cases stand at their dose; where do they balance?
{
  const fig = $('fig-beam'), s = surface(fig.querySelector('canvas'), { narrow: () => 282 }), readout = fig.querySelector('.readout');
  const xmin = Math.min(...S.x), xmax = Math.max(...S.x);
  const st = { r: S.r.slice(), sel: S.top, focus: false, hold: null, ang: 0 };
  const X = (d) => lerp(s.w * (s.narrow ? 0.125 : 0.141), s.w * (s.narrow ? 0.875 : 0.859), (d - xmin) / (xmax - xmin || 1));
  const over = () => (s.narrow ? s.w * 0.09 : 46); // how far the beam and the ruler run past the end doses
  const beamY = () => s.h * 0.53, ruleY = () => s.h * 0.79;
  const current = () => { // counts including a case that is being carried
    if (!st.hold || st.hold.to === st.hold.from) return st.r;
    const r = st.r.slice(); r[st.hold.from]--; r[st.hold.to]++; return r;
  };
  const target = (L) => clamp(L.lean / (xmax - xmin || 1) * 1.5, -0.2, 0.2); // radians; exaggerated on purpose
  function draw() {
    const { ctx, w, h } = s, r = current(), L = C.lean(S.x, r, S.n); // MODEL: mean dose of the cases minus mean dose of everyone
    const c1 = css('--c1'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted'), by = beamY(), ry = ruleY(), fx = X(L.meanAll);
    ctx.clearRect(0, 0, w, h);
    // the beam and its load turn about the fulcrum
    ctx.save(); ctx.translate(fx, by); ctx.rotate(st.ang); ctx.translate(-fx, -by);
    ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(xmin) - over(), by); ctx.lineTo(X(xmax) + over(), by); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(S.x[i]), by + 2); ctx.lineTo(X(S.x[i]), by + 8); ctx.stroke();
      const show = st.hold && st.hold.from === i && st.hold.to !== i ? r[i] : (st.hold && st.hold.from === i ? r[i] - 1 : r[i]);
      for (let j = 0; j < show; j++) disc(ctx, X(S.x[i]) + ((j % 2) - 0.5) * 17, by - 12 - Math.floor(j / 2) * 17, 7.4, c1);
      if (st.focus && st.sel === i) roundRect(ctx, X(S.x[i]) - 22, by + 11, 44, 2.5, 1, fg);
    }
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(fx, by + 3); ctx.lineTo(fx - 13, by + 27); ctx.lineTo(fx + 13, by + 27); ctx.closePath(); ctx.fillStyle = muted; ctx.fill(); // fulcrum
    // ruler with the two balance points
    ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(xmin) - over(), ry); ctx.lineTo(X(xmax) + over(), ry); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(X(S.x[i]), ry - 4); ctx.lineTo(X(S.x[i]), ry + 4); ctx.stroke();
      label(ctx, S.labels[i], X(S.x[i]), ry + 17, fg, 'center', 12, 600);
      label(ctx, r[i] + ' of ' + S.n[i], X(S.x[i]), ry + 33, muted, 'center', 11.5);
    }
    const ex = Number.isFinite(L.meanEvents) ? X(L.meanEvents) : fx, ay = ry - 13;
    ctx.fillStyle = muted; ctx.beginPath(); ctx.moveTo(fx, ry - 5); ctx.lineTo(fx - 5, ry - 13); ctx.lineTo(fx + 5, ry - 13); ctx.closePath(); ctx.fill();
    if (L.R > 0) {
      ctx.fillStyle = c4; ctx.beginPath(); ctx.moveTo(ex, ry - 5); ctx.lineTo(ex - 5, ry - 13); ctx.lineTo(ex + 5, ry - 13); ctx.closePath(); ctx.fill();
      if (Math.abs(ex - fx) > 3) { ctx.strokeStyle = c4; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(fx, ay - 6); ctx.lineTo(ex, ay - 6); ctx.stroke(); }
      const right = ex >= fx;
      label(ctx, 'everyone ' + withUnit(L.meanAll), fx + (right ? -9 : 9), ay - 6, muted, right ? 'right' : 'left', 11.5);
      label(ctx, 'cases ' + withUnit(L.meanEvents), ex + (right ? 9 : -9), ay - 6, c4, right ? 'left' : 'right', 11.5, 600);
    }
    if (st.hold) disc(ctx, st.hold.x, st.hold.y, 8.4, c1, css('--panel'), 2);
    if (L.R === 0) say(readout, 'No cases on the beam. Reset to put them back.');
    else say(readout, 'The cases average ', [withUnit(L.meanEvents)], '; all ' + S.N + ' patients average ', [withUnit(L.meanAll)], '. Lean: ', [(L.lean > 0.5 ? '+' : L.lean < -0.5 ? '−' : '') + withUnit(Math.abs(L.lean))],
      L.lean > 0.5 ? ' toward the high doses.' : L.lean < -0.5 ? ' toward the low doses.' : ': balanced.', r.every((v, i) => v === S.r[i]) ? '' : ' The trial’s lean was +' + withUnit(C.lean(S.x, S.r, S.n).lean) + '.');
  }
  const nearest = (x) => S.x.reduce((best, d, i) => (Math.abs(X(d) - x) < Math.abs(X(S.x[best]) - x) ? i : best), 0);
  drag(s, {
    down: (x, y) => { const i = nearest(x); st.sel = i; if (y > ruleY() - 20 || st.r[i] === 0) { draw(); return false; } st.hold = { from: i, to: i, x, y }; draw(); },
    move: (x, y) => { const j = nearest(x); st.hold.to = j === st.hold.from || st.r[j] < S.n[j] ? j : st.hold.to; st.hold.x = x; st.hold.y = y; draw(); },
    up: () => { st.r = current().slice(); st.sel = st.hold.to; st.hold = null; draw(); }
  });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const j = clamp(st.sel + d, 0, S.k - 1);
    if (e.shiftKey && j !== st.sel && st.r[st.sel] > 0 && st.r[j] < S.n[j]) { st.r[st.sel]--; st.r[j]++; }
    st.sel = j; draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  animate(fig, (time, dt) => { // the beam settles toward its new tilt
    const goal = target(C.lean(S.x, current(), S.n)), gap = (Number.isFinite(goal) ? goal : 0) - st.ang;
    if (Math.abs(gap) < 1e-4) return;
    st.ang += calm.matches ? gap : gap * (1 - Math.exp(-11 * dt)); draw();
  });
  fig.querySelector('[data-role=reset]').onclick = () => { st.r = S.r.slice(); st.sel = S.top; draw(); };
  st.ang = target(C.lean(S.x, S.r, S.n));
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 4: the lean of many shuffles, piled up. The tail share is the P value.
{
  const fig = $('fig-pile'), s = surface(fig.querySelector('canvas'), { narrow: () => 258 }), readout = fig.querySelector('.readout');
  const runBtn = fig.querySelector('[data-role=run]'), sides = [...fig.querySelectorAll('[data-side]')];
  const tr = S.A.trend, ex = tr.exact, base = C.lean(S.x, S.r, S.n);
  const pts = (ex.points || []).map(([t, p]) => ({ lean: t / S.R - base.meanAll, p })); // MODEL: exact conditional distribution
  const step = pts.length > 1 ? Math.min(...pts.slice(1).map((q, i) => q.lean - pts[i].lean)) : 1;
  const sd = Math.sqrt(tr.varT) / S.R, obs = base.lean;
  let span = step; { let tail = 0; for (let i = 0; i < pts.length / 2; i++) { tail += pts[i].p + pts[pts.length - 1 - i].p; if (tail > 0.002) { span = Math.abs(pts[i].lean); break; } } }
  span = Math.max(Math.ceil(Math.max(span, Math.abs(obs) * 1.5) / 50) * 50, 50);
  const index = new Map(pts.map((q, i) => [Math.round(q.lean / step), i]));
  const st = { n: new Uint32Array(pts.length), total: 0, side: 'two', running: false, rand: rng(4) };
  const one = () => {
    const c = C.shuffleCounts(S.n, S.R, st.rand); let T = 0;
    for (let i = 0; i < S.k; i++) T += S.x[i] * c[i];
    const i = index.get(Math.round((T / S.R - base.meanAll) / step));
    if (i !== undefined) st.n[i]++;
    st.total++;
  };
  const inTail = (lean) => (st.side === 'two' ? Math.abs(lean) >= Math.abs(obs) - 1e-9 : (obs >= 0 ? lean >= obs - 1e-9 : lean <= obs + 1e-9));
  function draw() {
    const { ctx, w, h } = s, c1 = css('--c1'), c3 = css('--c3'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted');
    const x0 = s.narrow ? 20 : 34, x1 = w - 20, yb = h - 46, yt = 34, X = (v) => lerp(x0, x1, (v + span) / (2 * span));
    const pMax = Math.max(...pts.map((q) => q.p)) * 1.22, Y = (p) => yb - (yb - yt) * p / pMax, bw = Math.max(1.5, X(step) - X(0) - 1.2);
    ctx.clearRect(0, 0, w, h);
    let tail = 0;
    pts.forEach((q, i) => {
      const t = inTail(q.lean); if (t) tail += st.n[i];
      if (Math.abs(q.lean) > span || !st.n[i]) return;
      const y = Y(st.n[i] / st.total);
      ctx.fillStyle = t ? c1 : c3; ctx.globalAlpha = t ? 1 : 0.8; ctx.fillRect(X(q.lean) - bw / 2, y, bw, yb - y); ctx.globalAlpha = 1;
    });
    ctx.beginPath(); // exact outline, as steps
    pts.forEach((q, i) => { if (Math.abs(q.lean) > span + step) return; const xa = X(q.lean - step / 2), xb = X(q.lean + step / 2), y = Y(q.p); if (i === 0 || Math.abs(pts[i - 1].lean) > span + step) ctx.moveTo(xa, yb); ctx.lineTo(xa, y); ctx.lineTo(xb, y); });
    ctx.strokeStyle = fg; ctx.lineWidth = 1.2; ctx.lineJoin = 'miter'; ctx.stroke();
    const bell = []; for (let v = -span; v <= span; v += span / 90) bell.push([X(v), Y(Math.exp(-0.5 * (v / sd) ** 2) / (sd * Math.sqrt(TAU)) * step)]);
    polyline(ctx, bell, c4, 2);
    ctx.strokeStyle = css('--rule'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, yb + 0.5); ctx.lineTo(x1, yb + 0.5); ctx.stroke();
    const tick = span / 2;
    for (let v = -span; v <= span + 1e-9; v += tick) { ctx.beginPath(); ctx.moveTo(X(v), yb); ctx.lineTo(X(v), yb + 5); ctx.strokeStyle = muted; ctx.stroke(); label(ctx, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), X(v), yb + 16, muted, 'center', 11.5); }
    label(ctx, 'lean of the cases' + (U ? ', ' + U : ''), x0, yb + 34, muted, 'left', 11.5);
    label(ctx, 'toward high doses →', x1, yb + 34, muted, 'right', 11.5);
    const mark = (v, text, strong) => {
      ctx.strokeStyle = strong ? c1 : muted; ctx.lineWidth = strong ? 2 : 1; ctx.beginPath(); ctx.moveTo(X(v), yt - 8); ctx.lineTo(X(v), yb); ctx.stroke();
      const tw = textWidth(ctx, text, 11.5, strong ? 600 : 500); // keep the words on the canvas when the line is near an edge
      const left = clamp(v >= 0 ? X(v) + 6 : X(v) - 6 - tw, 2, w - 2 - tw);
      label(ctx, text, left, yt - 14, strong ? c1 : muted, 'left', 11.5, strong ? 600 : 500);
    };
    if (Math.abs(obs) <= span) { mark(obs, 'the trial, ' + (obs >= 0 ? '+' : '−') + withUnit(Math.abs(obs)), true); if (st.side === 'two') mark(-obs, 'as far the other way', false); }
    const share = st.total ? tail / st.total : 0;
    say(readout, [st.total.toLocaleString('en-US')], ' shuffles; ', [tail.toLocaleString('en-US')], ' lean at least ' + withUnit(Math.abs(obs)) + (st.side === 'two' ? ' either way' : ' toward the high doses') + ', a share of ', [(100 * share).toFixed(1) + '%'],
      '. Every possible shuffle counted: ', ['P ' + C.fmtPeq(st.side === 'two' ? ex.pTwo : (obs >= 0 ? ex.pInc : ex.pDec))], '. Bell-curve shortcut: ', ['P ' + C.fmtPeq(st.side === 'two' ? tr.pTwo : (obs >= 0 ? tr.pInc : tr.pDec))], '.');
  }
  const stop = () => { st.running = false; runBtn.setAttribute('aria-pressed', 'false'); runBtn.textContent = st.total >= 200000 ? 'That is plenty' : 'Run the shuffles'; };
  animate(fig, () => {
    if (!st.running) return;
    const batch = clamp(Math.round(st.total / 45), 6, 900); // slow enough to watch at first, then it gathers pace
    for (let i = 0; i < batch; i++) one();
    if (st.total >= 200000) stop();
    draw();
  });
  runBtn.onclick = () => {
    if (st.total >= 200000) return;
    if (calm.matches) { for (let i = 0; i < 20000; i++) one(); draw(); return; } // no animation: add a batch at once
    st.running = !st.running; runBtn.setAttribute('aria-pressed', String(st.running)); runBtn.textContent = st.running ? 'Pause' : 'Run the shuffles';
  };
  sides.forEach((b) => (b.onclick = () => { st.side = b.dataset.side; pressed(sides, (q) => q.dataset.side === st.side); draw(); }));
  const reset = () => { st.n.fill(0); st.total = 0; st.rand = rng(4); for (let i = 0; i < 400; i++) one(); };
  fig.querySelector('[data-role=reset]').onclick = () => { stop(); reset(); draw(); };
  reset();
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 5: one ordered question (trend) beside one question per dose (pairwise).
{
  const fig = $('fig-verdicts'), s = surface(fig.querySelector('canvas'), { narrow: () => 236 + 38 * S.k + 48 }), readout = fig.querySelector('.readout');
  const presets = [...fig.querySelectorAll('[data-preset]')];
  const tables = { trial: S.r, stair: STUDY.presets.stair, spike: STUDY.presets.spike, flat: STUDY.presets.flat };
  const st = { r: S.r.slice(), sel: 0, focus: false, preset: 'trial' };
  // Bars on the left and the P values on the right; on a phone the P values go underneath. pt and pb bound the P rows.
  const geo = () => {
    if (s.narrow) { const L = 8, R = s.w - 8, yt = 40, yb = 150, pt = 236; return { L, R, yt, yb, band: (R - L) / S.k, px0: 12, px1: s.w - 12, pt, pb: pt + 38 * S.k }; }
    const L = 22, R = Math.min(300, s.w * 0.44), yb = s.h - 62, yt = 46;
    return { L, R, yb, yt, band: (R - L) / S.k, px0: R + 44, px1: s.w - 18, pt: yt, pb: yb };
  };
  function draw() {
    const { ctx, w, h } = s, g = geo(), A = S.analyze(st.r); // MODEL: Cochran–Armitage on all groups; Fisher per dose, Holm-adjusted
    const c2 = css('--c2'), c4 = css('--c4'), fg = css('--fg'), muted = css('--muted'), rule = css('--rule'), grid = css('--grid');
    ctx.clearRect(0, 0, w, h);
    // left: the table as bars
    label(ctx, '% with ' + S.ev, g.L, g.yt - 22, muted, 'left', 11.5);
    ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(g.L, g.yb + 0.5); ctx.lineTo(g.R, g.yb + 0.5); ctx.stroke();
    for (let i = 0; i < S.k; i++) {
      const cx = g.L + g.band * (i + 0.5), p = st.r[i] / S.n[i], y = lerp(g.yb, g.yt, p), bw = Math.min(30, g.band * 0.56);
      roundRect(ctx, cx - bw / 2, g.yt, bw, g.yb - g.yt, 2, grid);
      if (st.r[i] > 0) roundRect(ctx, cx - bw / 2, y, bw, g.yb - y, 2, i === 0 ? muted : c2);
      label(ctx, pc1(p) + '%', cx, y - 10, fg, 'center', 11.5, 600);
      const fits = textWidth(ctx, S.labels[i], 11.5, 600) <= g.band - 3; // a long name keeps only its first word here
      label(ctx, fits ? S.labels[i] : S.labels[i].split(' ')[0], cx, g.yb + 15, fg, 'center', 11.5, 600);
      label(ctx, st.r[i] + '/' + S.n[i], cx, g.yb + 31, muted, 'center', 11);
      if (st.focus && st.sel === i) roundRect(ctx, cx - 20, g.yb + 42, 40, 2.5, 1, fg);
    }
    // right: P values on a scale where further right is stronger evidence
    const tr = A.trend, rows = [{ name: 'Trend, all ' + S.k + ' groups', p: tr.computable ? tr.pTwo : NaN, col: c4, strong: true }]
      .concat(A.pairs.map((d) => ({ name: d.label + ' vs ' + lc(S.labels[0]), p: d.pHolm, col: c2 })));
    const PX = (p) => lerp(g.px0, g.px1, clamp(-Math.log10(Math.max(p, 1e-4)) / 3.3, 0, 1));
    [[1, '1'], [0.1, '0.1'], [0.05, '0.05'], [0.01, '0.01'], [0.001, '0.001']].forEach(([p, t]) => {
      ctx.strokeStyle = p === 0.05 ? fg : rule; ctx.lineWidth = p === 0.05 ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(PX(p), g.pt - 6); ctx.lineTo(PX(p), g.pb + 6); ctx.stroke();
      label(ctx, t, PX(p), g.pb + 18, p === 0.05 ? fg : muted, 'center', 11, p === 0.05 ? 600 : 500);
    });
    label(ctx, 'P value', g.px0, g.pt - 22, muted, 'left', 11.5);
    label(ctx, 'smaller →', g.px1, g.pt - 22, muted, 'right', 11.5);
    const pitch = (g.pb - g.pt) / rows.length;
    rows.forEach((row, i) => {
      const y = g.pt + pitch * (i + 0.5), ok = Number.isFinite(row.p), sig = ok && row.p < 0.05;
      label(ctx, row.name, g.px0, y - 9, fg, 'left', 12, row.strong ? 600 : 500);
      roundRect(ctx, g.px0, y + 3, g.px1 - g.px0, 6, 3, grid);
      if (ok) { roundRect(ctx, g.px0, y + 3, Math.max(4, PX(row.p) - g.px0), 6, 3, row.col); disc(ctx, PX(row.p), y + 6, sig ? 6 : 4.5, sig ? row.col : css('--panel'), row.col, 2); }
      label(ctx, ok ? 'P ' + C.fmtPeq(row.p) : 'not testable', g.px1, y - 9, sig ? fg : muted, 'right', 12, sig ? 600 : 500);
    });
    label(ctx, 'pairwise P values are Holm-adjusted', g.px0, g.pb + 36, muted, 'left', 11);
    const best = A.pairs.reduce((a, b) => (b.pHolm < a.pHolm ? b : a), A.pairs[0]);
    const tSig = tr.computable && tr.pTwo < 0.05, pSig = best && best.pHolm < 0.05;
    say(readout, 'Trend test on all ' + S.N + ' patients: ', [tr.computable ? 'P ' + C.fmtPeq(tr.pTwo) : 'not testable'], '. Best single comparison, ' + best.label + ' against ' + lc(S.labels[0]) + ': ', ['P ' + C.fmtPeq(best.pHolm)], ' after adjustment (' + C.fmtP(best.p) + ' before). ',
      tSig && pSig ? 'Both get under 0.05.' : tSig ? 'A climb the trend test can see, though no single dose stands out.' : pSig ? 'One dose stands out, but there is no climb for the trend test to find.' : 'Neither gets under 0.05.');
    s.canvas.setAttribute('aria-label', 'Cases by group: ' + st.r.map((v, i) => S.labels[i] + ' ' + v + ' of ' + S.n[i]).join(', ') + '. ' + readout.textContent);
  }
  const custom = () => { st.preset = 'custom'; pressed(presets, () => false); };
  const set = (x, y) => { const g = geo(); if (x > g.R + 12 || y > g.yb + 50) return false; st.sel = clamp(Math.floor((x - g.L) / g.band), 0, S.k - 1); st.r[st.sel] = clamp(Math.round(S.n[st.sel] * (g.yb - y) / (g.yb - g.yt)), 0, S.n[st.sel]); custom(); draw(); };
  drag(s, { down: set, move: set });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    st.sel = clamp(st.sel + d[0], 0, S.k - 1);
    if (d[1]) { st.r[st.sel] = clamp(st.r[st.sel] + d[1], 0, S.n[st.sel]); custom(); }
    draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  presets.forEach((b) => (b.onclick = () => { st.preset = b.dataset.preset; st.r = tables[st.preset].slice(); pressed(presets, (q) => q === b); draw(); }));
  s.draw = draw; redraws.push(draw); draw();
}

// Figure 6: every trial that differs from this one only at the two ends, shaded by its P value.
{
  const T = S.top, nx = S.n[T] + 1, ny = S.n[0] + 1, narrowCell = (w) => Math.min(26, (w - 54) / nx);
  const fig = $('fig-land'), s = surface(fig.querySelector('canvas'), { narrow: (w) => 26 + narrowCell(w) * ny + 46 + 58 }), readout = fig.querySelector('.readout');
  const modes = [...fig.querySelectorAll('[data-mode]')];
  const st = { a: S.r[0], b: S.r[T], mode: 'asym', focus: false, grids: { asym: C.landscape(S.x, S.r, S.n, 0, T, false), exact: null }, partial: null, building: 0 };
  const gridNow = () => (st.mode === 'exact' ? (st.grids.exact || st.partial || st.grids.asym) : st.grids.asym);
  const geo = () => {
    if (s.narrow) { const cell = narrowCell(s.w); return { cell, x0: 46, y0: 26, gw: cell * nx, gh: cell * ny }; }
    const cell = Math.min((s.w - 190) / nx, (s.h - 96) / ny); return { cell, x0: 92, y0: 26, gw: cell * nx, gh: cell * ny };
  };
  const shadeOf = (p) => (Number.isFinite(p) ? clamp(-Math.log10(Math.max(p, 1e-4)) / 3, 0, 1) : -1);
  const mixHex = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); return 'rgb(' + [16, 8, 0].map((sh) => Math.round(lerp(pa >> sh & 255, pb >> sh & 255, t))).join(',') + ')'; };
  function draw() {
    const { ctx, w, h } = s, g = geo(), G = gridNow(); // MODEL: two-sided trend P for each pair of end counts
    const c1 = css('--c1'), c2 = css('--c2'), fg = css('--fg'), muted = css('--muted'), panel = css('--panel'), grid = css('--grid');
    const cx = (b) => g.x0 + g.cell * b, cy = (a) => g.y0 + g.gh - g.cell * (a + 1); // placebo count rises upward
    ctx.clearRect(0, 0, w, h);
    for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
      const t = shadeOf(G[a][b].p);
      ctx.fillStyle = t < 0 ? grid : mixHex(panel.length === 7 ? panel : '#ffffff', c2, 0.06 + 0.94 * t);
      ctx.fillRect(cx(b) + 0.5, cy(a) + 0.5, g.cell - 1, g.cell - 1);
    }
    ctx.strokeStyle = fg; ctx.lineWidth = 2.2; ctx.lineCap = 'square'; ctx.beginPath(); // the P = 0.05 frontier, along cell edges
    const sig = (a, b) => a >= 0 && b >= 0 && a < ny && b < nx && G[a][b].p < 0.05;
    for (let a = 0; a < ny; a++) for (let b = 0; b < nx; b++) {
      if (b + 1 < nx && sig(a, b) !== sig(a, b + 1)) { ctx.moveTo(cx(b + 1), cy(a)); ctx.lineTo(cx(b + 1), cy(a) + g.cell); }
      if (a + 1 < ny && sig(a, b) !== sig(a + 1, b)) { ctx.moveTo(cx(b), cy(a)); ctx.lineTo(cx(b) + g.cell, cy(a)); }
    }
    ctx.stroke();
    const every = g.cell >= 20 ? 1 : g.cell >= 11 ? 2 : 5;
    for (let b = 0; b < nx; b += every) label(ctx, String(b), cx(b) + g.cell / 2, g.y0 + g.gh + 13, muted, 'center', 11);
    for (let a = 0; a < ny; a += every) label(ctx, String(a), g.x0 - 9, cy(a) + g.cell / 2, muted, 'right', 11);
    label(ctx, 'cases at ' + S.labels[T] + ' (of ' + S.n[T] + ')', g.x0 + g.gw / 2, g.y0 + g.gh + 33, fg, 'center', 12, 600);
    ctx.save(); ctx.translate(g.x0 - (s.narrow ? 34 : 44), g.y0 + g.gh / 2); ctx.rotate(-Math.PI / 2); label(ctx, 'cases on ' + lc(S.labels[0]) + ' (of ' + S.n[0] + ')', 0, 0, fg, 'center', 12, 600); ctx.restore();
    const note = (text, x, y, align) => { const tw = textWidth(ctx, text, 11) + 12;
      ctx.globalAlpha = 0.88; roundRect(ctx, align === 'left' ? x - 6 : x - tw + 6, y - 9, tw, 18, 3, panel); ctx.globalAlpha = 1; label(ctx, text, x, y, fg, align, 11); };
    note('falls with dose', g.x0 + 10, g.y0 + 14, 'left'); note('climbs with dose', g.x0 + g.gw - 10, g.y0 + g.gh - 14, 'right');
    const ring = (a, b, col, lw) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(cx(b) + 1.5, cy(a) + 1.5, g.cell - 3, g.cell - 3); };
    ring(S.r[0], S.r[T], c1, 3);
    label(ctx, 'the trial', cx(S.r[T]) + g.cell / 2, cy(S.r[0]) - 9, c1, 'center', 11.5, 600);
    if (st.a !== S.r[0] || st.b !== S.r[T]) { ring(st.a, st.b, fg, 3); ctx.strokeStyle = panel; ctx.lineWidth = 1; ctx.strokeRect(cx(st.b) + 3.5, cy(st.a) + 3.5, g.cell - 7, g.cell - 7); }
    else if (st.focus) ring(st.a, st.b, fg, 1.5);
    // key: beside the grid, or under it when there is no room beside
    const shade = (t) => mixHex(panel.length === 7 ? panel : '#ffffff', c2, 0.06 + 0.94 * t);
    const stops = [[1, '1'], [0.1, '0.1'], [0.05, '0.05'], [0.01, '0.01'], [0.001, '0.001']];
    if (s.narrow) {
      const kx = g.x0 + 18, kw = Math.min(210, g.gw - 30), ky = g.y0 + g.gh + 56;
      for (let i = 0; i < kw; i++) { ctx.fillStyle = shade(i / kw); ctx.fillRect(kx + i, ky, 1.2, 11); }
      label(ctx, 'P', kx - 8, ky + 5.5, fg, 'right', 12, 600);
      stops.forEach(([p, t]) => { const x = kx + kw * shadeOf(p); ctx.strokeStyle = fg; ctx.lineWidth = p === 0.05 ? 2 : 1; ctx.beginPath(); ctx.moveTo(x, ky + 11); ctx.lineTo(x, ky + (p === 0.05 ? 18 : 15)); ctx.stroke();
        if (p !== 0.1) label(ctx, t, x, ky + 26, p === 0.05 ? fg : muted, 'center', 11, p === 0.05 ? 600 : 500); }); // 0.1 would sit on top of 0.05
    } else {
      const kx = g.x0 + g.gw + 30, kh = Math.min(170, g.gh * 0.5), ky = g.y0 + 22;
      for (let i = 0; i < kh; i++) { ctx.fillStyle = shade(i / kh); ctx.fillRect(kx, ky + i, 13, 1.2); }
      label(ctx, 'P', kx, ky - 12, fg, 'left', 12, 600);
      stops.forEach(([p, t]) => { const y = ky + kh * shadeOf(p); ctx.strokeStyle = fg; ctx.lineWidth = p === 0.05 ? 2 : 1; ctx.beginPath(); ctx.moveTo(kx + 13, y); ctx.lineTo(kx + (p === 0.05 ? 22 : 18), y); ctx.stroke(); label(ctx, t, kx + 26, y, p === 0.05 ? fg : muted, 'left', 11, p === 0.05 ? 600 : 500); });
    }
    const p = G[st.a][st.b].p, far = Math.abs(st.a - S.r[0]) + Math.abs(st.b - S.r[T]);
    const building = st.mode === 'exact' && !st.grids.exact;
    say(readout, cap(lc(S.labels[0])) + ' ' + st.a + ' of ' + S.n[0] + ', ' + S.labels[T] + ' ' + st.b + ' of ' + S.n[T] + ': ', [Number.isFinite(p) ? 'P ' + C.fmtPeq(p) : 'not testable'], Number.isFinite(p) ? (p < 0.05 ? ', below 0.05.' : ', not below 0.05.') : '.',
      far === 0 ? ' This is the trial.' : ' That is ' + far + (far === 1 ? ' patient' : ' patients') + ' away from the trial.', building ? ' Counting every shuffle for each cell: ' + Math.round(100 * st.building / ny) + '%.' : '');
    s.canvas.setAttribute('aria-label', 'Grid of trend-test P values. ' + readout.textContent);
  }
  const pickCell = (x, y) => { const g = geo(), b = Math.floor((x - g.x0) / g.cell), a = ny - 1 - Math.floor((y - g.y0) / g.cell); if (a < 0 || b < 0 || a >= ny || b >= nx) return false; st.a = a; st.b = b; draw(); };
  drag(s, { down: pickCell, move: (x, y) => { pickCell(x, y); } });
  s.canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] }[e.key];
    if (!d) return;
    e.preventDefault(); st.a = clamp(st.a + d[0], 0, ny - 1); st.b = clamp(st.b + d[1], 0, nx - 1); draw();
  });
  s.canvas.addEventListener('focus', () => { st.focus = true; draw(); });
  s.canvas.addEventListener('blur', () => { st.focus = false; draw(); });
  // The exact grid takes a moment, so it is filled a row at a time while the figure stays usable.
  animate(fig, () => {
    if (st.mode !== 'exact' || st.grids.exact) return;
    if (!st.partial) { st.partial = st.grids.asym.map((row) => row.map((c) => ({ p: c.p, z: c.z }))); st.building = 0; }
    const a = st.building;
    for (let b = 0; b < nx; b++) {
      const r = S.r.slice(); r[0] = a; r[T] = b;
      if (!C.cochranArmitage(S.x, r, S.n).computable) continue;
      const e = C.exactTrend(S.x, r, S.n);
      if (e) st.partial[a][b].p = e.pTwo;
    }
    if (++st.building >= ny) { st.grids.exact = st.partial; st.partial = null; }
    draw();
  });
  modes.forEach((b) => (b.onclick = () => { st.mode = b.dataset.mode; pressed(modes, (q) => q === b); draw(); }));
  fig.querySelector('[data-role=reset]').onclick = () => { st.a = S.r[0]; st.b = S.r[T]; draw(); };
  s.draw = draw; redraws.push(draw); draw();
}
