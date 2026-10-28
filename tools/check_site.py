#!/usr/bin/env python3
"""Static checks for the published folder (site/). Python 3 standard library only; exits 1 when any check fails.

    python3 -I tools/check_site.py                  # check site/ next to tools/
    python3 -I tools/check_site.py --site DIR       # another folder (the unit tests use temporary ones)
    python3 -I tools/check_site.py --strict         # warnings fail too
    python3 -I tools/check_site.py --json           # machine-readable report
    python3 -I tools/check_site.py --write-preload  # rewrite the <!-- preload:start/end --> block of index.html from the real import graph

What it checks (each line of the report is one check; "FAIL" lines carry the details):
  links       every local href / src / srcset / CSS url() and @import / manifest icon / JS import and fetched path exists;
              in-page #anchors exist; 404.html uses only absolute links (it is served at any depth)
  third-party nothing is LOADED from another origin (script, stylesheet, image, font, fetch, import, preconnect...). Own origin
              dhruvmenon2003.github.io is allowed for canonical / Open Graph tags; external hyperlinks only as <a href>.
              No known CDN host appears anywhere in site/
  vendor      every vendored file is referenced and every reference exists; notices (LICENSE*, *.md, *.txt) are exempt
  csp         the CSP meta allows scripts only from 'self' plus the sha256 of the inline import map, and that hash is right;
              no other inline script, no inline event handler, no unsafe-eval / unsafe-inline for scripts, no remote source
  importmap   every entry resolves to a file (or a folder for a prefix entry)
  preload     the modulepreload list equals the real import graph of js/main.js (static + dynamic, through the import map),
              with the 3D layer's branch inside <template id="gl-preload"> instead, data/drugs.json and data/hansch.json
              preloaded as=fetch crossorigin fetchpriority=low, the fonts as=font, and no hint pointing at another origin
  json        every .json / .webmanifest parses
  data        drugs.json / hansch.json / conformer shards agree with each other and with the page and the code
              (counts, CIDs, shard = cid % shards = MOL_SHARDS in js/data.js, no full molecules.json in site/, stamped build ids equal)
  links-rel   every target=_blank link (HTML or built by JS) has rel="noopener noreferrer"
  budget      gzip -6 sizes: per-file caps, JS / CSS / HTML first-load totals, data and font totals
              (the first-load total including fonts is a warning above 450 KB: the vendored fonts alone are about 300 KB)
"""
import argparse
import base64
import fnmatch
import gzip
import hashlib
import json
import os
import posixpath
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

OWN_HOST = "dhruvmenon2003.github.io"
BASE_URL = f"https://{OWN_HOST}/drug-hansch-space/"
CDN_HOSTS = ("cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
             "googletagmanager.com", "google-analytics.com", "ajax.googleapis.com", "code.jquery.com", "cdn.skypack.dev",
             "esm.sh", "cdn.tailwindcss.com", "use.typekit.net", "stackpath.bootstrapcdn.com")
NOTICE = ("LICENSE*", "LICENCE*", "*.md", "*.txt", "NOTICE*")
HINT_RELS = {"preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch", "prerender"}
TEXT_EXT = {".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg", ".csv", ".md", ".txt", ".xml"}
LOCAL_PATH = re.compile(r"""^[A-Za-z0-9_./-]+\.(?:js|mjs|json|css|woff2?|png|svg|jpe?g|webp|gif|ico|webmanifest|csv|md|txt)$""")

# Budgets, gzip -6 KB. See the module docstring on the fonts.
CAPS_KB = {
    "index.html": 20, "404.html": 4, "js/*.js": 25, "js/gl/*.js": 25, "*.css": 25,
    "data/drugs.json": 160, "data/hansch.json": 20, "data/mol/*.json": 40, "data/mol/index.json": 4,
    "vendor/three/three.module.min.js": 190, "vendor/three/addons/*": 15, "vendor/gsap/*": 40, "vendor/smiles-drawer/*.js": 80,
    # lab/ only: a tree-shaken Babylon.js (tools/babylon_lab_entry.js), never loaded by the explorer
    "vendor/babylon/babylon.lab.min.js": 340,
    "vendor/fonts/*.woff2": 140, "assets/*.png": 120, "assets/*.svg": 10,
}
DEFAULT_CAP_KB = 100
FIRST_LOAD_KB = {"js": 300, "css": 20, "html": 20, "data": 150, "non_fonts": 450}
TARGET_TOTAL_KB = 450          # first load including fonts: the aim; a warning when missed (fonts are not re-subsettable, SPEC-B B1.4)
SITE_RAW_MB = 10               # 8 MB + ~1.7 MB of per-target QSAR sets (site/data/qsar), fetched only when the builder opens one


# ---------------------------------------------------------------------------------------------------------------- report
class Report:
    """Errors fail the run, warnings fail it only under --strict. `checks` keeps the order the checks ran in."""

    def __init__(self):
        self.errors, self.warnings, self.checks, self.facts = [], [], [], {}
        self._open = None

    def begin(self, name):
        self._open = {"name": name, "errors": 0, "warnings": 0, "note": ""}
        self.checks.append(self._open)

    def error(self, msg):
        self.errors.append((self._open["name"], msg)); self._open["errors"] += 1

    def warn(self, msg):
        self.warnings.append((self._open["name"], msg)); self._open["warnings"] += 1

    def note(self, text):
        self._open["note"] = text

    def failed(self, name):
        return any(c == name for c, _ in self.errors)

    def ok(self, strict=False):
        return not self.errors and not (strict and self.warnings)

    def text(self, site):
        lines = [f"check_site: {site}"]
        for c in self.checks:
            tag = "FAIL" if c["errors"] else ("warn" if c["warnings"] else "ok  ")
            lines.append(f"  [{tag}] {c['name']:<12} {c['note']}")
            for n, m in self.errors:
                if n == c["name"]:
                    lines.append(f"           error: {m}")
            for n, m in self.warnings:
                if n == c["name"]:
                    lines.append(f"           warning: {m}")
        lines.append(f"check_site: {len(self.errors)} error(s), {len(self.warnings)} warning(s)")
        return "\n".join(lines)


# ---------------------------------------------------------------------------------------------------------------- site access
class Site:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.files = sorted(
            os.path.relpath(os.path.join(d, f), self.root).replace(os.sep, "/")
            for d, _, fs in os.walk(self.root) for f in fs)
        self._text, self._gz = {}, {}

    def path(self, rel):
        return os.path.join(self.root, *rel.split("/"))

    def exists(self, rel):
        return os.path.isfile(self.path(rel))

    def isdir(self, rel):
        return os.path.isdir(self.path(rel))

    def text(self, rel):
        if rel not in self._text:
            with open(self.path(rel), encoding="utf-8", errors="replace") as f:
                self._text[rel] = f.read()
        return self._text[rel]

    def raw(self, rel):
        with open(self.path(rel), "rb") as f:
            return f.read()

    def gz_kb(self, rel):
        if rel not in self._gz:
            self._gz[rel] = len(gzip.compress(self.raw(rel), 6, mtime=0)) / 1024
        return self._gz[rel]

    def under(self, prefix, suffix=None):
        return [f for f in self.files if f.startswith(prefix) and (suffix is None or f.endswith(suffix))]


def norm(base_dir, ref):
    """Join a reference to the folder it is relative to and normalise; '' for the site root. None when it escapes the root."""
    p = posixpath.normpath(posixpath.join(base_dir, unquote(ref)))
    if p.startswith(".."):
        return None
    return "" if p == "." else p


def kind_of(url):
    """local | own | data | other-scheme | external"""
    u = url.strip()
    low = u.lower()
    if low.startswith(("data:", "blob:")):
        return "data"
    if low.startswith(("mailto:", "tel:", "javascript:", "about:")):
        return "other-scheme"
    if low.startswith("//") or re.match(r"^[a-z][a-z0-9+.-]*://", low):
        host = urlsplit(u if not low.startswith("//") else "https:" + u).hostname or ""
        return "own" if host == OWN_HOST else "external"
    return "local"


def own_to_rel(url):
    """https://dhruvmenon2003.github.io/drug-hansch-space/x/y -> 'x/y' (None for other own-origin paths)."""
    s = urlsplit(url)
    if s.path.startswith("/drug-hansch-space/"):
        return unquote(s.path[len("/drug-hansch-space/"):])
    if s.path == "/drug-hansch-space":
        return ""
    return None


# ---------------------------------------------------------------------------------------------------------------- HTML
class Page(HTMLParser):
    """Collects tags (with attributes and line), inline script/style texts, ids and the raw text of the inline import map."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.scripts, self.styles, self.ids = [], [], [], set()
        self._cur = None
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        a = {k: (v if v is not None else "") for k, v in attrs}
        self.tags.append((tag, a, self.getpos()[0]))
        if "id" in a:
            self.ids.add(a["id"])
        if "name" in a and tag == "a":
            self.ids.add(a["name"])
        if tag in ("script", "style"):
            self._cur = {"tag": tag, "attrs": a, "text": "", "line": self.getpos()[0]}

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in ("script", "style"):
            self._cur = None

    def handle_data(self, data):
        if self._cur:
            self._cur["text"] += data

    def handle_endtag(self, tag):
        if self._cur and tag == self._cur["tag"]:
            (self.scripts if tag == "script" else self.styles).append(self._cur)
            self._cur = None

    def find(self, tag):
        return [(a, ln) for t, a, ln in self.tags if t == tag]


def html_refs(page):
    """[(kind_of_use, url, line)] for every URL-bearing attribute. kind: link/script/img/media/a/meta/other."""
    out = []
    for tag, a, ln in page.tags:
        if tag == "a" and "href" in a:
            out.append(("a", a["href"], ln))
        elif tag == "link" and "href" in a:
            out.append((f"link:{(a.get('rel') or '').lower()}", a["href"], ln))
        elif tag in ("script", "img", "iframe", "frame", "embed", "audio", "video", "source", "track", "input") and "src" in a:
            out.append((tag, a["src"], ln))
        if tag in ("img", "source") and "srcset" in a:
            for part in a["srcset"].split(","):
                if part.strip():
                    out.append((tag, part.strip().split()[0], ln))
        if tag == "object" and "data" in a:
            out.append(("object", a["data"], ln))
        if tag == "form" and "action" in a:
            out.append(("form", a["action"], ln))
        if tag == "meta" and (a.get("property", "").startswith("og:") or a.get("name", "").startswith("twitter:")) and re.search(r"(image|url|video|audio)$", a.get("property", a.get("name", ""))):
            out.append(("meta", a.get("content", ""), ln))
    return out


def css_refs(text):
    """URLs in url(...) and @import of a stylesheet (comments removed)."""
    text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
    out = [m.group(2) for m in re.finditer(r"url\(\s*(['\"]?)(.*?)\1\s*\)", text)]
    out += [m.group(2) for m in re.finditer(r"@import\s+(['\"])(.*?)\1", text)]
    return [u.strip() for u in out if u.strip()]


# ---------------------------------------------------------------------------------------------------------------- JS lexer
def lex_js(src):
    """Return (code, strings, templates). `code` is `src` with comments and regex literals blanked (strings kept, so import
    statements can be matched); `strings` are the contents of '...' / "..." literals; `templates` the raw text of `...` literals
    (including their ${} parts), plus every string found inside ${} expressions. A small scanner, not a parser: it knows quotes,
    comments, nested template literals and when a '/' starts a regular expression."""
    out, strings, templates = [], [], []
    n = len(src)
    regex_after = set("(,=:[!&|?{};+-*%<>~^")
    kw_before_regex = {"return", "typeof", "case", "in", "of", "do", "else", "void", "delete", "throw", "new", "instanceof", "await", "yield"}

    def scan(i, until_brace):
        depth, prev, word = 0, "", ""
        while i < n:
            c = src[i]
            if c in " \t\r\n":
                out.append(c); i += 1; continue
            if c == "/" and src.startswith("//", i):
                j = src.find("\n", i); j = n if j < 0 else j
                out.append(" " * (j - i)); i = j; continue
            if c == "/" and src.startswith("/*", i):
                j = src.find("*/", i + 2); j = n if j < 0 else j + 2
                out.append("".join(ch if ch == "\n" else " " for ch in src[i:j])); i = j; continue
            if c in "'\"":
                j = i + 1
                while j < n and src[j] != c:
                    j += 2 if src[j] == "\\" else 1
                strings.append(src[i + 1:j]); out.append(src[i:j + 1]); i = j + 1; prev, word = "x", ""; continue
            if c == "`":
                i = template(i); prev, word = "x", ""; continue
            if c == "/" and (prev == "" or prev in regex_after or word in kw_before_regex):
                j, in_class = i + 1, False
                while j < n and (src[j] != "/" or in_class):
                    if src[j] == "\\":
                        j += 1
                    elif src[j] == "[":
                        in_class = True
                    elif src[j] == "]":
                        in_class = False
                    elif src[j] == "\n":
                        break
                    j += 1
                j += 1
                while j < n and src[j].isalpha():
                    j += 1                      # flags
                out.append(" " * (j - i)); i = j; prev, word = "x", ""; continue
            if until_brace:
                if c == "{":
                    depth += 1
                elif c == "}":
                    if depth == 0:
                        return i
                    depth -= 1
            if c.isalnum() or c in "_$":
                word = word + c if (prev == "w") else c
                prev = "w"
            else:
                prev, word = c, ""
            out.append(c); i += 1
        return i

    def template(i):
        j = i + 1
        out.append("`")
        while j < n and src[j] != "`":
            if src[j] == "\\":
                out.append(src[j:j + 2]); j += 2; continue
            if src.startswith("${", j):
                out.append("${"); j = scan(j + 2, True)
                out.append("}"); j += 1
                continue
            out.append(src[j]); j += 1
        out.append("`")
        templates.append(src[i + 1:j])
        return j + 1

    scan(0, False)
    return "".join(out), strings, templates


IMPORT_RES = (re.compile(r"""^\s*(?:import|export)\b[^'";]*?\bfrom\s*(['"])(.+?)\1""", re.M),
              re.compile(r"""^\s*import\s*(['"])(.+?)\1""", re.M),
              re.compile(r"""\bimport\(\s*(['"])(.+?)\1\s*\)"""))
MIN_IMPORT_RES = (re.compile(r"""\bfrom\s*(['"])([^'"]+)\1"""), re.compile(r"""\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)"""))


def js_imports(rel, text, minified=False):
    """Import specifiers of one module: [(spec, dynamic)]. First-party files are lexed first (comments are not imports)."""
    if minified:
        return [(m.group(2), False) for m in MIN_IMPORT_RES[0].finditer(text)] + [(m.group(2), True) for m in MIN_IMPORT_RES[1].finditer(text)]
    code = lex_js(text)[0]
    out = []
    for i, rx in enumerate(IMPORT_RES):
        out += [(m.group(2), i == 2) for m in rx.finditer(code)]
    return out


# ---------------------------------------------------------------------------------------------------------------- the checks
class Ctx:
    """Everything parsed once: pages, import map, CSP, import graph."""

    def __init__(self, site, rep):
        self.site, self.rep = site, rep
        self.pages = {}
        for f in site.files:
            if f.endswith(".html"):
                self.pages[f] = Page(site.text(f))
        self.index = self.pages.get("index.html")
        self.first_party_js = [f for f in site.files if f.startswith("js/") and f.endswith(".js")]
        self.importmap = {}
        self.importmap_script = None
        if self.index:
            for s in self.index.scripts:
                if s["attrs"].get("type") == "importmap":
                    self.importmap_script = s
                    try:
                        self.importmap = json.loads(s["text"]).get("imports", {})
                    except ValueError:
                        self.importmap = {}
        self.entry = None
        if self.index:
            for a, _ in self.index.find("script"):
                if a.get("type") == "module" and a.get("src"):
                    self.entry = norm("", a["src"])
        self._graph = None

    def resolve_spec(self, spec, from_file):
        """Import specifier -> site-relative path, or None. Bare specifiers go through the import map (exact, then longest prefix)."""
        if spec.startswith(("./", "../")):
            return norm(posixpath.dirname(from_file), spec)
        if spec.startswith("/"):
            return norm("", spec[1:])
        if spec in self.importmap:
            return norm("", self.importmap[spec])
        best = None
        for k, v in self.importmap.items():
            if k.endswith("/") and spec.startswith(k) and (best is None or len(k) > len(best[0])):
                best = (k, v)
        return norm("", best[1] + spec[len(best[0]):]) if best else None

    def graph(self):
        """{file: [imported files]} reachable from the entry, plus the list of unresolved (file, spec). Vendored modules are
        scanned with a looser pattern (they are minified)."""
        if self._graph is not None:
            return self._graph
        edges, unresolved, seen, todo = {}, [], set(), [self.entry] if self.entry else []
        while todo:
            f = todo.pop(0)
            if f in seen:
                continue
            seen.add(f)
            if not self.site.exists(f):
                edges[f] = []
                continue
            specs = js_imports(f, self.site.text(f), minified=f.startswith("vendor/"))
            out = []
            for spec, _dyn in specs:
                t = self.resolve_spec(spec, f)
                if t is None:
                    unresolved.append((f, spec))
                    continue
                out.append(t)
                todo.append(t)
            edges[f] = out
        self._graph = (edges, unresolved)
        return self._graph


def check_links(cx):
    rep, site = cx.rep, cx.site
    rep.begin("links")
    n = 0
    # HTML pages
    for name, page in cx.pages.items():
        base_dir = posixpath.dirname(name)
        for use, url, ln in html_refs(page):
            k = kind_of(url)
            if k in ("data", "other-scheme"):
                continue
            if k == "external":
                continue                                # judged by the third-party check
            if url.strip().startswith("#"):
                frag = url.strip()[1:]
                n += 1
                if frag and frag not in page.ids and frag != "top":
                    rep.error(f"{name}:{ln}: in-page link #{frag} has no target id")
                continue
            if name == "404.html" and k == "local":
                rep.error(f"{name}:{ln}: relative link {url!r}: this page is served at any depth, use absolute URLs")
                continue
            path = own_to_rel(url) if k == "own" else norm(base_dir, urlsplit(url).path)
            n += 1
            if path is None:
                if k == "local":
                    rep.error(f"{name}:{ln}: {url!r} leaves the site folder")
                continue
            if k == "own":
                if not (site.exists(path or "index.html") or site.isdir(path)):
                    rep.warn(f"{name}:{ln}: {url} does not exist in site/ yet")
                continue
            if path == "" or site.isdir(path):
                path = posixpath.join(path, "index.html")
            if not site.exists(path):
                rep.error(f"{name}:{ln}: {use.split(':')[0]} target {url!r} does not exist (looked for {path})")
    # stylesheets (and the <style> blocks of pages)
    for f in site.files:
        if f.endswith(".css"):
            for u in css_refs(site.text(f)):
                k = kind_of(u)
                if k != "local":
                    continue
                n += 1
                t = norm(posixpath.dirname(f), urlsplit(u).path)
                if t is None or not site.exists(t):
                    rep.error(f"{f}: url({u}) does not exist")
    # manifest
    if site.exists("manifest.webmanifest"):
        try:
            m = json.loads(site.text("manifest.webmanifest"))
        except ValueError:
            m = {}
        refs = [i.get("src") for i in m.get("icons", []) if isinstance(i, dict)] + [m.get("start_url")]
        for u in refs:
            if u and kind_of(u) == "local":
                n += 1
                t = norm("", urlsplit(u).path)
                if t is None or not (site.exists(t) or t == "" or site.isdir(t)):
                    rep.error(f"manifest.webmanifest: {u!r} does not exist")
    # JS: imports and fetched paths
    edges, unresolved = cx.graph()
    for f, spec in unresolved:
        rep.error(f"{f}: import {spec!r} does not resolve (not relative and not in the import map)")
    for f, outs in edges.items():
        for t in outs:
            n += 1
            if not site.exists(t):
                rep.error(f"{f}: imports {t} which does not exist")
    for f in cx.first_party_js:
        _, strings, templates = lex_js(site.text(f))
        for s in strings + templates:
            s2 = re.sub(r"\$\{[^}]*\}", "*", s.strip())
            if not LOCAL_PATH.match(s2.replace("*", "x")) or s2.startswith(".") or "/" not in s2:
                continue                                # not a path, or an import specifier (those are checked through the graph)
            if cx.resolve_spec(s2, f) is not None and not s2.startswith("vendor/"):
                continue                                # a bare specifier of the import map ('three/addons/...')
            n += 1
            if "*" in s2:
                if not fnmatch.filter(site.files, s2):
                    rep.error(f"{f}: {s!r} matches no file")
            elif not site.exists(s2):
                rep.error(f"{f}: refers to {s2!r} which does not exist (paths in code are relative to index.html)")
    rep.note(f"{n} references resolved")


# Hosts the page links TO (hyperlinks built in JS keep the URL in a constant, so the checker cannot see the <a href> around it).
# Loading from them is impossible (CSP connect-src / img-src 'self') and is also caught by the fetch/import scan below.
LINK_OUT_HOSTS = ("pubchem.ncbi.nlm.nih.gov", "www.rcsb.org", "www.ebi.ac.uk", "github.com", "atcddd.fhi.no", "gsap.com", "openfontlicense.org",
                  "www.who.int", "www.drugbank.com", "go.drugbank.com", "dailymed.nlm.nih.gov", "open.fda.gov", "creativecommons.org")
LOAD_CALLS = re.compile(r"""\b(?:fetch|import|Worker|SharedWorker|EventSource|WebSocket)\s*\(\s*[`'"](?:https?:)?//|navigator\.sendBeacon\s*\(\s*[`'"](?:https?:)?//|\.open\(\s*['"][A-Z]+['"]\s*,\s*[`'"](?:https?:)?//|\.src\s*=\s*[`'"](?:https?:)?//""")


def check_third_party(cx):
    rep, site = cx.rep, cx.site
    rep.begin("third-party")
    for name, page in cx.pages.items():
        for use, url, ln in html_refs(page):
            if kind_of(url) == "external" and use != "a":
                rep.error(f"{name}:{ln}: loads {url} ({use.split(':')[0]}) from another origin")
        for tag, a, ln in page.tags:
            if tag == "link" and (a.get("rel") or "").lower() == "canonical" and kind_of(a.get("href", "")) == "external":
                rep.error(f"{name}:{ln}: canonical points to another origin: {a['href']}")
            if tag == "meta" and a.get("http-equiv", "").lower() == "refresh":
                rep.error(f"{name}:{ln}: meta refresh")
        for s in page.styles:
            for u in css_refs(s["text"]):
                if kind_of(u) == "external":
                    rep.error(f"{name}:{s['line']}: <style> loads {u}")
    for f in site.files:
        if f.endswith(".css"):
            for u in css_refs(site.text(f)):
                if kind_of(u) == "external":
                    rep.error(f"{f}: loads {u}")
        if f.endswith(".svg"):
            for m in re.finditer(r"""(?:href|src)\s*=\s*["'](https?://[^"']+)|url\(\s*["']?(https?://[^)"']+)""", site.text(f)):
                rep.error(f"{f}: loads {m.group(1) or m.group(2)}")
    # first-party JS: an absolute URL is a hyperlink target (<a href>, or a link-out host), an XML namespace, or an error
    for f in cx.first_party_js:
        code, strings, templates = lex_js(site.text(f))
        for m in LOAD_CALLS.finditer(code):
            rep.error(f"{f}: loads from another origin: {code[m.start():m.end() + 40].splitlines()[0]}")
        for t in templates + strings:
            for m in re.finditer(r"(?:https?:)?//[A-Za-z0-9.-]+\.[a-z]{2,}[^\s\"'`)<>]*", t):
                u = m.group(0)
                host = urlsplit(u if u.startswith("http") else "https:" + u).hostname or ""
                before = t[max(0, m.start() - 12):m.start()]
                if host == "www.w3.org" or host == OWN_HOST or host in LINK_OUT_HOSTS or re.search(r"""href\s*=\s*["']?$""", before):
                    continue
                rep.error(f"{f}: absolute URL {u}: external URLs may only be hyperlinks (<a href>) to the known link-out hosts")
    # no known CDN host anywhere
    for f in site.files:
        if os.path.splitext(f)[1] in TEXT_EXT:
            text = site.text(f)
            for h in CDN_HOSTS:
                if h in text:
                    (rep.warn if f.startswith("vendor/") else rep.error)(f"{f}: mentions {h}")
    # CSP: no remote source
    csp = csp_of(cx)
    if csp:
        for d, vals in csp.items():
            for v in vals:
                if re.match(r"^(https?:)?//|^https?://|^\*", v) and v != "https:":
                    if d in ("img-src", "default-src") and urlsplit(v).hostname == OWN_HOST:
                        continue
                    rep.error(f"CSP {d} allows a remote source: {v}")
    rep.note("no request leaves the site's own origin")


def csp_of(cx):
    """{directive: [values]} of the CSP meta of index.html (None when absent)."""
    if not cx.index:
        return None
    for a, _ in cx.index.find("meta"):
        if a.get("http-equiv", "").lower() == "content-security-policy":
            out = {}
            for part in a.get("content", "").split(";"):
                bits = part.split()
                if bits:
                    out[bits[0].lower()] = bits[1:]
            return out
    return None


def check_csp(cx):
    rep, site = cx.rep, cx.site
    rep.begin("csp")
    if not cx.index:
        rep.error("site/index.html is missing")
        return
    csp = csp_of(cx)
    if csp is None:
        rep.error("index.html has no Content-Security-Policy meta")
        return
    src = csp.get("script-src", csp.get("default-src", []))
    if "'self'" not in src:
        rep.error("script-src does not allow 'self'")
    for bad in ("'unsafe-eval'", "'unsafe-inline'", "*", "data:", "blob:"):
        if bad in src:
            rep.error(f"script-src allows {bad}")
    hashes = [v for v in src if v.startswith("'sha")]
    scripts = [s for s in cx.index.scripts if "src" not in s["attrs"]]
    for s in scripts:
        if s["attrs"].get("type") != "importmap":
            rep.error(f"index.html:{s['line']}: inline <script> (blocked by the CSP; move it to a file)")
    im = cx.importmap_script
    if im is None:
        rep.error("index.html has no inline import map (the app imports 'three' by name)")
    else:
        digest = "'sha256-" + base64.b64encode(hashlib.sha256(im["text"].encode("utf-8")).digest()).decode() + "'"
        if digest not in hashes:
            rep.error(f"CSP script-src has no hash of the inline import map: expected {digest}, found {hashes or 'none'}")
        for h in hashes:
            if h != digest:
                rep.error(f"CSP script-src carries a hash that matches no inline script: {h}")
    for tag, a, ln in cx.index.tags:
        for k in a:
            if k.startswith("on") and len(k) > 2 and tag not in ("meta",):
                rep.error(f"index.html:{ln}: inline event handler {k}= (blocked by the CSP)")
    for need in ("default-src", "connect-src", "object-src", "base-uri"):
        if need not in csp:
            rep.warn(f"CSP has no {need}")
    rep.note(f"script-src: 'self' + {len(hashes)} hash(es), import map hash {'ok' if not rep.failed('csp') else 'WRONG'}")


def check_importmap(cx):
    rep, site = cx.rep, cx.site
    rep.begin("importmap")
    if cx.importmap_script is None:
        rep.note("no import map")
        return
    try:
        json.loads(cx.importmap_script["text"])
    except ValueError as e:
        rep.error(f"the import map is not valid JSON: {e}")
        return
    for k, v in cx.importmap.items():
        t = norm("", v)
        if t is None:
            rep.error(f"{k!r} -> {v!r} leaves the site folder")
        elif k.endswith("/"):
            if not v.endswith("/"):
                rep.error(f"prefix entry {k!r} must map to a folder ending in '/': {v!r}")
            elif not site.isdir(t):
                rep.error(f"{k!r} -> {v!r}: the folder does not exist")
        elif not site.exists(t):
            rep.error(f"{k!r} -> {v!r}: the file does not exist")
    rep.note(f"{len(cx.importmap)} entries resolve")


GL_ENTRY = "js/boot-gl.js"


def expected_preloads(cx):
    """(core, gl): the files js/main.js needs at once, and the ones only the 3D layer needs, in discovery order.

    main.js imports js/boot-gl.js only when WebGL works, so that branch of the graph is hinted from an inert <template>
    the page copies into the head in that case: a browser without WebGL must not download three.js at all
    (tests/e2e/fallbacks.spec.mjs). Everything else is a plain <link rel="modulepreload">."""
    edges, _ = cx.graph()

    def reach(roots, blocked=()):
        seen, order, todo = set(blocked), [], [r for r in roots if r]
        while todo:
            f = todo.pop(0)
            if f is None or f in seen:
                continue
            seen.add(f)
            order.append(f)
            todo += edges.get(f, [])
        return order

    core = reach([cx.entry], blocked={GL_ENTRY})
    return core, [f for f in reach([GL_ENTRY]) if f not in set(core)]


def preload_block(text):
    m = re.search(r"<!-- preload:start.*?-->(.*?)<!-- preload:end", text, re.S)
    return m


def split_gl_template(block):
    """(outside, inside) of the <template id="gl-preload"> that holds the 3D layer's hints."""
    m = re.search(r'<template id="gl-preload".*?>(.*?)</template>', block, re.S)
    return (block[: m.start()] + block[m.end():], m.group(1)) if m else (block, None)


def render_preload_block(cx):
    mods, gl = expected_preloads(cx)
    L = ["<!-- preload:start (written by tools/check_site.py --write-preload from the import graph of js/main.js; do not edit by hand) -->"]
    L += [f'<link rel="modulepreload" href="{f}">' for f in mods]
    L.append('<template id="gl-preload"><!-- the 3D layer; js/main.js copies these into the head only when WebGL works -->')
    L += [f'<link rel="modulepreload" href="{f}">' for f in gl]
    L.append("</template>")
    L += [f'<link rel="preload" href="{f}" as="fetch" type="application/json" crossorigin fetchpriority="low">' for f in data_fetches(cx)]
    L.append("<!-- preload:end -->")
    return "\n".join(L)


def data_fetches(cx):
    """JSON files js/data.js fetches at boot (literal paths in its code): the data worth preloading."""
    f = "js/data.js"
    if not cx.site.exists(f):
        return []
    _, strings, _ = lex_js(cx.site.text(f))
    out = []
    for s in strings:
        if re.fullmatch(r"data/[A-Za-z0-9_-]+\.json", s) and s not in out:
            out.append(s)
    return out


def check_preload(cx):
    rep, site = cx.rep, cx.site
    rep.begin("preload")
    if not cx.index:
        return
    text = site.text("index.html")
    m = preload_block(text)
    if not m:
        rep.error("index.html has no <!-- preload:start --> ... <!-- preload:end --> block")
        return
    outside, inside = split_gl_template(m.group(1))
    mods, fetches = [], []
    for a, ln in Page(outside).find("link"):
        rel = (a.get("rel") or "").lower()
        if rel == "modulepreload":
            mods.append(norm("", a.get("href", "")))
        elif rel == "preload":
            fetches.append(a)
        else:
            rep.error(f"preload block: unexpected <link rel={rel!r}>")
    glmods = []
    if inside is not None:
        for a, ln in Page(inside).find("link"):
            if (a.get("rel") or "").lower() != "modulepreload":
                rep.error('the gl-preload template holds only <link rel="modulepreload">')
            else:
                glmods.append(norm("", a.get("href", "")))
    want, want_gl = expected_preloads(cx)
    if inside is None and want_gl:
        rep.error('index.html has no <template id="gl-preload"> for the 3D layer\'s hints')
    got_set, want_set = set(mods), set(want)
    for f in sorted(want_set - got_set):
        rep.error(f"modulepreload missing for {f} (it is in the import graph of {cx.entry})")
    for f in sorted(got_set - want_set):
        rep.error(f"modulepreload for {f}, which js/main.js does not import outside the 3D layer")
    if len(mods) != len(got_set):
        rep.error("duplicate modulepreload entries")
    for f in sorted(set(want_gl) - set(glmods)):
        rep.error(f"the gl-preload template is missing {f} (the 3D layer imports it)")
    for f in sorted(set(glmods) - set(want_gl)):
        rep.error(f"the gl-preload template hints {f}, which the 3D layer does not import")
    # data
    wants = data_fetches(cx)
    gots = [norm("", a.get("href", "")) for a in fetches]
    for u in wants:
        if u not in gots:
            rep.error(f"{u} is fetched at boot (js/data.js) but not preloaded")
    for a in fetches:
        u = norm("", a.get("href", ""))
        if u not in wants:
            rep.error(f"preload of {u}, which js/data.js does not fetch at boot")
        if (a.get("as") or "") != "fetch" or "crossorigin" not in a or (a.get("fetchpriority") or "") != "low":
            rep.error(f"preload of {u} must be as=\"fetch\" crossorigin fetchpriority=\"low\"")
        if u and not site.exists(u):
            rep.error(f"preload of {u}: the file does not exist")
    # everywhere in the page: fonts as=font crossorigin, nothing third-party, modulepreload only in the block
    for a, ln in cx.index.find("link"):
        rel = set((a.get("rel") or "").lower().split())
        href = a.get("href", "")
        if rel & HINT_RELS and kind_of(href) == "external":
            rep.error(f"index.html:{ln}: resource hint to another origin: {href}")
        if rel & {"preconnect", "dns-prefetch"}:
            rep.error(f"index.html:{ln}: {'/'.join(sorted(rel))} hint (this page makes no third-party requests, so none is needed)")
        if "preload" in rel and a.get("as") == "font":
            if "crossorigin" not in a or a.get("type") != "font/woff2":
                rep.error(f"index.html:{ln}: font preload must carry type=\"font/woff2\" and crossorigin")
            t = norm("", href)
            if t is None or not site.exists(t):
                rep.error(f"index.html:{ln}: font preload target {href} does not exist")
    rep.note(f"{len(mods)} modules + {len(glmods)} in the 3D template + {len(fetches)} data files; the lists equal the import graph"
              if not rep.failed("preload") else "")


def check_json(cx):
    rep, site = cx.rep, cx.site
    rep.begin("json")
    n = 0
    for f in site.files:
        if f.endswith((".json", ".webmanifest")):
            n += 1
            try:
                json.loads(site.text(f))
            except ValueError as e:
                rep.error(f"{f}: does not parse: {e}")
    rep.note(f"{n} files parse")


def read_const(cx, name, rel="js/data.js"):
    if not cx.site.exists(rel):
        return None
    m = re.search(rf"\bexport const {name}\s*=\s*(\d+)\b", cx.site.text(rel))
    return int(m.group(1)) if m else None


def check_data(cx):
    rep, site = cx.rep, cx.site
    rep.begin("data")
    if site.exists("data/molecules.json"):
        rep.error("data/molecules.json (the full 1 MB conformer table) is published: it belongs in tools/data/, the page uses data/mol/<n>.json")
    if not site.exists("data/drugs.json") or not site.exists("data/hansch.json"):
        rep.error("data/drugs.json or data/hansch.json is missing")
        return
    try:
        dj, hj = json.loads(site.text("data/drugs.json")), json.loads(site.text("data/hansch.json"))
    except ValueError:
        return                                          # reported by the json check
    drugs = dj.get("drugs", [])
    meta = dj.get("meta", {})
    cids = [d.get("cid") for d in drugs]
    cid_set = set(cids)
    if meta.get("n_drugs") != len(drugs):
        rep.error(f"drugs.json meta.n_drugs {meta.get('n_drugs')} != {len(drugs)} drugs")
    if len(cid_set) != len(cids):
        rep.error("drugs.json has duplicate CIDs")
    for g in hj.get("groups", []):
        pts = [p.get("cid") for p in g.get("points", [])]
        if g.get("n") != len(pts):
            rep.error(f"hansch.json group {g.get('id')}: n={g.get('n')} but {len(pts)} points")
        missing = [c for c in pts if c not in cid_set]
        if missing:
            rep.error(f"hansch.json group {g.get('id')}: {len(missing)} point CID(s) are not drugs (e.g. {missing[0]})")
    if cx.index:
        m = re.search(r'id="m-count">\s*(\d+)\s*<', site.text("index.html"))
        if m and int(m.group(1)) != len(drugs):
            rep.error(f"index.html says {m.group(1)} drugs (#m-count) but drugs.json has {len(drugs)}")
    # conformer shards
    with_conf = {d["cid"] for d in drugs if d.get("conf")}
    shards_const = read_const(cx, "MOL_SHARDS")
    mol_files = [f for f in site.files if re.fullmatch(r"data/mol/\d+\.json", f)]
    if not mol_files and not site.exists("data/mol/index.json"):
        if with_conf:
            rep.error("drugs.json lists drugs with conformers but site/data/mol/ has no shards (run tools/shard_molecules.py)")
    else:
        try:
            idx = json.loads(site.text("data/mol/index.json"))
        except (OSError, ValueError):
            idx = None
            rep.error("data/mol/index.json is missing or not valid JSON")
        if idx is not None:
            sc = idx.get("shards")
            if shards_const is None:
                rep.error("js/data.js has no `export const MOL_SHARDS = N`")
            elif sc != shards_const:
                rep.error(f"shard count differs: data/mol/index.json says {sc}, js/data.js MOL_SHARDS is {shards_const}")
            names = {f"data/mol/{i}.json" for i in range(sc or 0)}
            for f in sorted(names - set(mol_files)):
                rep.error(f"{f} is missing")
            for f in sorted(set(mol_files) - names):
                rep.error(f"{f} is not a shard of {sc}")
            seen = set()
            for f in sorted(names & set(mol_files)):
                i = int(posixpath.basename(f)[:-5])
                try:
                    shard = json.loads(site.text(f))
                except ValueError:
                    continue
                entry = (idx.get("files") or {}).get(str(i), {})
                if entry.get("n") != len(shard):
                    rep.error(f"{f}: index.json says {entry.get('n')} molecules, the file has {len(shard)}")
                for key, mol in shard.items():
                    c = int(key) if key.isdigit() else None
                    if c is None or sc and c % sc != i:
                        rep.error(f"{f}: CID {key} does not belong in shard {i} (cid % {sc} = {c % sc if c is not None and sc else '?'})")
                        continue
                    seen.add(c)
                    ok = isinstance(mol, dict) and all(k in mol for k in ("z", "xyz", "b", "src"))
                    if not ok:
                        rep.error(f"{f}: molecule {key} lacks z / xyz / b / src")
                        continue
                    nz = len(mol["z"])
                    if len(mol["xyz"]) != 3 * nz:
                        rep.error(f"{f}: molecule {key}: {len(mol['xyz'])} coordinates for {nz} atoms")
                    if len(mol["b"]) % 3 or any(not isinstance(v, int) for v in mol["b"]) or any(mol["b"][k] >= nz or mol["b"][k + 1] >= nz for k in range(0, len(mol["b"]) - 2, 3)):
                        rep.error(f"{f}: molecule {key}: bad bond list")
            if seen != with_conf:
                extra, lack = sorted(seen - with_conf), sorted(with_conf - seen)
                if lack:
                    rep.error(f"{len(lack)} drug(s) with a conformer (conf) have no molecule in the shards (e.g. CID {lack[0]})")
                if extra:
                    rep.error(f"{len(extra)} shard molecule(s) belong to drugs without `conf` (e.g. CID {extra[0]})")
            if idx.get("count") != len(seen):
                rep.error(f"data/mol/index.json count {idx.get('count')} != {len(seen)} molecules in the shards")
    # build stamps
    code = None
    if site.exists("js/version.js"):
        m = re.search(r"^export const APP_BUILD = '([^'\n]*)';", site.text("js/version.js"), re.M)
        code = m.group(1) if m else None
        if code is None:
            rep.error("js/version.js has no `export const APP_BUILD = '...';` line")
    data_build = meta.get("app_build")
    if data_build is not None and not isinstance(data_build, str):
        rep.error("drugs.json meta.app_build must be a string")
    elif code is not None and ((code == "dev") != (data_build is None) or (code != "dev" and code != data_build)):
        rep.error(f"build stamps disagree: js/version.js APP_BUILD={code!r}, drugs.json meta.app_build={data_build!r} (tools/stamp_build.py writes both)")
    rep.note(f"{len(drugs)} drugs, {len(hj.get('groups', []))} fit groups, {len(with_conf)} conformers in {len(mol_files)} shards, build {code!r}")


def check_vendor(cx):
    rep, site = cx.rep, cx.site
    rep.begin("vendor")
    referenced = set()
    edges, _ = cx.graph()
    for f, outs in edges.items():
        referenced.add(f)
        referenced.update(outs)
    for name, page in cx.pages.items():
        for _use, url, _ln in html_refs(page):
            if kind_of(url) == "local":
                t = norm(posixpath.dirname(name), urlsplit(url).path)
                if t:
                    referenced.add(t)
    for f in site.files:
        if f.endswith(".css"):
            for u in css_refs(site.text(f)):
                if kind_of(u) == "local":
                    t = norm(posixpath.dirname(f), urlsplit(u).path)
                    if t:
                        referenced.add(t)
    for f in cx.first_party_js:
        _, strings, templates = lex_js(site.text(f))
        for s in strings + templates:
            if LOCAL_PATH.match(s) and "/" in s and not s.startswith("."):
                referenced.add(s)
    vend = [f for f in site.files if f.startswith("vendor/")]
    n = 0
    for f in vend:
        base = posixpath.basename(f)
        if any(fnmatch.fnmatch(base, p) for p in NOTICE):
            continue
        n += 1
        if f not in referenced:
            rep.error(f"{f} is vendored but nothing references it (delete it, or reference it)")
    for d in sorted({f.split("/")[1] for f in vend if f.count("/") >= 2}):
        if not any(f.startswith(f"vendor/{d}/") and any(fnmatch.fnmatch(posixpath.basename(f), p) for p in NOTICE) for f in vend):
            rep.warn(f"vendor/{d}/ carries no licence or notice file")
    rep.note(f"{n} vendored files, all referenced")


def check_rel(cx):
    rep, site = cx.rep, cx.site
    rep.begin("links-rel")
    n = 0
    need = {"noopener", "noreferrer"}
    for name, page in cx.pages.items():
        for a, ln in page.find("a"):
            if (a.get("target") or "").lower() == "_blank":
                n += 1
                if not need <= set((a.get("rel") or "").lower().split()):
                    rep.error(f"{name}:{ln}: target=_blank link without rel=\"noopener noreferrer\": {a.get('href', '')[:80]}")
    for f in cx.first_party_js:
        _, strings, templates = lex_js(site.text(f))
        for t in templates + strings:
            for m in re.finditer(r"<a\b[^>]*>", t):
                tag = m.group(0)
                if re.search(r"""target\s*=\s*["']?_blank""", tag):
                    n += 1
                    r = re.search(r"""rel\s*=\s*["']([^"']*)["']""", tag)
                    if not r or not need <= set(r.group(1).lower().split()):
                        rep.error(f"{f}: a link built in code opens a new tab without rel=\"noopener noreferrer\": {tag[:90]}")
        code = lex_js(site.text(f))[0]
        for m in re.finditer(r"window\.open\(", code):
            seg = code[m.start():m.start() + 200]
            if "noopener" not in seg:
                rep.error(f"{f}: window.open without noopener")
        if re.search(r"""setAttribute\(\s*['"]target['"]\s*,\s*['"]_blank['"]""", code) and "noreferrer" not in code:
            rep.error(f"{f}: sets target=_blank in code without noopener noreferrer")
    rep.note(f"{n} new-tab links carry noopener noreferrer")


def match_cap(rel):
    for pat, kb in CAPS_KB.items():
        if fnmatch.fnmatch(rel, pat):
            return kb
    return DEFAULT_CAP_KB


def check_budget(cx):
    rep, site = cx.rep, cx.site
    rep.begin("budget")
    for f in site.files:
        ext = os.path.splitext(f)[1]
        if f.startswith("data/") and ext in (".csv", ".md"):
            continue                                    # never fetched by the page
        kb = site.gz_kb(f)
        cap = match_cap(f)
        if kb > cap:
            rep.error(f"{f}: {kb:.1f} KB gzip is over its cap of {cap} KB")
    # first load: html + the stylesheets it links + the modules and classic scripts it runs + the data it fetches + fonts
    js = css = html = data = fonts = 0.0
    if cx.index:
        html = site.gz_kb("index.html")
        css_files, js_files, font_files = [], set(), []
        for a, _ in cx.index.find("link"):
            rel = set((a.get("rel") or "").lower().split())
            t = norm("", a.get("href", "")) if kind_of(a.get("href", "")) == "local" else None
            if "stylesheet" in rel and t and site.exists(t):
                css_files.append(t)
        seen = set()
        while css_files:
            c = css_files.pop()
            if c in seen:
                continue
            seen.add(c)
            css += site.gz_kb(c)
            for u in css_refs(site.text(c)):
                t = norm(posixpath.dirname(c), urlsplit(u).path) if kind_of(u) == "local" else None
                if t and site.exists(t):
                    if t.endswith(".css"):
                        css_files.append(t)
                    elif t.endswith(".woff2"):
                        font_files.append(t)
        # the fonts the page actually requests are those with a preload plus those a rule uses; report all woff2 that fonts.css names as the upper bound
        for a, _ in cx.index.find("script"):
            if a.get("src") and kind_of(a["src"]) == "local" and a.get("type") != "module":
                t = norm("", a["src"])
                if t and site.exists(t):
                    js_files.add(t)
        core, gl = expected_preloads(cx)       # a browser with WebGL downloads both halves, so the budget counts both
        js_files.update(f for f in core + gl if site.exists(f))
        js = sum(site.gz_kb(f) for f in js_files)
        data = sum(site.gz_kb(f) for f in data_fetches(cx) if site.exists(f))
        fonts = sum(site.gz_kb(f) for f in set(font_files))
    rep.facts.update({"js_kb": js, "css_kb": css, "html_kb": html, "data_kb": data, "fonts_kb": fonts})
    for k, v in (("js", js), ("css", css), ("html", html), ("data", data)):
        if v > FIRST_LOAD_KB[k]:
            rep.error(f"first-load {k.upper()} is {v:.1f} KB gzip, budget {FIRST_LOAD_KB[k]} KB")
    non_fonts = js + css + html + data
    if non_fonts > FIRST_LOAD_KB["non_fonts"]:
        rep.error(f"first load without fonts is {non_fonts:.1f} KB gzip, budget {FIRST_LOAD_KB['non_fonts']} KB")
    if non_fonts + fonts > TARGET_TOTAL_KB:
        rep.warn(f"first load including fonts is {non_fonts + fonts:.0f} KB gzip, above the {TARGET_TOTAL_KB} KB target "
                 f"(fonts {fonts:.0f} KB are woff2 and do not compress further)")
    raw = sum(os.path.getsize(site.path(f)) for f in site.files) / 2 ** 20
    if raw > SITE_RAW_MB:
        rep.error(f"the site folder is {raw:.1f} MB, over {SITE_RAW_MB} MB")
    rep.note(f"first load gzip: JS {js:.0f} + CSS {css:.0f} + HTML {html:.0f} + data {data:.0f} = {non_fonts:.0f} KB, fonts <= {fonts:.0f} KB; site {raw:.1f} MB")


CHECKS = (check_links, check_third_party, check_vendor, check_csp, check_importmap, check_preload, check_json, check_data, check_rel, check_budget)


def run(site_dir):
    """Run every check on a site folder. Returns the Report."""
    rep = Report()
    site = Site(site_dir)
    rep.begin("site")
    if not site.exists("index.html"):
        rep.error(f"{site_dir}: no index.html")
        rep.note("")
        return rep
    rep.note(f"{len(site.files)} files")
    cx = Ctx(site, rep)
    for fn in CHECKS:
        fn(cx)
    return rep


def write_preload(site_dir):
    """Rewrite the preload block of index.html. Returns True when the file changed."""
    site = Site(site_dir)
    rep = Report()
    rep.begin("preload")
    cx = Ctx(site, rep)
    text = site.text("index.html")
    m = preload_block(text)
    if not m:
        raise SystemExit("index.html has no <!-- preload:start --> ... <!-- preload:end --> block")
    start = text.index("<!-- preload:start")
    end = text.index("<!-- preload:end -->") + len("<!-- preload:end -->")
    new = text[:start] + render_preload_block(cx) + text[end:]
    if new == text:
        return False
    with open(site.path("index.html"), "w", encoding="utf-8", newline="") as f:
        f.write(new)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--site", default=os.path.join(os.path.dirname(here), "site"))
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    ap.add_argument("--write-preload", action="store_true", help="rewrite the preload block of index.html from the import graph, then check")
    a = ap.parse_args(argv)
    if not os.path.isdir(a.site):
        print(f"check_site: {a.site} is not a folder", file=sys.stderr)
        return 2
    if a.write_preload:
        changed = write_preload(a.site)
        print(f"check_site: preload block {'rewritten' if changed else 'already up to date'}")
    rep = run(a.site)
    if a.json:
        print(json.dumps({"errors": rep.errors, "warnings": rep.warnings, "checks": rep.checks, "facts": rep.facts}, indent=1))
    else:
        print(rep.text(os.path.relpath(a.site)))
    return 0 if rep.ok(a.strict) else 1


if __name__ == "__main__":
    sys.exit(main())
