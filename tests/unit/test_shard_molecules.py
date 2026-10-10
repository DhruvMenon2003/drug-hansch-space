"""Unit tests for tools/shard_molecules.py: the split is by cid % shards, deterministic, idempotent, and --check tells the truth.

Run: python3 -m unittest discover -s tests/unit -p 'test_*.py'      (Python 3 standard library only)
"""
import hashlib
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("shard_molecules", os.path.join(ROOT, "tools", "shard_molecules.py"))
sm = importlib.util.module_from_spec(spec)
sys.modules["shard_molecules"] = sm
spec.loader.exec_module(sm)


def mol(n):
    return {"z": [6] * n, "xyz": [0.5] * (3 * n), "b": [0, 1, 1], "src": "RDKit ETKDG"}


# CIDs chosen so several share a shard and two are far apart; 5352062 is a real, large CID of the dataset.
TABLE = {str(c): mol(2 + c % 3) for c in (1, 2, 33, 34, 65, 5479, 71384, 5352062, 25151504, 9868491)}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shard_")
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.src = os.path.join(self.dir, "molecules.json")
        self.out = os.path.join(self.dir, "mol")
        with open(self.src, "w", encoding="utf-8") as f:
            json.dump(TABLE, f, separators=(",", ":"))

    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = sm.main(["--src", self.src, "--out", self.out, *args])
        return code, out.getvalue(), err.getvalue()

    def read(self, name):
        with open(os.path.join(self.out, name), "rb") as f:
            return f.read()

    def snapshot(self):
        return {n: self.read(n) for n in sorted(os.listdir(self.out))}


class Split(unittest.TestCase):
    def test_every_molecule_lands_in_cid_mod_shards(self):
        parts = sm.split(TABLE, 32)
        self.assertEqual(len(parts), 32)
        for i, p in enumerate(parts):
            for key in p:
                self.assertEqual(int(key) % 32, i)
        self.assertEqual(sum(len(p) for p in parts), len(TABLE))
        merged = {k: v for p in parts for k, v in p.items()}
        self.assertEqual(merged, TABLE, "nothing lost, nothing changed")

    def test_ordered_by_numeric_cid_not_by_string(self):
        parts = sm.split({"100": mol(2), "9": mol(2), "41": mol(2)}, 1)
        self.assertEqual(list(parts[0]), ["9", "41", "100"])

    def test_shard_count_is_a_parameter(self):
        for n in (1, 2, 7, 64):
            parts = sm.split(TABLE, n)
            self.assertEqual(len(parts), n)
            self.assertTrue(all(int(k) % n == i for i, p in enumerate(parts) for k in p))

    def test_rejects_bad_sources(self):
        for bad in (b"[]", b"{}", b'{"abc": {}}', b'{"12x": {}}', b'{"-5": {}}'):
            with self.assertRaises(ValueError, msg=bad):
                sm.build(bad, 4)


class Build(unittest.TestCase):
    def test_files_and_index(self):
        src = json.dumps(TABLE).encode()
        files = sm.build(src, 32)
        self.assertEqual(sorted(files), sorted([f"{i}.json" for i in range(32)] + ["index.json"]))
        idx = json.loads(files["index.json"])
        self.assertEqual(idx["shards"], 32)
        self.assertEqual(idx["count"], len(TABLE))
        self.assertEqual(idx["source_sha256"], hashlib.sha256(src).hexdigest())
        for i in range(32):
            shard = json.loads(files[f"{i}.json"])
            self.assertEqual(idx["files"][str(i)], {"n": len(shard), "bytes": len(files[f"{i}.json"])})

    def test_compact_json(self):
        files = sm.build(json.dumps(TABLE).encode(), 4)
        for name, data in files.items():
            text = data.decode("utf-8")
            self.assertNotIn(": ", text, name)
            self.assertNotIn(", ", text, name)
            self.assertTrue(text.endswith("}\n"))

    def test_build_is_pure_and_deterministic(self):
        a = sm.build(json.dumps(TABLE).encode(), 8)
        b = sm.build(json.dumps(dict(reversed(list(TABLE.items())))).encode(), 8)      # same table, other key order in the source
        for n in a:
            if n != "index.json":                     # the index carries the hash of the source bytes, which differ
                self.assertEqual(a[n], b[n], n)


class Cli(Fixture):
    def test_writes_then_is_idempotent(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        first = self.snapshot()
        self.assertEqual(len(first), 33)
        mtimes = {n: os.stat(os.path.join(self.out, n)).st_mtime_ns for n in first}
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("0 file(s) written", out)
        self.assertEqual(self.snapshot(), first)
        self.assertEqual({n: os.stat(os.path.join(self.out, n)).st_mtime_ns for n in first}, mtimes, "unchanged files are not rewritten")

    def test_a_shard_reads_back_as_the_source_entries(self):
        self.run_main()
        for key, m in TABLE.items():
            shard = json.loads(self.read(f"{int(key) % 32}.json"))
            self.assertEqual(shard[key], m)

    def test_check_mode(self):
        code, _, err = self.run_main("--check")
        self.assertEqual(code, 1, "nothing written yet: out of date")
        self.assertFalse(os.path.exists(self.out) and os.listdir(self.out), "--check writes nothing")
        self.run_main()
        code, out, _ = self.run_main("--check")
        self.assertEqual((code, "ok" in out), (0, True))
        with open(os.path.join(self.out, "1.json"), "ab") as f:
            f.write(b" ")
        code, _, err = self.run_main("--check")
        self.assertEqual(code, 1)
        self.assertIn("out of date", err)

    def test_rewrites_only_what_changed_and_removes_stale_shards(self):
        self.run_main("--shards", "32")
        before = self.snapshot()
        TABLE2 = dict(TABLE)
        TABLE2["66"] = mol(5)                       # shard 2
        with open(self.src, "w", encoding="utf-8") as f:
            json.dump(TABLE2, f)
        code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        after = self.snapshot()
        changed = sorted(n for n in after if before.get(n) != after[n])
        self.assertEqual(changed, ["2.json", "index.json"], "one shard and the index")
        code, out, _ = self.run_main("--shards", "8")
        self.assertEqual(code, 0)
        self.assertEqual(sorted(os.listdir(self.out)), sorted([f"{i}.json" for i in range(8)] + ["index.json"]), "shards 8..31 removed")

    def test_foreign_files_in_the_output_folder_survive(self):
        os.makedirs(self.out)
        with open(os.path.join(self.out, "README.txt"), "w") as f:
            f.write("keep")
        self.run_main()
        self.assertTrue(os.path.exists(os.path.join(self.out, "README.txt")))

    def test_errors_are_readable_not_tracebacks(self):
        os.remove(self.src)
        code, _, err = self.run_main()
        self.assertEqual(code, 2)
        self.assertIn("shard_molecules:", err)
        with open(self.src, "w") as f:
            f.write("{not json")
        code, _, err = self.run_main()
        self.assertEqual(code, 2)

    def test_bad_shard_count_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as cm, redirect_stderr(io.StringIO()):
            sm.main(["--src", self.src, "--out", self.out, "--shards", "0"])
        self.assertEqual(cm.exception.code, 2)


class RealData(unittest.TestCase):
    """The committed shards are exactly what the committed rebuild source produces."""

    def test_site_shards_match_tools_data(self):
        src = os.path.join(ROOT, "tools", "data", "molecules.json")
        out = os.path.join(ROOT, "site", "data", "mol")
        if not os.path.exists(src):
            self.skipTest("tools/data/molecules.json is not in this checkout")
        err = io.StringIO()
        with redirect_stdout(io.StringIO()), redirect_stderr(err):
            code = sm.main(["--src", src, "--out", out, "--check"])
        self.assertEqual(code, 0, err.getvalue())

    def test_the_page_never_ships_the_full_table(self):
        self.assertFalse(os.path.exists(os.path.join(ROOT, "site", "data", "molecules.json")))


if __name__ == "__main__":
    unittest.main()
