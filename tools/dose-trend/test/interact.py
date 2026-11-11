"""Drive the page the way a reader would and compare what it says with numbers worked out here.

Usage: python3 test/interact.py [--out DIR]
Checks: prose fallbacks equal the computed bindings; each figure answers to keys, pointer and buttons; the
analyzer follows edits; the studio rebuilds for every preset; exports go through a stand-in for the Claude runtime.
"""
import argparse, base64, functools, html, http.server, json, math, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser(); ap.add_argument("--out", default=str(root / "out/page_exports"))
ap.add_argument("--root", default=str(root / "dist"), help="folder to serve"); ap.add_argument("--page", default="index.html", help="page within it")
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

# ---------- reference arithmetic, written separately from src/core.js ----------
def norm_sf(z): return 0.5 * math.erfc(z / math.sqrt(2))
def trend(x, r, n):
    """Cochran-Armitage z and two-sided P with the binomial variance."""
    N, R = sum(n), sum(r); p = R / N
    t = sum(xi * (ri - ni * p) for xi, ri, ni in zip(x, r, n))
    var = p * (1 - p) * (sum(ni * xi * xi for xi, ni in zip(x, n)) - sum(ni * xi for xi, ni in zip(x, n)) ** 2 / N)
    z = t / math.sqrt(var)
    return z, 2 * norm_sf(abs(z)), norm_sf(z)
def fmt_p(p): return "<0.001" if p < 0.001 else (">0.99" if p > 0.99 else (f"{p:.3f}" if p < 0.1 else f"{p:.2f}"))

X, R, N = [0, 400, 800, 1200, 1600], [4, 3, 4, 6, 8], [13, 11, 12, 14, 13]

results = []
def check(name, ok, detail=""):
    results.append(bool(ok)); print(("ok   " if ok else "FAIL ") + name + (("  [" + str(detail)[:230] + "]") if detail and not ok else ""))

MOCK = """
window.__saved = []; window.__calls = [];
const sample = async () => ({text: '', truncated: false});
sample.limits = async () => ({maxPromptBytes: 262144, images: {maxCount: 4, maxInputBytes: 2e7, mediaTypes: ['image/png','image/jpeg']}});
sample.json = async (input, opts) => {
  window.__calls.push({promptLen: input.length, images: opts.images.length, type: opts.images[0].type, hasSignal: opts.signal instanceof AbortSignal});
  if (window.__fail) throw {code: window.__fail, message: 'x'};
  return {groups: [{label:'Placebo', n:20},{label:'10 mg', n:21},{label:'30 mg', n:19},{label:'Total', n:40}],
          rows: [{label:'Dizziness', counts:[1,4,9,13]}, {label:'Rash', counts:[0,null,2,2]}]};
};
const b64 = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
const downloads = { save: async (req) => {
  const blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
  window.__saved.push({filename: req.filename, kind: req.data instanceof Blob ? 'blob' : typeof req.data, size: blob.size, b64: await b64(blob)});
  return {status: 'saved'}; } };
window.claude = { use: async (name) => name === 'sample' ? sample : name === 'downloads' ? downloads : null };
"""
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=a.root); handler.log_message = lambda *args: None
srv = socketserver.TCPServer(("127.0.0.1", 0), handler); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ENGINE_COPY = root / "vendor/package/build/playcanvas.min.js"  # see test/shoot.py
engine = ENGINE_COPY.read_bytes() if ENGINE_COPY.exists() else None
errors = []

def open_page(browser, mock, width=1280):
    page = browser.new_page(viewport={"width": width, "height": 900})
    if mock: page.add_init_script(MOCK)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));")
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "net::ERR_FAILED" not in m.text else None)
    page.route("**/playcanvas*.js", lambda r: r.fulfill(body=engine, content_type="application/javascript") if engine else r.abort())
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort()); page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"http://127.0.0.1:{port}/{a.page}", wait_until="load"); page.wait_for_timeout(900)
    return page

def canvas_xy(page, sel, lx, ly, logical_w=680):
    """Viewport coordinates of a point given in a figure's 680-unit drawing space."""
    box = page.locator(sel).bounding_box(); k = box["width"] / logical_w
    return box["x"] + lx * k, box["y"] + ly * k

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = open_page(browser, mock=False)
    read = lambda fig: page.inner_text(f"#{fig} .readout")

    # ----- 1. the prose: text typed into the HTML must equal what the model computes -----
    src = (Path(a.root) / a.page).read_text(encoding="utf-8")
    B = page.evaluate("() => window.__bindings")
    typed = re.findall(r'<span data-b="(\w+)">([^<]*)</span>', src)
    bad = [(k, v, B.get(k)) for k, v in typed if k != "formula" and html.unescape(v) != str(B.get(k))]
    check(f"prose fallbacks match the model ({len(typed)} spans, {len(set(k for k, _ in typed))} keys)", not bad, bad)
    z, p2, p1 = trend(X, R, N)
    check("binding: asymptotic P is the reference value", B["pAsym"] == fmt_p(p2) == "0.077", (B["pAsym"], p2))
    check("binding: z", B["z"] == f"{z:.2f}", (B["z"], z))
    check("binding: P with one case fewer on placebo", B["pRefMinus"] == fmt_p(trend(X, [3, 3, 4, 6, 8], N)[1]), B["pRefMinus"])
    check("binding: P with one case more at the top dose", B["pTopPlus"] == fmt_p(trend(X, [4, 3, 4, 6, 9], N)[1]), B["pTopPlus"])
    mean_ev = sum(x * r for x, r in zip(X, R)) / sum(R); mean_all = sum(x * n for x, n in zip(X, N)) / sum(N)
    check("binding: lean", (B["meanEv"], B["meanAll"], B["lean"]) == (f"{mean_ev:.0f}", f"{mean_all:.0f}", f"{mean_ev - mean_all:.0f}"), (B["meanEv"], B["meanAll"], B["lean"]))
    check("binding: staircase and spike presets", (B["stairTrend"], B["spikeTrend"]) == (fmt_p(trend(X, [3, 3, 5, 7, 8], N)[1]), fmt_p(trend(X, [2, 9, 3, 3, 3], N)[1])), (B["stairTrend"], B["spikeTrend"]))
    check("note about the Total column is shown with its numbers", "25 and not 21" in page.inner_text("aside[data-if]"), page.inner_text("aside[data-if]"))

    # ----- 2. Figure 1: keys, pointer, reset -----
    cv = "#fig-dots canvas"; page.locator(cv).scroll_into_view_if_needed(); page.focus(cv)
    check("fig 1 starts on the trial", "1600 mg: 8 of 13" in read("fig-dots"), read("fig-dots"))
    page.keyboard.press("ArrowUp"); check("fig 1 ArrowUp adds a case", "9 of 13" in read("fig-dots") and "The trial had 8" in read("fig-dots"), read("fig-dots"))
    page.keyboard.press("ArrowLeft"); check("fig 1 ArrowLeft moves to the next group", read("fig-dots").startswith("1200 mg: 6 of 14"), read("fig-dots"))
    base = 680 * 0.38 - 60  # baseline of the dot columns in drawing units; ten cases on placebo is five rows of 22
    x, y = canvas_xy(page, cv, 26 + (680 - 52) / 5 * 0.5, base - 22 * 10 / 2)
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y + 1); page.mouse.up()
    check("fig 1 pointer sets placebo to 10", read("fig-dots").startswith("Placebo: 10 of 13"), read("fig-dots"))
    page.click("#fig-dots [data-role=reset]"); check("fig 1 reset", "1600 mg: 8 of 13" in read("fig-dots") and "trial had" not in read("fig-dots"), read("fig-dots"))

    # ----- 3. Figure 2: shuffles conserve the cases; tally runs and clears -----
    page.locator("#fig-shuffle canvas").scroll_into_view_if_needed()
    for _ in range(5): page.click("#fig-shuffle [data-role=once]")
    check("fig 2 counts six shuffles", read("fig-shuffle").startswith("Shuffle 6:"), read("fig-shuffle"))
    page.click("#fig-shuffle [data-role=auto]"); page.wait_for_timeout(2500); page.click("#fig-shuffle [data-role=auto]")
    n_auto = int(re.match(r"Shuffle ([\d,]+)", read("fig-shuffle")).group(1).replace(",", ""))
    m = re.search(r"in ([\d,]+) of ([\d,]+) shuffles", read("fig-shuffle"))
    check("fig 2 keeps shuffling, then pauses", n_auto > 10 and int(m.group(2).replace(",", "")) == n_auto, read("fig-shuffle"))
    page.wait_for_timeout(500); check("fig 2 stays paused", read("fig-shuffle").startswith(f"Shuffle {n_auto:,}:"), read("fig-shuffle"))
    page.click("#fig-shuffle [data-role=reset]"); check("fig 2 tally clears", read("fig-shuffle").startswith("Shuffle 1:"), read("fig-shuffle"))

    # ----- 4. Figure 3: moving one case changes the lean by dose step / cases -----
    cv = "#fig-beam canvas"; page.locator(cv).scroll_into_view_if_needed(); page.focus(cv)
    page.keyboard.press("Shift+ArrowLeft")
    r2 = [4, 3, 4, 7, 7]; me = sum(x * r for x, r in zip(X, r2)) / 25
    check("fig 3 Shift+ArrowLeft moves a case down a dose", f"{me:.0f} mg" in read("fig-beam") and f"+{me - mean_all:.0f} mg" in read("fig-beam") and "trial’s lean was +157 mg" in read("fig-beam"), read("fig-beam"))
    page.click("#fig-beam [data-role=reset]"); check("fig 3 reset", "976 mg" in read("fig-beam") and "+157 mg" in read("fig-beam"), read("fig-beam"))
    # drag the top case at 1600 mg to placebo: X(d) = 96 + 488 d / 1600, beam at 0.53 h
    h3 = 680 * 0.44; x0, y0 = canvas_xy(page, cv, 584, h3 * 0.53 - 30); x1, y1 = canvas_xy(page, cv, 96, h3 * 0.53 - 40)
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move((x0 + x1) / 2, y0 - 20, steps=4); page.mouse.move(x1, y1, steps=4); page.mouse.up()
    r3 = [5, 3, 4, 6, 7]; me3 = sum(x * r for x, r in zip(X, r3)) / 25
    check("fig 3 drag carries a case from 1600 mg to placebo", f"{me3:.0f} mg" in read("fig-beam"), read("fig-beam"))
    page.click("#fig-beam [data-role=reset]")

    # ----- 5. Figure 4: the pile -----
    page.locator("#fig-pile canvas").scroll_into_view_if_needed()
    check("fig 4 opens with 400 shuffles and both P values", read("fig-pile").startswith("400 shuffles") and "P = 0.090" in read("fig-pile") and "P = 0.077" in read("fig-pile"), read("fig-pile"))
    page.click("#fig-pile [data-role=run]"); page.wait_for_timeout(2500); page.click("#fig-pile [data-role=run]")
    total = int(re.match(r"([\d,]+) shuffles", read("fig-pile")).group(1).replace(",", ""))
    share = float(re.search(r"share of ([\d.]+)%", read("fig-pile")).group(1))
    check(f"fig 4 runs ({total:,} shuffles) and the tail share nears the exact 9.0% ({share}%)", total > 3000 and abs(share - 9.0) < 2.0, read("fig-pile"))
    page.click("#fig-pile [data-side=inc]")
    check("fig 4 one-sided", "toward the high doses" in read("fig-pile") and "P = 0.048" in read("fig-pile") and f"P = {fmt_p(p1)}" in read("fig-pile"), read("fig-pile"))
    page.click("#fig-pile [data-role=reset]"); page.click("#fig-pile [data-side=two]"); check("fig 4 start over", read("fig-pile").startswith("400 shuffles"), read("fig-pile"))

    # ----- 6. Figure 5: presets and keys -----
    cv = "#fig-verdicts canvas"; page.locator(cv).scroll_into_view_if_needed()
    for preset, r in (("stair", [3, 3, 5, 7, 8]), ("spike", [2, 9, 3, 3, 3]), ("flat", [5, 4, 5, 6, 5]), ("trial", R)):
        page.click(f"#fig-verdicts [data-preset={preset}]"); want = "P = " + fmt_p(trend(X, r, N)[1])
        check(f"fig 5 preset {preset}: trend {want}", want in read("fig-verdicts"), read("fig-verdicts"))
    page.click("#fig-verdicts [data-preset=spike]"); check("fig 5 spike: one dose stands out after adjustment", "P = 0.012" in read("fig-verdicts") and "One dose stands out" in read("fig-verdicts"), read("fig-verdicts"))
    page.click("#fig-verdicts [data-preset=trial]"); page.focus(cv); page.keyboard.press("ArrowDown")
    check("fig 5 ArrowDown takes a case off placebo and leaves the presets", "P = " + fmt_p(trend(X, [3, 3, 4, 6, 8], N)[1]) in read("fig-verdicts") and page.locator("#fig-verdicts [aria-pressed=true]").count() == 0, read("fig-verdicts"))
    page.click("#fig-verdicts [data-preset=trial]")

    # ----- 7. Figure 6: the landscape, both ways of computing P -----
    cv = "#fig-land canvas"; page.locator(cv).scroll_into_view_if_needed(); page.focus(cv)
    check("fig 6 starts on the trial", "P = 0.077" in read("fig-land") and "This is the trial" in read("fig-land"), read("fig-land"))
    page.keyboard.press("ArrowDown")
    check("fig 6 ArrowDown: one case fewer on placebo", "Placebo 3 of 13" in read("fig-land") and "P = 0.031, below 0.05" in read("fig-land") and "1 patient away" in read("fig-land"), read("fig-land"))
    page.click("#fig-land [data-mode=exact]"); page.wait_for_function("() => !document.querySelector('#fig-land .readout').textContent.includes('Counting')", timeout=60000)
    check("fig 6 exact mode", "P = 0.038" in read("fig-land"), read("fig-land"))
    page.click("#fig-land [data-role=reset]"); check("fig 6 exact, back at the trial", "P = 0.090" in read("fig-land"), read("fig-land"))
    # pointer: cell (placebo 4, top 9). cell = min((680-190)/14, (680*.74-96)/14), x0 = 92, y0 = 26
    cell = min((680 - 190) / 14, (680 * 0.74 - 96) / 14); x, y = canvas_xy(page, cv, 92 + cell * 9.5, 26 + cell * 14 - cell * 4.5)
    page.click("#fig-land [data-mode=asym]"); page.mouse.click(x, y)
    check("fig 6 pointer picks a cell", "Placebo 4 of 13, 1600 mg 9 of 13" in read("fig-land") and "P = 0.035" in read("fig-land"), read("fig-land"))
    page.click("#fig-land [data-role=reset]")

    # ----- 8. the analyzer follows the table and its options -----
    page.locator("#tiles").scroll_into_view_if_needed(); tiles = lambda: page.inner_text("#tiles").replace("\n", " ")
    check("analyzer opens on the example", "0.077" in tiles() and "0.090" in tiles(), tiles())
    page.select_option("#sel-alt", "inc"); check("one-sided alternative", fmt_p(p1) in tiles() and "0.048" in tiles(), tiles())
    page.select_option("#sel-alt", "two")
    page.select_option("#sel-scores", "rank"); check("equally spaced scores", fmt_p(trend([1, 2, 3, 4, 5], R, N)[1]) in tiles(), tiles())
    page.select_option("#sel-scores", "dose")
    page.uncheck("#chk-ref"); zr = trend(X[1:], R[1:], N[1:]); check("reference left out of the trend", fmt_p(zr[1]) in tiles() and f"z = {zr[0]:.2f}" in tiles(), (tiles(), zr))
    page.check("#chk-ref")
    opts = page.eval_on_selector_all("#sel-event option", "o => o.map(e => [e.value, e.textContent])")
    nasal = [v for v, t in opts if t.startswith("Nasal")][0]; page.select_option("#sel-event", nasal)
    zn = trend(X, [1, 1, 1, 3, 2], N); check("another event row", fmt_p(zn[1]) in tiles() and "nasal congestion" in page.inner_text("#txt-results").lower(), (tiles(), zn))
    check("figure follows the event", "nasal congestion" in page.inner_text("#proof").lower() or "nasal congestion" in page.inner_html("#proof").lower(), "")
    # edit a cell: nasal congestion at 1600 mg from 2 to 6
    cells = page.locator("#grid tbody tr").nth(2).locator("input[type=text]")
    cells.nth(5).fill("6"); cells.nth(5).dispatch_event("change"); page.wait_for_timeout(150)
    ze = trend(X, [1, 1, 1, 3, 6], N); check("editing a count updates the tests", fmt_p(ze[1]) in tiles(), (tiles(), ze))
    cells.nth(5).fill("20"); cells.nth(5).dispatch_event("change"); page.wait_for_timeout(150)
    check("a count larger than its group is refused with a message", page.inner_text("#errors").strip() != "" and "figure appears here" in page.inner_text("#proof"), page.inner_text("#errors"))
    page.click("#btn-example"); page.wait_for_timeout(200); check("example reloads", "0.077" in tiles(), tiles())

    # a table of another shape: three doses, no placebo, tab separated
    page.fill("#paste-box", "Event\t10 mg (n = 20)\t20 mg (n = 20)\t40 mg (n = 20)\nNausea\t2 (10.0)\t5 (25.0)\t9 (45.0)\nRash\t1\t0\t2\n")
    page.click("#btn-parse"); page.wait_for_timeout(250)
    zc = trend([10, 20, 40], [2, 5, 9], [20, 20, 20])
    check("pasted table: three doses, no placebo", fmt_p(zc[1]) in tiles() and f"z = {zc[0]:.2f}" in tiles(), (tiles(), zc, page.inner_text("#parse-msg"), page.inner_text("#errors")))
    check("pasted table: figure drawn and study notes not carried over", page.locator("#proof svg").count() == 1 and "HIV" not in page.inner_html("#proof") and page.input_value("#fig-pop") == "", page.input_value("#fig-pop"))
    print("     pairs title:", page.inner_text("#pairs-title"), "| note:", page.inner_text("#pairs-note")[:120].replace("\n", " "))
    print("     methods:", page.inner_text("#txt-methods")[:260])
    page.click("#btn-example"); page.wait_for_timeout(200)

    # ----- 9. the studio rebuilds cleanly for every preset -----
    journals = page.eval_on_selector_all("#fig-journal option", "o => o.map(e => e.value)")
    combos = 0; trouble = []
    for j in journals:
        page.select_option("#fig-journal", j)
        for col in ("double", "onehalf", "single"):
            page.select_option("#fig-column", col)
            for pa in ("schematic", "image", "none"):
                page.select_option("#fig-panel-a", pa); combos += 1
                warn = page.eval_on_selector_all("#checks li.warn", "l => l.map(e => e.textContent)")
                warn = [w for w in warn if "dpi" not in w]  # the draft illustration is knowingly below 300 dpi
                if page.locator("#proof svg").count() != 1 or warn: trouble.append((j, col, pa, warn))
    check(f"studio: {combos} journal × width × panel-a layouts build without a warning", not trouble, trouble[:4])
    page.select_option("#fig-journal", "nature"); page.select_option("#fig-column", "double"); page.select_option("#fig-panel-a", "schematic")
    page.select_option("#fig-style", "points"); page.select_option("#fig-palette", "grey"); page.select_option("#fig-pa", "exact"); page.select_option("#fig-pb", "raw")
    svg = page.inner_html("#proof")
    check("studio: exact trend P and unadjusted pairwise P reach the figure", "0.090" in svg and "0.24" in svg, "")
    page.select_option("#fig-style", "bars"); page.select_option("#fig-palette", "soft"); page.select_option("#fig-pa", "asym"); page.select_option("#fig-pb", "holm")
    page.fill("#fig-xt", "Dose (mg)"); check("studio: axis title", "Dose (mg)" in page.inner_html("#proof"), "")
    page.fill("#fig-xt", "Apricitabine dose (mg per day)")
    # JSON round trip
    page.click("#tab-json"); fig = json.loads(page.input_value("#json-box"))
    check("figure JSON has the sci-figure-gen sections", all(k in fig for k in ("figure_meta", "canvas", "elements", "connectors", "groups", "annotations", "legend")), list(fig))
    fig["figure_meta"]["title"] = "Edited by hand"; first = next(e for e in fig["elements"] if e.get("label")); first["label"] = "Edited label"
    page.fill("#json-box", json.dumps(fig)); page.click("#btn-json-apply")
    check("JSON edit is rendered", "Edited label" in page.inner_html("#proof") and "Applied" in page.inner_text("#json-msg"), page.inner_text("#json-msg"))
    page.click("#tab-json"); page.fill("#json-box", "{not json"); page.click("#btn-json-apply")
    check("broken JSON is reported, not thrown", "not valid JSON" in page.inner_text("#json-msg"), page.inner_text("#json-msg"))
    page.click("#btn-json-reset"); page.click("#tab-proof"); check("rebuild from the data", "Edited label" not in page.inner_html("#proof"), "")
    csp = page.evaluate("() => window.__csp")
    check("no Content-Security-Policy violations while using the page", not csp, csp)
    check("standalone: screenshot reading is switched off with an explanation", "off" in page.get_attribute("#drop", "class") and "Paste the table as text" in page.inner_text("#shot-hint"), page.inner_text("#shot-hint"))
    with page.expect_download() as dl: page.click("#btn-svg")
    check("standalone: SVG downloads as a file", dl.value.suggested_filename == "fig1_headache_dose_trend.svg", dl.value.suggested_filename)
    page.close()

    # ----- 10. inside Claude: screenshot reading and downloads go through the runtime -----
    page = open_page(browser, mock=True)
    check("in Claude: screenshot reading is offered", "off" not in page.get_attribute("#drop", "class"), page.inner_text("#shot-hint"))
    page.set_input_files("#file-in", {"name": "table.png", "mimeType": "image/png", "buffer": PNG}); page.wait_for_timeout(600)
    calls = page.evaluate("() => window.__calls")
    check("screenshot goes to the model with an abort signal", len(calls) == 1 and calls[0]["images"] == 1 and calls[0]["hasSignal"], calls)
    zs = trend([0, 10, 30], [1, 4, 9], [20, 21, 19])
    t = page.inner_text("#tiles").replace("\n", " ")
    check("extracted table is analysed", fmt_p(zs[1]) in t and "dizziness" in page.inner_text("#txt-results").lower(), (t, zs))
    check("the reader is told to check the numbers against the thumbnail", not page.evaluate("() => document.getElementById('shot-thumb').hidden") and page.inner_text("#parse-msg").strip() != "", page.inner_text("#parse-msg"))
    print("     message:", page.inner_text("#parse-msg").replace("\n", " ")[:200])
    for code, word in (("rate_limited", ""), ("not_granted", "")):
        page.evaluate("(c) => { window.__fail = c; }", code); page.set_input_files("#file-in", {"name": "table.png", "mimeType": "image/png", "buffer": PNG}); page.wait_for_timeout(400)
        print(f"     {code}:", page.inner_text("#parse-msg").replace("\n", " ")[:160])
        check(f"failure {code} is explained", page.inner_text("#parse-msg").strip() != "", "")
    page.click("#btn-example"); page.wait_for_timeout(200)
    # the PDF without embedded fonts, for anyone who prefers the smaller file
    page.select_option("#fig-pdf-fonts", "base"); page.click("#btn-pdf"); page.wait_for_timeout(600)
    base14 = page.evaluate("() => window.__saved.splice(0)"); (out / "fig1_headache_dose_trend.base14.pdf").write_bytes(base64.b64decode(base14[0]["b64"]))
    page.select_option("#fig-pdf-fonts", "embed")
    for pa in ("schematic", "image"):
        page.select_option("#fig-panel-a", pa); tag = "" if pa == "schematic" else "_illustration"
        page.click("#btn-svg"); page.wait_for_timeout(200)
        page.click("#btn-pdf"); page.wait_for_timeout(700)
        page.select_option("#fig-dpi", "600"); page.click("#btn-png"); page.wait_for_function("() => document.getElementById('export-msg').textContent.startsWith('Saved') || document.getElementById('export-msg').textContent.includes('could not')", timeout=60000)
        page.click("#btn-json"); page.wait_for_timeout(200)
        saved = page.evaluate("() => window.__saved.splice(0)")
        names = [s["filename"] for s in saved]
        check(f"in Claude ({pa}): four files saved through the downloads capability", names == ["fig1_headache_dose_trend.svg", "fig1_headache_dose_trend.pdf", "fig1_headache_dose_trend_600dpi.png", "fig1_headache_dose_trend.json"], (names, page.inner_text("#export-msg")))
        for s in saved:
            stem, ext = s["filename"].rsplit(".", 1); (out / f"{stem}{tag}.{ext}").write_bytes(base64.b64decode(s["b64"]))
    browser.close()
srv.shutdown()

# ----- 11. what was exported -----
import struct, xml.dom.minidom, zlib
svg = (out / "fig1_headache_dose_trend.svg").read_text(encoding="utf-8")
dom = xml.dom.minidom.parseString(svg.encode("utf-8")); root_el = dom.documentElement
check("SVG is well-formed, sized in mm, with live text", root_el.getAttribute("width") == "183mm" and len(dom.getElementsByTagName("text")) > 30 and "<path" in svg, root_el.getAttribute("width"))
check("SVG carries the journal target comment, a title and no outlined text", "Target: Nature" in svg and len(dom.getElementsByTagName("title")) >= 1, "")
png = (out / "fig1_headache_dose_trend_600dpi.png").read_bytes()
w, h = struct.unpack(">II", png[16:24]); i = png.find(b"pHYs"); ppm = struct.unpack(">I", png[i + 4:i + 8])[0]
check(f"PNG is {w} × {h} px at {round(ppm * 0.0254)} dpi (183 mm wide)", abs(w - 183 / 25.4 * 600) < 2 and round(ppm * 0.0254) == 600, (w, h, ppm))
pdf = (out / "fig1_headache_dose_trend.pdf").read_bytes()
mb = re.search(rb"/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]", pdf)
check("PDF page is 183 mm wide, embeds TrueType subsets, names no Type 3 or unembedded font", mb and abs(float(mb.group(1)) - 183 / 25.4 * 72) < 0.6 and b"/FontFile2" in pdf and b"/Subtype /TrueType" in pdf and b"/Type3" not in pdf and b"/Subtype /Type1" not in pdf and pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF"), mb and mb.groups())
pdfb = (out / "fig1_headache_dose_trend.base14.pdf").read_bytes()
check("PDF without font data names standard Helvetica", b"/BaseFont /Helvetica" in pdfb and b"/FontFile2" not in pdfb and len(pdfb) < len(pdf), (len(pdfb), len(pdf)))
import subprocess
qp = subprocess.run(["qpdf", "--check", str(out / "fig1_headache_dose_trend.pdf")], capture_output=True, text=True)
check("qpdf finds no syntax or stream errors in the PDF", qp.returncode == 0 and "No syntax or stream encoding errors" in qp.stdout, qp.stdout[-200:] + qp.stderr[-200:])
pf = subprocess.run(["pdffonts", str(out / "fig1_headache_dose_trend.pdf")], capture_output=True, text=True).stdout
check("pdffonts: every font TrueType, embedded, subset, with a Unicode map", all(("TrueType" in l and " yes " in l and l.count(" yes ") >= 2) for l in pf.splitlines()[2:] if l.strip()) and len(pf.splitlines()) > 3, pf)
tx = subprocess.run(["pdftotext", "-layout", str(out / "fig1_headache_dose_trend.pdf"), "-"], capture_output=True, text=True).stdout
check("PDF text extracts (so it is live, not outlined), with the minus sign intact", "Cochran" in tx and "P = 0.077" in tx and "−3.5" in tx, tx[:200])
pdf2 = (out / "fig1_headache_dose_trend_illustration.pdf").read_bytes()
check("PDF with the illustration embeds it as JPEG", b"/DCTDecode" in pdf2 and len(pdf2) > 100000, len(pdf2))
jf = json.loads((out / "fig1_headache_dose_trend.json").read_text(encoding="utf-8"))
check("exported JSON carries the figure and its style", "style" in jf and jf["canvas"]["width_mm"] == 183, list(jf)[:9])

print(f"\n{sum(results)}/{len(results)} checks passed; console errors: {len(errors)}")
for e in errors[:10]: print("  ", e[:300])
sys.exit(0 if all(results) and not errors else 1)
