"""Unit tests for tools/check_site.py: a tiny valid site is built in a temporary folder, then broken one way at a time.

Run: python3 -m unittest discover -s tests/unit -p 'test_*.py'      (Python 3 standard library only)
"""
import base64
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("check_site", os.path.join(ROOT, "tools", "check_site.py"))
cs = importlib.util.module_from_spec(spec)
sys.modules["check_site"] = cs
spec.loader.exec_module(cs)

IMPORTMAP = '{ "imports": { "three": "./vendor/three/three.module.min.js", "three/addons/": "./vendor/three/addons/" } }'


def csp_hash(text):
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()


def molecule(n=2):
    return {"z": [6] * n, "xyz": [0.0] * (3 * n), "b": [0, 1, 1], "src": "RDKit ETKDG"}


def index_html(importmap=IMPORTMAP, extra_head="", extra_body="", preload=""):
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' '{csp_hash(importmap)}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'">
<title>t</title>
<link rel="canonical" href="https://dhruvmenon2003.github.io/drug-hansch-space/">
<link rel="stylesheet" href="style.css">
{extra_head}<script type="importmap">{importmap}</script>
<!-- preload:start -->
{preload}<!-- preload:end -->
</head><body>
<a href="#main">skip</a> <main id="main"><span id="m-count">2</span> drugs <a href="https://example.org/x" target="_blank" rel="noopener noreferrer">out</a></main>
{extra_body}<script type="module" src="js/main.js"></script>
</body></html>
"""


def base_files():
    drugs = {"meta": {"n_drugs": 2, "generated_utc": "x"}, "drugs": [{"cid": 1, "name": "a", "conf": "RDKit", "smiles": "C"}, {"cid": 2, "name": "b", "conf": "", "smiles": "CC"}]}
    hansch = {"groups": [{"id": "ALL", "n": 1, "points": [{"cid": 1}]}]}
    return {
        "js/main.js": "import { a } from './a.js';\nimport { APP_BUILD } from './version.js';\nimport('./b.js').then(() => a + APP_BUILD);\n",
        "js/a.js": "export const a = 1;\n",
        "js/b.js": "import * as T from 'three';\nimport { O } from 'three/addons/o.js';\nexport const b = [T, O];\n",
        "js/version.js": "export const APP_BUILD = 'dev';\n",
        "js/data.js": ("export const MOL_SHARDS = 2;\n"
                       "export const load = () => Promise.all(['data/drugs.json', 'data/hansch.json'].map(u => fetch(u)));\n"
                       "export const shard = n => fetch(`data/mol/${n}.json`);\n"),
        "vendor/three/three.module.min.js": "export const REVISION = 1;\n",
        "vendor/three/addons/o.js": "import 'three';\nexport const O = 1;\n",
        "vendor/three/LICENSE": "MIT\n",
        "style.css": "body { color: #000 }\n",
        "data/drugs.json": json.dumps(drugs),
        "data/hansch.json": json.dumps(hansch),
        "data/mol/0.json": "{}",
        "data/mol/1.json": json.dumps({"1": molecule()}),
        "data/mol/index.json": json.dumps({"v": 1, "shards": 2, "count": 1, "files": {"0": {"n": 0}, "1": {"n": 1}}}),
        "404.html": '<!doctype html><title>x</title><a href="https://dhruvmenon2003.github.io/drug-hansch-space/">home</a>',
        "index.html": "",                                   # written last, from the import graph
    }


class Fixture(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="check_site_")
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        for rel, text in base_files().items():
            self.write(rel, text)
        self.write("index.html", index_html())
        cs.write_preload(self.dir)

    def write(self, rel, text):
        p = os.path.join(self.dir, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb" if isinstance(text, bytes) else "w", **({} if isinstance(text, bytes) else {"encoding": "utf-8"})) as f:
            f.write(text)

    def read(self, rel):
        with open(os.path.join(self.dir, *rel.split("/")), encoding="utf-8") as f:
            return f.read()

    def edit(self, rel, old, new, count=1):
        t = self.read(rel)
        self.assertIn(old, t, f"fixture: {old!r} not in {rel}")
        self.write(rel, t.replace(old, new, count))

    def run_check(self):
        return cs.run(self.dir)

    def assertFails(self, check, needle, rep=None):
        rep = rep or self.run_check()
        msgs = [m for c, m in rep.errors if c == check]
        self.assertTrue(any(needle in m for m in msgs), f"expected a {check!r} error containing {needle!r}; got errors: {rep.errors}")
        return rep

    def assertClean(self, rep=None):
        rep = rep or self.run_check()
        self.assertEqual(rep.errors, [], f"unexpected errors: {rep.errors}")
        return rep


class Baseline(Fixture):
    def test_the_fixture_is_clean(self):
        rep = self.assertClean()
        self.assertEqual([c["name"] for c in rep.checks][:2], ["site", "links"])
        self.assertTrue(any(c["name"] == "preload" for c in rep.checks))

    def test_cli_exit_codes_and_report(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(cs.main(["--site", self.dir]), 0)
        self.assertIn("0 error(s)", out.getvalue())
        self.edit("index.html", 'href="style.css"', 'href="nope.css"')
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(cs.main(["--site", self.dir]), 1)
        self.assertIn("FAIL", out.getvalue())
        self.assertIn("nope.css", out.getvalue())
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cs.main(["--site", os.path.join(self.dir, "missing")]), 2)

    def test_json_report(self):
        out = io.StringIO()
        with redirect_stdout(out):
            cs.main(["--site", self.dir, "--json"])
        data = json.loads(out.getvalue())
        self.assertEqual(data["errors"], [])
        self.assertIn("js_kb", data["facts"])

    def test_warnings_fail_only_under_strict(self):
        self.edit("index.html", "<title>t</title>", '<title>t</title><meta property="og:image" content="https://dhruvmenon2003.github.io/drug-hansch-space/assets/og.png">')
        rep = self.run_check()
        self.assertEqual(rep.errors, [])
        self.assertTrue(rep.warnings)
        self.assertTrue(rep.ok(strict=False))
        self.assertFalse(rep.ok(strict=True))


class Links(Fixture):
    def test_missing_stylesheet(self):
        self.edit("index.html", 'href="style.css"', 'href="gone.css"')
        self.assertFails("links", "gone.css")

    def test_missing_image_and_script(self):
        self.edit("index.html", "</main>", '<img src="img/x.png"></main>')
        self.assertFails("links", "img/x.png")

    def test_dangling_in_page_anchor(self):
        self.edit("index.html", 'href="#main"', 'href="#nowhere"')
        self.assertFails("links", "#nowhere")

    def test_css_url_that_does_not_exist(self):
        self.write("style.css", "body { background: url(img/bg.png) }\n")
        self.assertFails("links", "img/bg.png")

    def test_css_url_that_exists_and_data_urls_are_fine(self):
        self.write("img/bg.png", b"\x89PNG")
        self.write("style.css", "body { background: url(img/bg.png) } i { background: url(data:image/png;base64,AAAA) }\n")
        self.assertClean()

    def test_js_import_of_a_missing_file(self):
        self.edit("js/a.js", "export const a = 1;", "import './ghost.js';\nexport const a = 1;")
        rep = self.run_check()
        self.assertFails("links", "ghost.js", rep)

    def test_js_fetch_of_a_missing_file(self):
        self.edit("js/data.js", "export const MOL_SHARDS = 2;", "export const MOL_SHARDS = 2;\nexport const x = () => fetch('data/missing.json');")
        self.assertFails("links", "data/missing.json")

    def test_template_path_that_matches_nothing(self):
        self.edit("js/data.js", "export const MOL_SHARDS = 2;", "export const MOL_SHARDS = 2;\nexport const y = n => fetch(`data/nothing/${n}.json`);")
        self.assertFails("links", "matches no file")

    def test_bare_import_that_is_not_in_the_import_map(self):
        self.edit("js/a.js", "export const a = 1;", "import 'lodash';\nexport const a = 1;")
        self.assertFails("links", "lodash")

    def test_commented_out_import_is_ignored(self):
        self.edit("js/a.js", "export const a = 1;", "// import './ghost.js';\n/* import './ghost2.js'; */\nexport const a = 1; const re = /import '.\\/x.js'/;")
        self.assertClean()

    def test_manifest_icon_must_exist(self):
        self.write("manifest.webmanifest", json.dumps({"icons": [{"src": "assets/icon.png"}], "start_url": "./"}))
        self.assertFails("links", "assets/icon.png")

    def test_404_page_must_use_absolute_links(self):
        self.write("404.html", '<!doctype html><a href="index.html">home</a><link rel="icon" href="assets/f.svg">')
        rep = self.run_check()
        self.assertFails("links", "relative link", rep)


class ThirdParty(Fixture):
    def test_external_script(self):
        self.edit("index.html", "<title>t</title>", '<title>t</title><script src="https://cdn.example.com/x.js"></script>')
        self.assertFails("third-party", "cdn.example.com")

    def test_external_stylesheet_font_and_image(self):
        self.edit("index.html", "<title>t</title>", '<title>t</title><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X"><link rel="preconnect" href="https://fonts.gstatic.com">')
        rep = self.run_check()
        self.assertFails("third-party", "fonts.googleapis.com", rep)
        self.assertFails("preload", "resource hint to another origin", rep)

    def test_external_hyperlink_is_fine(self):
        self.edit("index.html", "</main>", '<a href="https://pubchem.ncbi.nlm.nih.gov/x" target="_blank" rel="noopener noreferrer">p</a></main>')
        self.assertClean()

    def test_css_import_of_a_remote_stylesheet(self):
        self.write("style.css", "@import url('https://example.net/a.css');\n")
        self.assertFails("third-party", "example.net")

    def test_js_fetch_from_another_origin(self):
        self.edit("js/a.js", "export const a = 1;", "export const a = fetch('https://api.example.com/x');")
        self.assertFails("third-party", "another origin")

    def test_js_url_that_is_not_a_hyperlink(self):
        self.edit("js/a.js", "export const a = 1;", "export const a = 'https://tracker.example.com/pixel.gif';")
        self.assertFails("third-party", "tracker.example.com")

    def test_js_hyperlink_template_to_a_link_out_host_is_fine(self):
        self.edit("js/a.js", "export const a = 1;", 'export const link = id => `<a href="https://www.ebi.ac.uk/chembl/${id}" target="_blank" rel="noopener noreferrer">x</a>`; export const a = 1;')
        self.assertClean()

    def test_xml_namespace_is_fine(self):
        self.edit("js/a.js", "export const a = 1;", "export const svg = () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'); export const a = 1;")
        self.assertClean()

    def test_cdn_host_anywhere(self):
        self.write("data/provenance.csv", "cdn.jsdelivr.net\n")
        self.assertFails("third-party", "cdn.jsdelivr.net")

    def test_vendored_file_mentioning_a_cdn_is_a_warning(self):
        self.edit("vendor/three/three.module.min.js", "export const", "// loads from cdn.jsdelivr.net\nexport const")
        rep = self.run_check()
        self.assertEqual(rep.errors, [])
        self.assertTrue(any("cdn.jsdelivr.net" in m for _, m in rep.warnings))

    def test_csp_with_a_remote_source(self):
        self.edit("index.html", "connect-src 'self'", "connect-src 'self' https://api.example.com")
        self.assertFails("third-party", "api.example.com")


class Csp(Fixture):
    def test_hash_mismatch_after_the_import_map_changed(self):
        self.edit("index.html", '"three": "./vendor/three/three.module.min.js",', '"three": "./vendor/three/three.module.min.js" ,')
        self.assertFails("csp", "no hash of the inline import map")

    def test_stale_extra_hash(self):
        self.edit("index.html", "script-src 'self'", "script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='")
        self.assertFails("csp", "matches no inline script")

    def test_inline_script_is_blocked_by_the_policy(self):
        self.edit("index.html", "</main>", "</main><script>alert(1)</script>")
        self.assertFails("csp", "inline <script>")

    def test_inline_event_handler(self):
        self.edit("index.html", '<main id="main">', '<main id="main" onclick="x()">')
        self.assertFails("csp", "inline event handler")

    def test_unsafe_eval(self):
        self.edit("index.html", "script-src 'self'", "script-src 'self' 'unsafe-eval'")
        self.assertFails("csp", "unsafe-eval")

    def test_missing_policy(self):
        t = self.read("index.html")
        self.write("index.html", re.sub(r"<meta http-equiv=\"Content-Security-Policy\"[^>]*>", "", t))
        self.assertFails("csp", "no Content-Security-Policy")


class ImportMap(Fixture):
    def test_entry_pointing_nowhere(self):
        im = IMPORTMAP.replace("three.module.min.js", "three.gone.js")
        self.write("index.html", index_html(importmap=im))
        cs.write_preload(self.dir)
        rep = self.run_check()
        self.assertFails("importmap", "three.gone.js", rep)

    def test_prefix_entry_needs_a_folder(self):
        im = IMPORTMAP.replace('"./vendor/three/addons/"', '"./vendor/three/addons"')
        self.write("index.html", index_html(importmap=im))
        cs.write_preload(self.dir)
        self.assertFails("importmap", "must map to a folder ending in '/'")


class Preload(Fixture):
    def test_missing_modulepreload(self):
        self.edit("index.html", '<link rel="modulepreload" href="js/b.js">\n', "")
        self.assertFails("preload", "modulepreload missing for js/b.js")

    def test_extra_modulepreload(self):
        self.write("js/orphan.js", "export const o = 1;\n")
        self.edit("index.html", "<!-- preload:end -->", '<link rel="modulepreload" href="js/orphan.js">\n<!-- preload:end -->')
        self.assertFails("preload", "js/orphan.js, which js/main.js does not import")

    def test_addon_and_bare_import_are_part_of_the_graph(self):
        self.assertIn('href="vendor/three/addons/o.js"', self.read("index.html"))
        self.assertIn('href="vendor/three/three.module.min.js"', self.read("index.html"))

    def test_data_preload_attributes(self):
        self.edit("index.html", ' crossorigin fetchpriority="low">\n<link rel="preload" href="data/hansch.json"', ' fetchpriority="low">\n<link rel="preload" href="data/hansch.json"')
        self.assertFails("preload", "as=\"fetch\" crossorigin fetchpriority=\"low\"")

    def test_data_file_fetched_but_not_preloaded(self):
        self.edit("index.html", '<link rel="preload" href="data/hansch.json" as="fetch" type="application/json" crossorigin fetchpriority="low">\n', "")
        self.assertFails("preload", "data/hansch.json is fetched at boot")

    def test_font_preload_needs_crossorigin(self):
        self.write("vendor/f.woff2", b"wOF2")
        self.edit("index.html", "<title>t</title>", '<title>t</title><link rel="preload" href="vendor/f.woff2" as="font" type="font/woff2">')
        self.edit("style.css", "body", "@font-face { font-family: F; src: url(vendor/f.woff2) } body")
        self.assertFails("preload", "font preload must carry")

    def test_no_block_at_all(self):
        self.write("index.html", self.read("index.html").replace("<!-- preload:start -->", "").replace("<!-- preload:end -->", ""))
        self.assertFails("preload", "no <!-- preload:start -->")

    def test_write_preload_is_idempotent_and_repairs(self):
        before = self.read("index.html")
        self.assertFalse(cs.write_preload(self.dir), "already up to date")
        self.assertEqual(before, self.read("index.html"))
        self.edit("index.html", '<link rel="modulepreload" href="js/a.js">\n', "")
        self.assertTrue(cs.write_preload(self.dir))
        self.assertEqual(before, self.read("index.html"))
        self.assertClean()

    def test_a_new_module_changes_the_expected_list(self):
        self.edit("js/a.js", "export const a = 1;", "import './c.js';\nexport const a = 1;")
        self.write("js/c.js", "export const c = 1;\n")
        self.assertFails("preload", "modulepreload missing for js/c.js")


class Vendor(Fixture):
    def test_unreferenced_vendored_file(self):
        self.write("vendor/extra/lib.js", "export const x = 1;\n")
        self.assertFails("vendor", "vendor/extra/lib.js is vendored but nothing references it")

    def test_unreferenced_addon(self):
        self.write("vendor/three/addons/unused.js", "export const u = 1;\n")
        self.assertFails("vendor", "vendor/three/addons/unused.js")

    def test_notices_need_no_reference(self):
        self.write("vendor/three/NOTICE.txt", "x\n")
        self.write("vendor/three/README.md", "x\n")
        self.assertClean()

    def test_font_referenced_from_css_counts(self):
        self.write("vendor/fonts/a.woff2", b"wOF2")
        self.write("vendor/fonts/fonts.css", "@font-face { font-family: A; src: url(a.woff2) }\n")
        self.edit("index.html", 'href="style.css">', 'href="style.css"><link rel="stylesheet" href="vendor/fonts/fonts.css">')
        self.assertClean()

    def test_library_loaded_by_a_script_element_in_code(self):
        self.write("vendor/lazy/lazy.min.js", "var Lazy = 1;\n")
        self.assertFails("vendor", "vendor/lazy/lazy.min.js")
        self.edit("js/a.js", "export const a = 1;", "export const src = 'vendor/lazy/lazy.min.js';\nexport const a = 1;")
        self.assertClean()


class Json(Fixture):
    def test_invalid_json(self):
        self.write("data/hansch.json", '{"groups": [')
        self.assertFails("json", "data/hansch.json")

    def test_invalid_manifest(self):
        self.write("manifest.webmanifest", "{nope")
        self.assertFails("json", "manifest.webmanifest")


class Data(Fixture):
    def drugs(self):
        return json.loads(self.read("data/drugs.json"))

    def test_published_full_table(self):
        self.write("data/molecules.json", "{}")
        self.assertFails("data", "data/molecules.json")

    def test_drug_count_in_meta(self):
        d = self.drugs(); d["meta"]["n_drugs"] = 5
        self.write("data/drugs.json", json.dumps(d))
        self.assertFails("data", "n_drugs 5 != 2")

    def test_static_count_in_the_page(self):
        self.edit("index.html", 'id="m-count">2<', 'id="m-count">759<')
        self.assertFails("data", "says 759 drugs")

    def test_shard_count_differs_from_the_code(self):
        self.edit("js/data.js", "MOL_SHARDS = 2", "MOL_SHARDS = 32")
        self.assertFails("data", "shard count differs")

    def test_molecule_in_the_wrong_shard(self):
        self.write("data/mol/0.json", json.dumps({"1": molecule()}))
        self.assertFails("data", "does not belong in shard 0")

    def test_missing_shard_file(self):
        os.remove(os.path.join(self.dir, "data", "mol", "1.json"))
        self.assertFails("data", "data/mol/1.json is missing")

    def test_drug_with_conformer_but_no_molecule(self):
        d = self.drugs(); d["drugs"][1]["conf"] = "RDKit"
        self.write("data/drugs.json", json.dumps(d))
        self.assertFails("data", "have no molecule in the shards")

    def test_molecule_for_a_drug_without_conf(self):
        d = self.drugs(); d["drugs"][0]["conf"] = ""
        self.write("data/drugs.json", json.dumps(d))
        self.assertFails("data", "belong to drugs without `conf`")

    def test_malformed_molecule(self):
        m = molecule(); m["xyz"] = [0.0]
        self.write("data/mol/1.json", json.dumps({"1": m}))
        self.assertFails("data", "coordinates for")

    def test_hansch_point_that_is_not_a_drug(self):
        h = json.loads(self.read("data/hansch.json")); h["groups"][0]["points"].append({"cid": 99}); h["groups"][0]["n"] = 2
        self.write("data/hansch.json", json.dumps(h))
        self.assertFails("data", "are not drugs")

    def test_build_stamps_must_agree(self):
        self.edit("js/version.js", "'dev'", "'abc123'")
        self.assertFails("data", "build stamps disagree")
        d = self.drugs(); d["meta"]["app_build"] = "abc123"
        self.write("data/drugs.json", json.dumps(d))
        self.assertClean()
        d["meta"]["app_build"] = "other"
        self.write("data/drugs.json", json.dumps(d))
        self.assertFails("data", "build stamps disagree")

    def test_stamped_data_with_a_dev_build(self):
        d = self.drugs(); d["meta"]["app_build"] = "abc123"
        self.write("data/drugs.json", json.dumps(d))
        self.assertFails("data", "build stamps disagree")


class LinksRel(Fixture):
    def test_html_link_without_noreferrer(self):
        self.edit("index.html", 'target="_blank" rel="noopener noreferrer"', 'target="_blank" rel="noopener"')
        self.assertFails("links-rel", "noopener noreferrer")

    def test_html_link_without_rel(self):
        self.edit("index.html", 'target="_blank" rel="noopener noreferrer"', 'target="_blank"')
        self.assertFails("links-rel", "target=_blank")

    def test_js_built_link_without_noreferrer(self):
        self.edit("js/a.js", "export const a = 1;", "export const l = u => `<a href=\"${u}\" target=\"_blank\" rel=\"noopener\">x</a>`; export const a = 1;")
        self.assertFails("links-rel", "built in code")

    def test_js_built_link_with_both(self):
        self.edit("js/a.js", "export const a = 1;", "export const l = u => `<a href=\"${u}\" target=\"_blank\" rel=\"noopener noreferrer\">x</a>`; export const a = 1;")
        self.assertClean()

    def test_window_open_needs_noopener(self):
        self.edit("js/a.js", "export const a = 1;", "export const o = () => window.open('x');\nexport const a = 1;")
        self.assertFails("links-rel", "window.open")


class Budget(Fixture):
    def test_per_file_cap(self):
        self.write("assets/big.png", os.urandom(200 * 1024))
        self.assertFails("budget", "assets/big.png")

    def test_first_load_js_budget(self):
        self.write("vendor/three/three.module.min.js", "export const REVISION = '" + base64.b64encode(os.urandom(320 * 1024)).decode() + "';\n")
        rep = self.run_check()
        self.assertTrue(any("first-load JS" in m or "three.module.min.js" in m for c, m in rep.errors), rep.errors)

    def test_first_load_data_budget(self):
        d = {"meta": {"n_drugs": 2}, "drugs": [{"cid": 1, "conf": "RDKit", "pad": base64.b64encode(os.urandom(190 * 1024)).decode()}, {"cid": 2, "conf": ""}]}
        self.write("data/drugs.json", json.dumps(d))
        rep = self.run_check()
        self.assertTrue(any(c == "budget" and "DATA" in m for c, m in rep.errors), rep.errors)

    def test_fonts_over_the_aim_is_a_warning_not_an_error(self):
        self.write("vendor/fonts/a.woff2", os.urandom(130 * 1024))
        self.write("vendor/fonts/b.woff2", os.urandom(130 * 1024))
        self.write("vendor/fonts/c.woff2", os.urandom(130 * 1024))
        self.write("vendor/fonts/d.woff2", os.urandom(130 * 1024))
        self.write("vendor/fonts/fonts.css", "@font-face{font-family:A;src:url(a.woff2)} @font-face{font-family:B;src:url(b.woff2)} @font-face{font-family:C;src:url(c.woff2)} @font-face{font-family:D;src:url(d.woff2)}\n")
        self.edit("index.html", 'href="style.css">', 'href="style.css"><link rel="stylesheet" href="vendor/fonts/fonts.css">')
        rep = self.run_check()
        self.assertEqual(rep.errors, [])
        self.assertTrue(any("including fonts" in m for _, m in rep.warnings))


class Lexer(unittest.TestCase):
    def test_comments_strings_templates_and_regex(self):
        src = (
            "// import 'a.js'\n"
            "/* import 'b.js' */\n"
            "import x from './x.js';\n"
            "const re = /['\"]/g, s = \"it's\", t = `a ${ `inner ${1}` + 'q' } b`;\n"
            "const d = a / b / c;\n"
            "const u = import('./late.js');\n"
        )
        code, strings, templates = cs.lex_js(src)
        self.assertNotIn("a.js", code)
        self.assertNotIn("b.js", code)
        specs = [s for s, _ in cs.js_imports("js/t.js", src)]
        self.assertEqual(sorted(specs), ["./late.js", "./x.js"])
        self.assertIn("it's", strings)
        self.assertIn("q", strings)
        self.assertTrue(any("inner" in t for t in templates))

    def test_division_is_not_a_regex(self):
        code, strings, _ = cs.lex_js("const r = (a + b) / 2; const s = 'x / y';\nconst w = 10 / 5;\n")
        self.assertIn("'x / y'", code)
        self.assertEqual(strings, ["x / y"])


class RealSite(unittest.TestCase):
    def test_the_real_site_passes(self):
        rep = cs.run(os.path.join(ROOT, "site"))
        self.assertEqual(rep.errors, [], "\n" + rep.text("site"))


if __name__ == "__main__":
    unittest.main()
