"""Unit tests for tools/stamp_build.py: one build id into js/version.js and data/drugs.json, idempotent, reversible, checkable.

Run: python3 -m unittest discover -s tests/unit -p 'test_*.py'      (Python 3 standard library only)
"""
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("stamp_build", os.path.join(ROOT, "tools", "stamp_build.py"))
sb = importlib.util.module_from_spec(spec)
sys.modules["stamp_build"] = sb
spec.loader.exec_module(sb)

VERSION_JS = """// Layer 0. comment that mentions APP_BUILD = 'something' in prose
export const APP_BUILD = 'dev';

export function buildMismatch(a, b) { return a !== b; }
"""
DRUGS = {"meta": {"generated_utc": "2026-01-01T00:00:00Z", "n_drugs": 2, "note": "has \"quotes\" and 'apostrophes'"}, "drugs": [{"cid": 1, "name": "a"}, {"cid": 2, "name": "b"}]}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="stamp_")
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        os.makedirs(os.path.join(self.dir, "js"))
        os.makedirs(os.path.join(self.dir, "data"))
        self.v = os.path.join(self.dir, "js", "version.js")
        self.d = os.path.join(self.dir, "data", "drugs.json")
        self.write(self.v, VERSION_JS)
        self.write(self.d, json.dumps(DRUGS, separators=(",", ":")))

    def write(self, path, text):
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)

    def read(self, path):
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()

    def run_main(self, *args, env=None):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err), mock.patch.dict(os.environ, env or {}, clear=False):
            try:
                code = sb.main(["--site", self.dir, *args])
            except SystemExit as e:                  # argparse usage errors
                code = e.code
        return code, out.getvalue(), err.getvalue()


class Text(unittest.TestCase):
    def test_version_js_only_the_line_changes(self):
        out = sb.stamp_version_js(VERSION_JS, "3f9c2ab71d04")
        self.assertIn("export const APP_BUILD = '3f9c2ab71d04';", out)
        self.assertEqual(out.replace("3f9c2ab71d04", "dev"), VERSION_JS)
        self.assertEqual(sb.read_version_js(out), "3f9c2ab71d04")

    def test_version_js_needs_exactly_one_line(self):
        for bad in ("export const OTHER = 1;\n", VERSION_JS + VERSION_JS, "const APP_BUILD = 'dev';\n"):
            with self.assertRaises(ValueError):
                sb.stamp_version_js(bad, "x")

    def test_data_stamp_added_and_removed(self):
        text = json.dumps(DRUGS, separators=(",", ":"))
        stamped = sb.stamp_data(text, "abc123")
        self.assertEqual(json.loads(stamped)["meta"]["app_build"], "abc123")
        self.assertEqual(sb.read_data_stamp(stamped), "abc123")
        obj = json.loads(stamped)
        del obj["meta"]["app_build"]
        self.assertEqual(obj, DRUGS, "nothing but the stamp changed")
        self.assertEqual(sb.stamp_data(stamped, None), text, "removing the stamp restores the original bytes")

    def test_data_stamp_replaces_an_older_one(self):
        once = sb.stamp_data(json.dumps(DRUGS, separators=(",", ":")), "first")
        twice = sb.stamp_data(once, "second")
        self.assertEqual(twice.count("app_build"), 1)
        self.assertEqual(json.loads(twice)["meta"]["app_build"], "second")

    def test_data_layout_is_checked(self):
        with self.assertRaises(ValueError):
            sb.stamp_data('{ "drugs": [], "meta": {} }', "x")


class Cli(Fixture):
    def test_stamp_writes_both_and_check_agrees(self):
        code, out, err = self.run_main("--build", "3f9c2ab71d04")
        self.assertEqual(code, 0, err)
        self.assertEqual(sb.read_version_js(self.read(self.v)), "3f9c2ab71d04")
        self.assertEqual(json.loads(self.read(self.d))["meta"]["app_build"], "3f9c2ab71d04")
        code, out, _ = self.run_main("--check")
        self.assertEqual(code, 0)
        self.assertIn("consistent", out)

    def test_idempotent(self):
        self.run_main("--build", "abc")
        first = (self.read(self.v), self.read(self.d))
        code, out, _ = self.run_main("--build", "abc")
        self.assertEqual(code, 0)
        self.assertIn("version.js unchanged, drugs.json unchanged", out)
        self.assertEqual((self.read(self.v), self.read(self.d)), first)

    def test_dev_restores_the_committed_state_exactly(self):
        original = (self.read(self.v), self.read(self.d))
        self.run_main("--build", "abc")
        self.assertNotEqual((self.read(self.v), self.read(self.d)), original)
        code, _, _ = self.run_main("--dev")
        self.assertEqual(code, 0)
        self.assertEqual((self.read(self.v), self.read(self.d)), original)
        self.assertEqual(self.run_main("--check")[0], 0, "unstamped on both sides is consistent")

    def test_check_detects_a_mismatch(self):
        self.run_main("--build", "abc")
        self.write(self.d, sb.stamp_data(self.read(self.d), "different"))
        code, out, _ = self.run_main("--check")
        self.assertEqual(code, 1)
        self.assertIn("MISMATCH", out)
        self.run_main("--dev")
        self.write(self.d, sb.stamp_data(self.read(self.d), "only-data"))
        self.assertEqual(self.run_main("--check")[0], 1, "dev code with stamped data is a mismatch")

    def test_id_from_the_environment(self):
        code, out, _ = self.run_main(env={"GITHUB_SHA": "0123456789abcdef0123456789abcdef01234567", "BUILD_ID": ""})
        self.assertEqual(code, 0)
        self.assertEqual(sb.read_version_js(self.read(self.v)), "0123456789ab", "first 12 characters of GITHUB_SHA")
        code, _, _ = self.run_main(env={"GITHUB_SHA": "", "BUILD_ID": "run-77"})
        self.assertEqual(sb.read_version_js(self.read(self.v)), "run-77")

    def test_no_id_is_a_usage_error(self):
        with mock.patch.dict(os.environ, {"GITHUB_SHA": "", "BUILD_ID": ""}):
            code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertEqual(sb.read_version_js(self.read(self.v)), "dev", "nothing was written")

    def test_bad_ids_are_refused_and_nothing_is_written(self):
        original = (self.read(self.v), self.read(self.d))
        for bad in ("dev", "has space", "quo'te", "a" * 41, "semi;colon", "../x"):
            code, _, err = self.run_main("--build", bad)
            self.assertEqual(code, 2, bad)
            self.assertEqual((self.read(self.v), self.read(self.d)), original, bad)

    def test_a_broken_site_gives_a_readable_error(self):
        os.remove(self.d)
        code, _, err = self.run_main("--build", "abc")
        self.assertEqual(code, 2)
        self.assertIn("stamp_build:", err)


class RealSite(unittest.TestCase):
    def test_the_committed_site_is_unstamped_and_consistent(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = sb.main(["--check"])
        self.assertEqual(code, 0, out.getvalue())
        self.assertIn("APP_BUILD='dev'", out.getvalue())


if __name__ == "__main__":
    unittest.main()
