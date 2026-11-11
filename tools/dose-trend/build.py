"""Assemble the page from src/ for one of two homes.

    python3 build.py                 # dist/index.html: one self-contained file for the Claude artifact
                                     # (webfonts from Google Fonts, PlayCanvas from jsDelivr, image and PDF fonts inlined)
    python3 build.py --site DIR      # DIR/{index.html, dose-trend.css, core.js, figure.js, app.js, panel-a.jpg, pdf-fonts.json}
                                     # for a folder inside the Drug Hansch Space site, which loads nothing from another
                                     # origin: the site's own fonts (Newsreader, Bricolage Grotesque, IBM Plex Mono) and its
                                     # vendored three.js, a CSP meta, and a nav line back to the site's other pages.
Both come from the same sources; only the placeholders differ.
"""
import argparse, base64, json, re
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
ap = argparse.ArgumentParser()
ap.add_argument("--site", metavar="DIR", help="write the multi-file site build into DIR instead of dist/index.html")
args = ap.parse_args()

LIGHT = {"bg": "#f7f7f3", "fg": "#17191c", "muted": "#5c6066", "rule": "#d9dbd6", "edge": "#b4b8b1", "panel": "#ffffff", "grid": "#e8eae5",
         "c1": "#b9471a", "c2": "#1d62ad", "c3": "#7d6209", "c4": "#0c7461", "good": "#2a7648", "bad": "#b3261e", "on-accent": "#ffffff"}
DARK = {"bg": "#121416", "fg": "#e9ebee", "muted": "#9aa0a8", "rule": "#2c3035", "edge": "#4a5058", "panel": "#191c20", "grid": "#23272c",
        "c1": "#f0875a", "c2": "#6fa8ee", "c3": "#d9b54a", "c4": "#4cc3a9", "good": "#5cc48a", "bad": "#f28b82", "on-accent": "#0d1520"}
assert LIGHT.keys() == DARK.keys()
decl = lambda t: " ".join(f"--{k}: {v};" for k, v in t.items())
tokens = "\n".join([
    "  :root { " + decl(LIGHT) + " color-scheme: light dark; }",
    "  @media (prefers-color-scheme: dark) { :root { " + decl(DARK) + " } }",
    '  :root[data-theme="light"] { ' + decl(LIGHT) + " color-scheme: light; }",
    '  :root[data-theme="dark"] { ' + decl(DARK) + " color-scheme: dark; }",
])

FONTS_ARTIFACT = """    --serif: "STIX Two Text", "STIX Two Math", Charter, "Iowan Old Style", Georgia, serif;
    --sans: "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --display: var(--serif); --display-weight: 600; --display-tracking: -.015em;"""
# The host site's three faces (site/vendor/fonts). Newsreader has one weight, so headings use the grotesque, as the site does.
FONTS_SITE = """    --serif: "Newsreader", Charter, "Iowan Old Style", Georgia, serif;
    --sans: "Bricolage Grotesque", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --display: var(--sans); --display-weight: 700; --display-tracking: -.01em;"""

HEAD_ARTIFACT = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=STIX+Two+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">"""
HEAD_SITE = """<!-- Nothing on this page comes from another origin (tools/check_site.py): the site's own fonts, its vendored three.js, and
     scripts beside the page. style-src keeps 'unsafe-inline' for the few style attributes the page and its scripts set. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'">
<link rel="canonical" href="https://dhruvmenon2003.github.io/drug-hansch-space/dose-trend/">
<meta name="theme-color" content="#f7f7f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121416" media="(prefers-color-scheme: dark)">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="../vendor/fonts/fonts.css">
<link rel="stylesheet" href="dose-trend.css">"""
NAV_SITE = """<nav class="site-nav" aria-label="Other pages of this site"><a href="../">Hansch Space</a><a href="../learn/">Why the greasiest drug isn’t the best one</a><a href="../lab/">The drug bench</a></nav>"""

HERO_ARTIFACT = {"kind": "playcanvas", "src": "https://cdn.jsdelivr.net/npm/playcanvas@2.23.3/build/playcanvas.min.js"}
HERO_SITE = {"kind": "three", "src": "../vendor/three/three.module.min.js"}

read = lambda name: (src / name).read_text(encoding="utf-8")
molecule = json.loads((root / "data/apricitabine.json").read_text())
mol_json = json.dumps({"atoms": molecule["atoms"], "bonds": molecule["bonds"]}, separators=(",", ":"))
fonts_json = (root / "data/pdf_fonts.json").read_text(encoding="utf-8")  # made by build_fonts.py

def main_js(site):
    parts = ["00-helpers.js", "05-fonts.js", "10-study.js", "20-hero.js", "30-figures.js", "40-analyzer.js", "50-studio.js"]
    js = "\n".join(read(n) for n in parts)
    js = js.replace("/*__MOLECULE__*/null", mol_json)
    js = js.replace("/*__HERO_ENGINE__*/null", json.dumps(HERO_SITE if site else HERO_ARTIFACT))
    if site:
        js = js.replace("/*__PANEL_A__*/", "panel-a.jpg").replace("/*__PDF_FONTS__*/null", json.dumps("pdf-fonts.json"))
    else:
        panel = "data:image/jpeg;base64," + base64.b64encode((root / "assets/biorender-panel-a.jpg").read_bytes()).decode()
        js = js.replace("/*__PANEL_A__*/", panel).replace("/*__PDF_FONTS__*/null", fonts_json)
    assert "/*__" not in js, "unfilled placeholder in the scripts"
    return js

def page_html(site):
    html = read("page.html").replace("/*__TOKENS__*/", tokens).replace("/*__FONT_TOKENS__*/", FONTS_SITE if site else FONTS_ARTIFACT)
    html = html.replace("<!--__HEAD__-->", HEAD_SITE if site else HEAD_ARTIFACT).replace("<!--__SITE_NAV__-->\n", (NAV_SITE + "\n") if site else "")
    if site:
        html = html.replace("The molecule is rendered with PlayCanvas, loaded only when it is on screen,", "The molecule is rendered with the site’s own copy of three.js, loaded only when it is on screen,")
        html = html.replace("The page is set in STIX Two and IBM Plex.", "The page is set in the site’s faces: Newsreader, Bricolage Grotesque and IBM Plex Mono.")
        assert "three.js" in html and "Bricolage" in html, "colophon sentences moved"
    return html

if args.site:
    out = Path(args.site); out.mkdir(parents=True, exist_ok=True)
    html = page_html(True)
    style = re.search(r"<style>\n(.*?)</style>\n", html, re.S)
    css = style.group(1)
    html = html.replace(style.group(0), "")
    html = html.replace("<script>\n/*__CORE__*/\n</script>", '<script src="core.js"></script>')
    html = html.replace("<script>\n/*__FIGURE__*/\n</script>", '<script src="figure.js"></script>')
    html = html.replace("<script>\n(() => {\n'use strict';\n/*__MAIN__*/\n})();\n</script>", '<script src="app.js"></script>')
    assert "/*__" not in html and "<style>" not in html, "unfilled placeholder in the page"
    assert "cdn.jsdelivr.net" not in html and "googleapis" not in html
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "dose-trend.css").write_text(css, encoding="utf-8")
    (out / "core.js").write_text(read("core.js"), encoding="utf-8")
    (out / "figure.js").write_text(read("figure.js"), encoding="utf-8")
    app = "(() => {\n'use strict';\n" + main_js(True) + "\n})();\n"
    assert "cdn.jsdelivr.net" not in app and "googleapis" not in app
    (out / "app.js").write_text(app, encoding="utf-8")
    (out / "pdf-fonts.json").write_text(fonts_json, encoding="utf-8")
    (out / "panel-a.jpg").write_bytes((root / "assets/biorender-panel-a-web.jpg").read_bytes())
    sizes = {p.name: p.stat().st_size for p in sorted(out.iterdir()) if p.is_file()}
    print(f"{out}: " + ", ".join(f"{k} {v:,}" for k, v in sizes.items()))
else:
    html = page_html(False).replace("/*__CORE__*/", read("core.js")).replace("/*__FIGURE__*/", read("figure.js")).replace("/*__MAIN__*/", main_js(False))
    assert "/*__" not in html, "unfilled placeholder"
    assert html.count("</script>") == 3, "a script closes early"
    (root / "dist").mkdir(exist_ok=True)
    (root / "dist/index.html").write_text(html, encoding="utf-8")
    total = len(html.encode()); print(f"dist/index.html {total:,} bytes")
