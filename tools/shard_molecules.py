#!/usr/bin/env python3
"""Split the conformer table into small shards that the page fetches one at a time.

The full table (tools/data/molecules.json, 1.1 MB, 320 KB gzip) is the rebuild source and is NOT published. The page needs
one molecule when a drug is opened, so this script writes 32 shards, by dataset CID modulo 32, to site/data/mol/<n>.json
(10-17 KB gzip each) plus site/data/mol/index.json (counts, sizes and the source hash; the page never fetches it, the
site checks read it).

    tools/shard_molecules.py                        # tools/data/molecules.json -> site/data/mol/
    tools/shard_molecules.py --src X.json --out Y/  # other paths
    tools/shard_molecules.py --check                # write nothing; exit 1 when the shards on disk are not what a run would write

Deterministic and idempotent: molecules are ordered by numeric CID inside a shard, JSON is compact with fixed key order, and
a file is only rewritten when its bytes would change. Shards that no longer belong (a lower --shards than before) are
removed. Python 3 standard library only. The shard count is also a constant in site/js/data.js (MOL_SHARDS); tools/check_site.py
fails when the two differ.
"""
import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SRC = os.path.join(ROOT, "tools", "data", "molecules.json")
DEFAULT_OUT = os.path.join(ROOT, "site", "data", "mol")
DEFAULT_SHARDS = 32
SHARD_FILE = re.compile(r"^(\d+)\.json$")


def dump(obj):
    """Compact, stable JSON bytes (UTF-8, no ASCII escaping so file sizes match what the browser parses)."""
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def split(molecules, shards):
    """{cid_string: molecule} -> list of `shards` dicts, each ordered by numeric CID. The shard of a CID is cid % shards."""
    out = [dict() for _ in range(shards)]
    for key in sorted(molecules, key=int):
        out[int(key) % shards][key] = molecules[key]
    return out


def build(src_bytes, shards):
    """The files a run writes: {filename: bytes}. Pure, so tests and --check use it without touching the disk."""
    molecules = json.loads(src_bytes)
    if not isinstance(molecules, dict) or not molecules:
        raise ValueError("source must be a non-empty JSON object keyed by CID")
    for key in molecules:
        if not re.fullmatch(r"\d+", key):
            raise ValueError(f"molecule key {key!r} is not a CID")
    parts = split(molecules, shards)
    files = {f"{i}.json": dump(p) for i, p in enumerate(parts)}
    index = {
        "v": 1,
        "shards": shards,
        "count": len(molecules),
        "source_sha256": hashlib.sha256(src_bytes).hexdigest(),
        "files": {str(i): {"n": len(p), "bytes": len(files[f"{i}.json"])} for i, p in enumerate(parts)},
    }
    files["index.json"] = dump(index)
    return files


def stale(out_dir, wanted):
    """Shard files in out_dir that a run would delete (numbered json files no longer wanted)."""
    if not os.path.isdir(out_dir):
        return []
    return sorted(n for n in os.listdir(out_dir) if SHARD_FILE.match(n) and n not in wanted)


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=DEFAULT_SRC, help="full conformer table (default: tools/data/molecules.json)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="shard directory (default: site/data/mol)")
    ap.add_argument("--shards", type=int, default=DEFAULT_SHARDS, help="number of shards (default 32; must match MOL_SHARDS in site/js/data.js)")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when the shards on disk differ from what a run would write")
    a = ap.parse_args(argv)
    if a.shards < 1 or a.shards > 4096:
        ap.error("--shards must be between 1 and 4096")
    try:
        with open(a.src, "rb") as f:
            src = f.read()
        files = build(src, a.shards)
    except (OSError, ValueError) as e:
        print(f"shard_molecules: {e}", file=sys.stderr)
        return 2
    gone = stale(a.out, files)
    changed = []
    for name, data in files.items():
        path = os.path.join(a.out, name)
        try:
            with open(path, "rb") as f:
                same = f.read() == data
        except OSError:
            same = False
        if not same:
            changed.append(name)
    if a.check:
        if changed or gone:
            print(f"shard_molecules: {a.out} is out of date: {len(changed)} file(s) differ, {len(gone)} stale", file=sys.stderr)
            return 1
        print(f"shard_molecules: ok ({a.shards} shards in {a.out})")
        return 0
    os.makedirs(a.out, exist_ok=True)
    for name in changed:
        write_atomic(os.path.join(a.out, name), files[name])
    for name in gone:
        os.remove(os.path.join(a.out, name))
    biggest = max(len(d) for n, d in files.items() if n != "index.json")
    print(f"shard_molecules: {len(files) - 1} shards, {json.loads(files['index.json'])['count']} molecules, largest shard {biggest} bytes; "
          f"{len(changed)} file(s) written, {len(gone)} removed ({a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
