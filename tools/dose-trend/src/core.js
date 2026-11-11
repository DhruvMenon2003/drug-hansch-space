/* Dose-Trend Analyzer: statistics, table parsing and the small models behind the figures. No DOM here. */
(function (root) {
  'use strict';

  var Z95 = 1.959963984540054;

  // ---------- special functions ----------
  var LOGFACT = [0];
  function logFact(n) {
    for (var i = LOGFACT.length; i <= n; i++) LOGFACT[i] = LOGFACT[i - 1] + Math.log(i);
    return LOGFACT[n];
  }
  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return logFact(n) - logFact(k) - logFact(n - k);
  }

  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7];
  function logGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    var a = LANCZOS[0];
    var t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Regularised upper incomplete gamma Q(a, x)
  function gammaQ(a, x) {
    if (!(x > 0)) return 1;
    var pre = Math.exp(-x + a * Math.log(x) - logGamma(a));
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 0; n < 2000; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
      }
      return Math.max(0, 1 - sum * pre);
    }
    var FPMIN = 1e-300;
    var b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < 2000; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var dl = d * c;
      h *= dl;
      if (Math.abs(dl - 1) < 1e-16) break;
    }
    return pre * h;
  }
  function normSf(z) {
    var q = 0.5 * gammaQ(0.5, z * z / 2);
    return z >= 0 ? q : 1 - q;
  }
  function chi2Sf(x, df) { return df > 0 ? gammaQ(df / 2, x / 2) : NaN; }

  // ---------- intervals ----------
  function wilson(r, n) {
    if (!(n > 0)) return [NaN, NaN];
    var p = r / n, z2 = Z95 * Z95;
    var den = 1 + z2 / n;
    var centre = (p + z2 / (2 * n)) / den;
    var half = Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
    return [r === 0 ? 0 : Math.max(0, centre - half), r === n ? 1 : Math.min(1, centre + half)];
  }
  // Newcombe hybrid-score interval for p1 - p2 (method 10 in Newcombe 1998)
  function newcombe(r1, n1, r2, n2) {
    var p1 = r1 / n1, p2 = r2 / n2;
    var w1 = wilson(r1, n1), w2 = wilson(r2, n2);
    var d = p1 - p2;
    return [d - Math.sqrt(Math.pow(p1 - w1[0], 2) + Math.pow(w2[1] - p2, 2)),
            d + Math.sqrt(Math.pow(w1[1] - p1, 2) + Math.pow(p2 - w2[0], 2))];
  }

  // ---------- tests ----------
  // Two-sided Fisher's exact test for [[a, b], [c, d]]: sum of table probabilities <= observed
  function fisherExact(a, b, c, d) {
    var r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
    var lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
    var logDen = logChoose(n, c1);
    function lp(x) { return logChoose(r1, x) + logChoose(r2, c1 - x) - logDen; }
    var lobs = lp(a), p = 0;
    for (var x = lo; x <= hi; x++) {
      var l = lp(x);
      if (l <= lobs + 1e-7) p += Math.exp(l);
    }
    return Math.min(1, p);
  }

  function holm(ps) {
    var m = ps.length;
    var idx = ps.map(function (_, i) { return i; }).sort(function (i, j) { return ps[i] - ps[j]; });
    var adj = new Array(m), run = 0;
    idx.forEach(function (i, rank) {
      run = Math.max(run, Math.min(1, (m - rank) * ps[i]));
      adj[i] = run;
    });
    return adj;
  }

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  // Cochran-Armitage test for trend. x = scores, r = events, n = group sizes.
  function cochranArmitage(x, r, n) {
    var N = sum(n), R = sum(r), k = x.length;
    var pbar = R / N;
    var T = 0, snx = 0, snx2 = 0;
    for (var i = 0; i < k; i++) {
      T += x[i] * (r[i] - n[i] * pbar);
      snx += n[i] * x[i];
      snx2 += n[i] * x[i] * x[i];
    }
    var sxx = snx2 - snx * snx / N;
    var varT = pbar * (1 - pbar) * sxx;
    var out = { N: N, R: R, k: k, T: T, varT: varT, computable: varT > 0 };
    if (!out.computable) return out;
    var z = T / Math.sqrt(varT);
    out.z = z; out.chi2 = z * z;
    out.pTwo = 2 * normSf(Math.abs(z));
    out.pInc = normSf(z);
    out.pDec = normSf(-z);
    out.slope = T / sxx; // change in proportion per unit of score (weighted least squares)
    // Pearson chi-square across all groups and the departure from a linear trend
    var chiAll = 0;
    for (var j = 0; j < k; j++) {
      var e1 = n[j] * pbar, e0 = n[j] * (1 - pbar);
      chiAll += Math.pow(r[j] - e1, 2) / e1 + Math.pow(n[j] - r[j] - e0, 2) / e0;
    }
    out.overall = { chi2: chiAll, df: k - 1, p: chi2Sf(chiAll, k - 1) };
    if (k > 2) {
      var dep = Math.max(0, chiAll - out.chi2);
      out.departure = { chi2: dep, df: k - 2, p: chi2Sf(dep, k - 2) };
    }
    return out;
  }

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  // Scores as small non-negative integers on the same (affine) scale, or null if not possible.
  function integerScores(x) {
    var min = Math.min.apply(null, x);
    var s = x.map(function (v) { return v - min; });
    for (var d = 0; d <= 6; d++) {
      var f = Math.pow(10, d);
      var t = s.map(function (v) { return v * f; });
      var ok = t.every(function (v) { return Math.abs(v - Math.round(v)) < 1e-7 * Math.max(1, Math.abs(v)); });
      if (ok) {
        var ints = t.map(function (v) { return Math.round(v); });
        var g = 0;
        ints.forEach(function (v) { g = gcd(g, v); });
        return g > 0 ? ints.map(function (v) { return v / g; }) : ints;
      }
    }
    return null;
  }

  // Exact conditional (permutation) trend test: distribution of sum(x_i * r_i) given the total
  // number of events. Returns null if the state space is larger than maxStates.
  function exactTrend(x, r, n, maxStates, maxOps) {
    maxStates = maxStates || 1500000;
    maxOps = maxOps || 1.5e7; // keeps the page responsive; larger tables use the Monte Carlo version
    var ops = 0;
    var k = x.length, R = sum(r), N = sum(n);
    var ints = integerScores(x);
    var isInt = !!ints;
    var min = Math.min.apply(null, x);
    var s = ints || x.map(function (v) { return v - min; });
    function key(t) { return isInt ? t : Number(t.toPrecision(12)); }
    var tObs = 0, eT = 0;
    for (var i = 0; i < k; i++) { tObs += s[i] * r[i]; eT += s[i] * n[i] * R / N; }
    var suffix = new Array(k + 1); suffix[k] = 0;
    for (var q = k - 1; q >= 0; q--) suffix[q] = suffix[q + 1] + n[q];

    var layer = new Map(); layer.set(0, new Map([[0, 1]]));
    var logScale = 0, tables = 0;
    for (var g = 0; g < k; g++) {
      var ni = n[g];
      // Weights are binomial coefficients scaled to stay in range. The scale is the largest coefficient among the event
      // counts this group can actually take (0..R, and enough to leave the later groups their share), not the central
      // one: for a large group with few events the central coefficient is astronomically bigger and every feasible
      // weight would underflow to zero.
      var jLo = Math.max(0, R - (N - ni)), jHi = Math.min(ni, R);
      var lcMax = logChoose(ni, Math.min(jHi, Math.max(jLo, Math.floor(ni / 2))));
      var w = new Array(ni + 1);
      for (var j0 = 0; j0 <= ni; j0++) w[j0] = Math.exp(logChoose(ni, j0) - lcMax);
      logScale += lcMax;
      var next = new Map(), count = 0, maxW = 0;
      layer.forEach(function (m, e) {
        var jMin = Math.max(0, R - e - suffix[g + 1]), jMax = Math.min(ni, R - e);
        for (var j = jMin; j <= jMax; j++) {
          var m2 = next.get(e + j);
          if (!m2) { m2 = new Map(); next.set(e + j, m2); }
          var dt = j * s[g], wj = w[j];
          ops += m.size;
          if (ops > maxOps) return;
          m.forEach(function (wt, t) {
            var t2 = key(t + dt);
            var prev = m2.get(t2);
            if (prev === undefined) { count++; prev = 0; }
            var v = prev + wt * wj;
            m2.set(t2, v);
            if (v > maxW) maxW = v;
          });
        }
      });
      if (count > maxStates || ops > maxOps) return null;
      if (maxW > 0) {
        next.forEach(function (m2) { m2.forEach(function (v, t) { m2.set(t, v / maxW); }); });
        logScale += Math.log(maxW);
      }
      layer = next;
    }
    var fin = layer.get(R);
    if (!fin) return null;
    var f = Math.exp(logScale - logChoose(N, R));
    if (!isFinite(f) || f <= 0) return null; // cannot be normalised: let the caller fall back to Monte Carlo
    var eps = 1e-9 * Math.max(1, Math.abs(tObs));
    var dObs = Math.abs(tObs - eT);
    var pInc = 0, pDec = 0, pTwo = 0, total = 0;
    fin.forEach(function (wv, t) {
      var p = wv * f;
      total += p; tables++;
      if (t >= tObs - eps) pInc += p;
      if (t <= tObs + eps) pDec += p;
      if (Math.abs(t - eT) >= dObs - eps) pTwo += p;
    });
    // The distribution itself, back in the units of sum(score * events): T = offset + scale * t
    var scale = 1;
    if (isInt) {
      var span = 0, spanI = 0;
      for (var a2 = 0; a2 < k; a2++) { span = Math.max(span, x[a2] - min); spanI = Math.max(spanI, s[a2]); }
      scale = spanI > 0 ? span / spanI : 1;
    }
    var points = [];
    fin.forEach(function (wv, t) { points.push([min * R + scale * t, wv * f]); });
    points.sort(function (p1, p2) { return p1[0] - p2[0]; });
    if (!(total > 0.999 && total < 1.001)) return null; // the probabilities must add up to one, or this answer is not trustworthy
    return { method: 'exact', pTwo: Math.min(1, pTwo), pInc: Math.min(1, pInc), pDec: Math.min(1, pDec),
             total: total, support: tables, points: points, expected: min * R + scale * eT, observed: min * R + scale * tObs };
  }

  // Monte Carlo permutation version, used only when the exact enumeration is too large.
  function monteCarloTrend(x, r, n, B, seed) {
    var k = x.length, R = sum(r), N = sum(n);
    var min = Math.min.apply(null, x);
    var s = x.map(function (v) { return v - min; });
    var draw = Math.min(R, N - R), flip = draw !== R;
    B = B || Math.max(10000, Math.min(100000, Math.floor(1e8 / Math.max(1, draw))));
    var a = (seed || 20240917) >>> 0;
    function rnd() { // mulberry32
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    var grp = new Float64Array(N), pos = 0, totalS = 0, tObs = 0, eT = 0;
    for (var i = 0; i < k; i++) {
      for (var j = 0; j < n[i]; j++) grp[pos++] = s[i];
      totalS += s[i] * n[i]; tObs += s[i] * r[i]; eT += s[i] * n[i] * R / N;
    }
    var eps = 1e-9 * Math.max(1, Math.abs(tObs)), dObs = Math.abs(tObs - eT);
    var cInc = 0, cDec = 0, cTwo = 0;
    for (var b = 0; b < B; b++) {
      var t = 0;
      for (var d = 0; d < draw; d++) {
        var u = d + Math.floor(rnd() * (N - d));
        var tmp = grp[d]; grp[d] = grp[u]; grp[u] = tmp;
        t += grp[d];
      }
      if (flip) t = totalS - t;
      if (t >= tObs - eps) cInc++;
      if (t <= tObs + eps) cDec++;
      if (Math.abs(t - eT) >= dObs - eps) cTwo++;
    }
    return { method: 'mc', B: B, pTwo: (cTwo + 1) / (B + 1), pInc: (cInc + 1) / (B + 1), pDec: (cDec + 1) / (B + 1) };
  }

  // ---------- small models used by the explorable figures ----------
  // Where the events sit on the dose axis: mean dose of patients with the event vs mean dose of everyone.
  // (sum(x*r) - expected) / R is the Cochran-Armitage numerator divided by the number of events.
  function lean(x, r, n) {
    var N = sum(n), R = sum(r), T = 0, snx = 0;
    for (var i = 0; i < x.length; i++) { T += x[i] * r[i]; snx += x[i] * n[i]; }
    var meanAll = snx / N, meanEvents = R > 0 ? T / R : NaN;
    return { T: T, expected: R * meanAll, meanAll: meanAll, meanEvents: meanEvents, lean: meanEvents - meanAll, R: R, N: N };
  }
  // Deal R events at random to N patients in groups of size n (what randomization does if dose is irrelevant).
  // rnd() must return a uniform number in [0, 1).
  function shuffleCounts(n, R, rnd) {
    var k = n.length, N = sum(n), out = new Array(k), left = N, need = R;
    for (var i = 0; i < k; i++) {           // sequential hypergeometric draws, one patient at a time
      var c = 0;
      for (var j = 0; j < n[i]; j++) {
        if (need > 0 && rnd() * left < need) { c++; need--; }
        left--;
      }
      out[i] = c;
    }
    return out;
  }
  // Two-sided trend P for every table reachable by changing the event counts of groups i and j only.
  function landscape(x, r, n, i, j, exact) {
    var grid = [];
    for (var a = 0; a <= n[i]; a++) {
      var row = [];
      for (var b = 0; b <= n[j]; b++) {
        var rr = r.slice(); rr[i] = a; rr[j] = b;
        var ca = cochranArmitage(x, rr, n), p = NaN;
        if (ca.computable) {
          if (exact) { var ex = exactTrend(x, rr, n); p = ex ? ex.pTwo : ca.pTwo; } else p = ca.pTwo;
        }
        row.push({ p: p, z: ca.computable ? ca.z : 0 });
      }
      grid.push(row);
    }
    return grid;
  }

  // ---------- table parsing ----------
  var RE_N = /\(?\s*[nN]\s*=\s*(\d[\d,]*)\s*\)?/;
  // A cell is a count, optionally "count/n", optionally followed by a percentage in brackets: 4, 4/13, 4 (30.8), 4 (30.8%).
  // A bare percentage ("10%", "30.8 %") is not a count and is refused, so it cannot pass for one.
  var RE_COUNT_CELL = /^\s*(\d+)\s*(?:\/\s*\d+\s*)?(?:[\(\[]\s*<?\s*\d+(?:[.,]\d+)?\s*%?\s*[\)\]])?\s*$/;
  var RE_PERCENT_ONLY = /^\s*<?\s*\d+(?:[.,]\d+)?\s*%\s*$/;
  var RE_SKIP = /\b(total|overall|pooled|combined|any\s+dose|all\s+(doses|active|treated|patients|subjects|participants|apricitabine))\b/i;
  var RE_REF = /\b(placebo|vehicle|control|controls|sham|untreated|comparator)\b/i;
  var RE_STUB = /^(adverse\s+events?|treatment[- ]emergent\s+adverse\s+events?|events?|preferred\s+terms?|terms?|parameters?|system\s+organ\s+class|symptoms?|a\.?e\.?s?|teaes?|category|variable|characteristics?|reactions?)\b[\s:,-]*/i;

  function cleanLabel(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^[\s|:;,]+|[\s|:;,]+$/g, '').trim();
  }
  function parseCount(cell) {
    var m = RE_COUNT_CELL.exec(String(cell == null ? '' : cell));
    return m ? parseInt(m[1], 10) : null;
  }
  function isPercentOnly(cell) { return RE_PERCENT_ONLY.test(String(cell == null ? '' : cell)); }
  function percentNote(count) {
    return count + (count === 1 ? ' cell was' : ' cells were') + ' a percentage with no count and ' + (count === 1 ? 'was' : 'were') + ' left blank: the tests need the number of patients with the event, so type the counts into the grid.';
  }
  function firstNumber(label) {
    var m = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/.exec(label);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  }
  // Guess what a column is from its header text.
  function inferGroup(label, n) {
    var role = RE_SKIP.test(label) ? 'skip' : (RE_REF.test(label) ? 'ref' : 'dose');
    var score = role === 'ref' ? 0 : firstNumber(label);
    return { label: label, n: n == null ? null : n, role: role, score: score };
  }
  function finishGroups(groups) {
    var seenRef = false;
    groups.forEach(function (g) {
      if (g.role === 'ref') { if (seenRef) g.role = 'dose'; seenRef = true; }
    });
    return groups;
  }
  function splitOutside(line, sep) { // split on sep, ignoring separators inside (...) or "..."
    var out = [], cur = '', depth = 0, quote = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { quote = !quote; continue; }
      if (!quote && (ch === '(' || ch === '[')) depth++;
      if (!quote && (ch === ')' || ch === ']')) depth = Math.max(0, depth - 1);
      if (ch === sep && depth === 0 && !quote) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function countOutside(line, sep) { return splitOutside(line, sep).length - 1; }

  function detectMode(lines) {
    if (lines.some(function (l) { return l.indexOf('\t') >= 0; })) return 'tab';
    var piped = lines.filter(function (l) { return (l.match(/\|/g) || []).length >= 2; });
    if (piped.length >= 2) return 'pipe';
    var seps = [',', ';'];
    for (var i = 0; i < seps.length; i++) {
      var sep = seps[i];
      var hits = lines.filter(function (l) { return countOutside(l, sep) >= 2; });
      if (hits.length >= 2 && hits.length >= lines.length / 2) return sep;
    }
    return 'free';
  }

  function parseDelimited(lines, mode) {
    var notes = [];
    var rows = lines.map(function (l) {
      var cells;
      if (mode === 'tab') cells = l.split('\t');
      else if (mode === 'pipe') {
        if (/^\s*\|?\s*:?-{2,}/.test(l)) return null; // markdown separator row
        cells = l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      } else cells = splitOutside(l, mode);
      return cells.map(function (c) { return c.replace(/ /g, ' ').trim(); });
    }).filter(function (r) { return r && r.some(function (c) { return c !== ''; }); });
    if (!rows.length) return null;

    function isData(row) {
      if (row.length < 2 || !/[A-Za-z]/.test(row[0])) return false;
      var rest = row.slice(1).filter(function (c) { return c !== ''; });
      if (!rest.length) return false;
      // A row of counts, or of bare percentages (which read as data, are refused as counts, and earn a note).
      var counts = rest.filter(function (c) { return parseCount(c) !== null || isPercentOnly(c); }).length;
      return counts >= Math.max(1, Math.ceil(rest.length / 2));
    }
    var firstData = -1;
    for (var i = 0; i < rows.length; i++) { if (isData(rows[i])) { firstData = i; break; } }
    if (firstData < 0) return null;
    var dataRows = rows.slice(firstData);
    var width = Math.max.apply(null, dataRows.map(function (r) { return r.length; }));
    var head = rows.slice(0, firstData);
    // The header row with the most filled cells is the real one; anything above it is a spanner.
    var main = -1, best = 0;
    head.forEach(function (r, idx) {
      var filled = r.filter(function (c) { return c !== ''; }).length;
      if (filled >= best && filled >= 2) { best = filled; main = idx; }
    });
    var labels = [];
    for (var c = 1; c < width; c++) labels.push('');
    if (main >= 0) {
      head.slice(main).forEach(function (r) {
        var shift = (r.length === width - 1) ? 1 : 0; // header row without the first (stub) cell
        for (var c2 = 1; c2 < width; c2++) {
          var v = r[c2 - shift];
          if (v) labels[c2 - 1] = (labels[c2 - 1] + ' ' + v).trim();
        }
      });
    }
    var groups = labels.map(function (lab, idx) {
      var n = null, m = RE_N.exec(lab);
      if (m) { n = parseInt(m[1].replace(/,/g, ''), 10); lab = lab.replace(RE_N, ' '); }
      lab = cleanLabel(lab.replace(/\(\s*\)/g, ''));
      return inferGroup(lab || ('Group ' + (idx + 1)), n);
    });
    var out = [], pctOnly = 0;
    dataRows.forEach(function (r) {
      var label = cleanLabel(r[0]);
      var counts = [];
      for (var c3 = 1; c3 < width; c3++) { counts.push(parseCount(r[c3])); if (isPercentOnly(r[c3])) pctOnly++; }
      if (!label && counts.every(function (v) { return v === null; })) return;
      if (counts.every(function (v) { return v === null; })) return; // sub-heading
      // A row that carries the group sizes
      if (/^(n|no\.?\s*of\s+\w+|number\s+of\s+\w+|(total\s+)?(patients|subjects|participants)(\s+\(n\))?)$/i.test(label) &&
          groups.every(function (g) { return g.n === null; })) {
        counts.forEach(function (v, idx) { groups[idx].n = v; });
        return;
      }
      out.push({ label: label || 'Event', counts: counts });
    });
    if (main < 0) notes.push('No header row found, so the columns are named Group 1, Group 2 and so on. Rename them in the grid.');
    if (pctOnly) notes.push(percentNote(pctOnly));
    return { groups: finishGroups(groups), rows: out, notes: notes };
  }

  function trailingCounts(line, K) {
    var TOK = /(?:^|\s)(\d+)(?:\s*[\(\[]\s*<?\s*\d+(?:[.,]\d+)?\s*%?\s*[\)\]])?\s*$/;
    var rest = line.replace(/ /g, ' ').replace(/\s+$/, ''), toks = [];
    while (toks.length < K) {
      var m = TOK.exec(rest);
      if (!m) break;
      toks.unshift(parseInt(m[1], 10));
      rest = rest.slice(0, m.index).replace(/\s+$/, '');
    }
    return { counts: toks, label: rest };
  }

  function parseFree(lines) {
    var notes = [];
    var RE_NG = /\(\s*[nN]\s*=\s*(\d[\d,]*)\s*\)/g;
    var headIdx = -1, groups = [];
    for (var i = 0; i < lines.length; i++) {
      var hits = lines[i].match(RE_NG);
      if (hits && hits.length >= 2) { headIdx = i; break; }
    }
    if (headIdx >= 0) {
      var line = lines[headIdx], last = 0, m;
      RE_NG.lastIndex = 0;
      while ((m = RE_NG.exec(line)) !== null) {
        var lab = cleanLabel(line.slice(last, m.index));
        if (!groups.length) {
          var stripped = lab.replace(RE_STUB, '');
          if (stripped) lab = cleanLabel(stripped);
        }
        groups.push(inferGroup(lab || ('Group ' + (groups.length + 1)), parseInt(m[1].replace(/,/g, ''), 10)));
        last = RE_NG.lastIndex;
      }
    }
    var K = groups.length;
    var body = lines.slice(headIdx + 1);
    if (!K) {
      // No "(n = ...)" header: take the most common number of trailing counts as the column count.
      var freq = {};
      body.forEach(function (l) {
        var c = trailingCounts(l, 50).counts.length;
        if (c >= 2) freq[c] = (freq[c] || 0) + 1;
      });
      var bestK = 0, bestF = 0;
      Object.keys(freq).forEach(function (c) { if (freq[c] > bestF || (freq[c] === bestF && +c > bestK)) { bestF = freq[c]; bestK = +c; } });
      K = bestK;
      if (!K) return null;
      // Try to name the columns from the line just above the first row of counts.
      var names = null;
      for (var h = 0; h < body.length; h++) {
        if (trailingCounts(body[h], 50).counts.length >= K && /[A-Za-z]/.test(trailingCounts(body[h], K).label)) break;
        var toks = body[h].match(/placebo|vehicle|control|sham|total|overall|\d+(?:\.\d+)?\s*(?:mg\/kg|µg\/kg|μg\/kg|mg|µg|μg|mcg|ug|ng|g|ml|mL|IU|U)\b(?:\s*(?:b\.?i\.?d\.?|q\.?d\.?|t\.?i\.?d\.?|q\.?i\.?d\.?))?/gi);
        if (toks && toks.length === K) names = toks;
      }
      for (var g = 0; g < K; g++) groups.push(inferGroup(names ? cleanLabel(names[g]) : 'Group ' + (g + 1), null));
      notes.push(names ? 'Group sizes were not in the header. Type the number of patients (n) for each group.'
                       : 'Column names and group sizes were not found. Fill them in the grid.');
    }
    var rows = [], skipped = 0, pctLines = 0;
    body.forEach(function (l) {
      if (!l.trim()) return;
      var t = trailingCounts(l, K);
      var label = cleanLabel(t.label);
      if (t.counts.length === K && /[A-Za-z]/.test(label)) rows.push({ label: label, counts: t.counts });
      else if (t.counts.length > 0 && t.counts.length < K && /[A-Za-z]/.test(label)) skipped++;
      else if (t.counts.length === 0 && /\d\s*%/.test(l) && /[A-Za-z]/.test(label)) pctLines++;
    });
    if (skipped) notes.push(skipped + (skipped === 1 ? ' line had' : ' lines had') + ' fewer numbers than there are columns and ' + (skipped === 1 ? 'was' : 'were') + ' left out.');
    if (pctLines) notes.push(pctLines + (pctLines === 1 ? ' line carried' : ' lines carried') + ' percentages with no counts and ' + (pctLines === 1 ? 'was' : 'were') + ' left out: the tests need the number of patients with the event.');
    if (!rows.length) return null;
    return { groups: finishGroups(groups), rows: rows, notes: notes };
  }

  function parseTable(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { error: 'Paste a table first.' };
    var mode = detectMode(lines);
    var res = mode === 'free' ? parseFree(lines) : parseDelimited(lines, mode);
    if (!res && mode !== 'free') res = parseFree(lines);
    if (!res || !res.rows.length || res.groups.length < 2) {
      if (/\d\s*%/.test(text) && !/\d\s*[\(\[]/.test(text)) return { error: 'That table gives percentages but no counts. The tests need the number of patients with the event in each group; paste counts, or counts with the percentage in brackets, for example: Headache 4 (30.8) 3 4 6 8.' };
      return { error: 'No table found in that text. Each row needs an event name followed by one count per group, for example: Headache 4 (30.8) 3 4 6 8.' };
    }
    res.mode = mode;
    return res;
  }

  // Turn the JSON read from a screenshot into the same structure parseTable returns.
  function fromExtraction(obj) {
    if (!obj || obj.error || !Array.isArray(obj.groups) || !Array.isArray(obj.rows)) {
      return { error: 'No table was found in that image.' };
    }
    var groups = obj.groups.map(function (g, i) {
      var n = (g && typeof g.n === 'number' && isFinite(g.n)) ? Math.round(g.n) : null;
      return inferGroup(cleanLabel(g && g.label) || ('Group ' + (i + 1)), n);
    });
    var rows = obj.rows.map(function (r) {
      var counts = groups.map(function (_, i) {
        var v = r && Array.isArray(r.counts) ? r.counts[i] : null;
        return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.round(v) : null;
      });
      return { label: cleanLabel(r && r.label) || 'Event', counts: counts };
    }).filter(function (r) { return r.counts.some(function (v) { return v !== null; }); });
    if (groups.length < 2 || !rows.length) return { error: 'No table was found in that image.' };
    return { groups: finishGroups(groups), rows: rows, notes: [] };
  }

  // ---------- formatting ----------
  var MINUS = '−';
  function fmtP(p) {
    if (!(p >= 0)) return '–';
    if (p < 0.001) return '<0.001';
    if (p > 0.99) return '>0.99';
    return p < 0.0995 ? p.toFixed(3) : p.toFixed(2);
  }
  function fmtPeq(p) { // "= 0.077", "< 0.001", "> 0.99"
    var s = fmtP(p);
    return s[0] === '<' ? '< ' + s.slice(1) : s[0] === '>' ? '> ' + s.slice(1) : '= ' + s;
  }
  function fmtNum(v, d) {
    if (!isFinite(v)) return '–';
    var s = Math.abs(v).toFixed(d);
    return (v < 0 && parseFloat(s) !== 0 ? MINUS : '') + s;
  }
  function fmtSigned(v, d) {
    if (!isFinite(v)) return '–';
    var s = Math.abs(v).toFixed(d);
    if (parseFloat(s) === 0) return s;
    return (v < 0 ? MINUS : '+') + s;
  }
  function fmtScore(v) { return isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : ''; }

  // ---------- full analysis of one event row ----------
  // model: { groups: [{label, n, role, score}], counts: [per group], event, scoreType, includeRef }
  function analyze(model) {
    var errors = [], warnings = [];
    var gs = model.groups.map(function (g, i) {
      return { idx: i, label: g.label || ('Group ' + (i + 1)), role: g.role, score: g.score, n: g.n, r: model.counts[i] };
    }).filter(function (g) { return g.role !== 'skip'; });

    gs.forEach(function (g) {
      if (!(Number.isInteger(g.n) && g.n > 0)) errors.push('Enter the number of patients (n) for ' + g.label + '.');
      else if (!(Number.isInteger(g.r) && g.r >= 0)) errors.push('Enter the number of patients with the event for ' + g.label + '.');
      else if (g.r > g.n) errors.push(g.label + ': ' + g.r + ' patients with the event is more than the group size of ' + g.n + '.');
    });
    if (gs.length < 2) errors.push('At least two groups are needed.');
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };

    var ref = gs.filter(function (g) { return g.role === 'ref'; })[0] || null;
    var doses = gs.filter(function (g) { return g.role === 'dose'; });
    var scoreType = model.scoreType || 'dose';
    if (scoreType === 'dose' && doses.some(function (g) { return !(typeof g.score === 'number' && isFinite(g.score)); })) {
      scoreType = 'rank';
      warnings.push('Some groups have no dose score, so equally spaced scores (1, 2, 3 …) are used. Type a score for each group to use the doses.');
    }
    if (ref && !(typeof ref.score === 'number' && isFinite(ref.score))) ref.score = 0;
    // Display order: reference first, then by dose (table order when scores tie or are ranks)
    var ordered = doses.slice();
    if (scoreType === 'dose') ordered.sort(function (a, b) { return a.score - b.score || a.idx - b.idx; });
    var all = (ref ? [ref] : []).concat(ordered);
    all.forEach(function (g) {
      g.p = g.r / g.n;
      var w = wilson(g.r, g.n);
      g.lo = w[0]; g.hi = w[1];
    });

    var trendGroups = (ref && model.includeRef !== false ? [ref] : []).concat(ordered);
    trendGroups.forEach(function (g, i) { g.used = scoreType === 'dose' ? g.score : i + 1; g.inTrend = true; });
    var res = { ok: true, errors: errors, warnings: warnings, event: model.event, groups: all, ref: ref,
                scoreType: scoreType, includeRef: !!(ref && model.includeRef !== false) };

    var x = trendGroups.map(function (g) { return g.used; });
    var r = trendGroups.map(function (g) { return g.r; });
    var n = trendGroups.map(function (g) { return g.n; });
    var distinct = x.filter(function (v, i) { return x.indexOf(v) === i; }).length;
    if (trendGroups.length < 2 || distinct < 2) {
      res.trend = { computable: false, reason: 'The trend test needs at least two groups with different dose scores.' };
    } else {
      var ca = cochranArmitage(x, r, n);
      ca.scores = x; ca.labels = trendGroups.map(function (g) { return g.label; });
      if (!ca.computable) {
        ca.reason = ca.R === 0 ? 'No patient had this event, so there is nothing to test.'
                               : 'Every patient had this event, so there is nothing to test.';
      } else {
        ca.exact = exactTrend(x, r, n) || monteCarloTrend(x, r, n);
        ca.direction = ca.z > 0 ? 'up' : ca.z < 0 ? 'down' : 'flat';
        if (trendGroups.length < 3) warnings.push('With only two groups the trend test is the same as a chi-square test comparing them.');
        var expMin = Math.min(ca.R, ca.N - ca.R) / ca.N * Math.min.apply(null, n);
        ca.smallSample = expMin < 5;
      }
      res.trend = ca;
    }

    res.pairs = [];
    if (ref) {
      res.pairs = ordered.map(function (g) {
        var ci = newcombe(g.r, g.n, ref.r, ref.n);
        return { label: g.label, r: g.r, n: g.n, rd: g.p - ref.p, lo: ci[0], hi: ci[1],
                 p: fisherExact(g.r, g.n - g.r, ref.r, ref.n - ref.r) };
      });
      var adj = holm(res.pairs.map(function (d) { return d.p; }));
      res.pairs.forEach(function (d, i) { d.pHolm = adj[i]; });
    }
    return res;
  }

  var Core = {
    Z95: Z95, logChoose: logChoose, logGamma: logGamma, gammaQ: gammaQ, normSf: normSf, chi2Sf: chi2Sf,
    wilson: wilson, newcombe: newcombe, fisherExact: fisherExact, holm: holm,
    cochranArmitage: cochranArmitage, exactTrend: exactTrend, monteCarloTrend: monteCarloTrend,
    lean: lean, shuffleCounts: shuffleCounts, landscape: landscape,
    integerScores: integerScores, parseTable: parseTable, parseCount: parseCount, inferGroup: inferGroup,
    fromExtraction: fromExtraction, analyze: analyze,
    fmtP: fmtP, fmtPeq: fmtPeq, fmtNum: fmtNum, fmtSigned: fmtSigned, fmtScore: fmtScore, MINUS: MINUS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
