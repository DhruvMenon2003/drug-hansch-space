"""Screenshot every <figure>, as the explorable skill's shoot.py does, with the 3D engine served from the
local npm copy so the check does not depend on the network.

Usage: python3 test/shoot.py OUT_DIR [--dark] [--width 1280] [--no-engine]
"""
import argparse, sys, threading, http.server, socketserver, functools
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("--dark", action="store_true"); ap.add_argument("--width", type=int, default=1280)
ap.add_argument("--no-engine", action="store_true"); ap.add_argument("--no-fonts", action="store_true");
ap.add_argument("--root", default=str(root / "dist"), help="folder to serve"); ap.add_argument("--page", default="index.html", help="page within it");
ap.add_argument("--fonts", default="", help="node_modules/@fontsource folder with the one-file build's webfonts"); ap.add_argument("--wait", type=int, default=700)
a = ap.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=a.root)
handler.log_message = lambda *args: None
srv = socketserver.TCPServer(("127.0.0.1", 0), handler); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
# One-file build only: the 3D engine is normally fetched from a CDN; a local copy (`npm pack playcanvas@2.23.3`, unpacked
# into vendor/) lets the check run offline. The site build imports the host site's own three.js and needs neither.
ENGINE_COPY = root / "vendor/package/build/playcanvas.min.js"
engine = ENGINE_COPY.read_bytes() if ENGINE_COPY.exists() else None
errors, requests = [], []
# The one-file build's webfonts, served from @fontsource packages (npm i @fontsource/stix-two-text @fontsource/ibm-plex-sans
# @fontsource/ibm-plex-mono) when their folder is given, so text is measured in the real faces; otherwise the requests are aborted.
FONTS = Path(a.fonts) if a.fonts else Path("/nonexistent")
FACES = [("STIX Two Text", "stix-two-text", [(400, "normal"), (600, "normal"), (400, "italic")]),
         ("IBM Plex Sans", "ibm-plex-sans", [(400, "normal"), (500, "normal"), (600, "normal")]),
         ("IBM Plex Mono", "ibm-plex-mono", [(400, "normal"), (500, "normal")])]
def font_css():
    out = []
    for family, slug, faces in FACES:
        for weight, style in faces:
            out.append("@font-face{font-family:'%s';font-style:%s;font-weight:%d;font-display:swap;src:url(https://fonts.gstatic.com/local/%s/files/%s-latin-%d-%s.woff2) format('woff2')}" % (family, style, weight, slug, slug, weight, style))
    return "\n".join(out)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": a.width, "height": 900}, device_scale_factor=2, color_scheme="dark" if a.dark else "light")
    # The font and (with --no-engine) engine requests are aborted on purpose; the browser reports each as a failed load.
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "net::ERR_FAILED" not in m.text else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url) if not r.url.startswith("http://127.0.0.1") and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
    if a.no_engine:
        page.route("**/playcanvas*.js", lambda r: r.abort())
    elif engine:
        page.route("**/playcanvas*.js", lambda r: r.fulfill(body=engine, content_type="application/javascript"))
    if FONTS.exists() and not a.no_fonts:
        page.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(body=font_css(), content_type="text/css"))
        page.route("**/fonts.gstatic.com/**", lambda r: r.fulfill(body=(FONTS / r.request.url.split("/local/")[1]).read_bytes(), content_type="font/woff2"))
    else:
        page.route("**/fonts.googleapis.com/**", lambda r: r.abort()); page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"http://127.0.0.1:{port}/{a.page}", wait_until="load")
    page.wait_for_timeout(2600)
    overflow = page.evaluate("document.documentElement.scrollWidth > innerWidth")
    hero = page.evaluate("window.__hero || null")
    figs = page.locator("figure"); n = figs.count()
    for i in range(n):
        f = figs.nth(i); f.scroll_into_view_if_needed(); page.wait_for_timeout(a.wait)
        name = f.get_attribute("id") or f"figure-{i + 1}"
        f.screenshot(path=str(out / f"{i + 1:02d}-{name}.png"))
    page.evaluate("window.scrollTo(0, 0)"); page.wait_for_timeout(300)
    page.screenshot(path=str(out / "00-top.png"))
    page.screenshot(path=str(out / "00-full.png"), full_page=True)
    browser.close()
srv.shutdown()
print(f"{n} figures -> {out}")
print("horizontal overflow:", overflow)
print("3D hero:", hero)
print("outside requests:", sorted(set(u.split('?')[0][:90] for u in requests)))
print("console errors:", len(errors))
for e in errors[:12]: print("  ", e[:300])
sys.exit(1 if errors or overflow else 0)
