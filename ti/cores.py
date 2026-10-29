#!/usr/bin/env python3
"""Precompute the matched-pair cores of every training compound, once, into a cache.

    ti/cores.py                       # ti/cache/cores.json

A matched molecular pair shares a core and differs by one substituent, so the matched-pair neighbourhood of a
query is "the training compounds built on one of the query's cores" - a stricter and more chemically explicit
claim than "the training compounds that look similar". Working that out needs every training compound cut at
its acyclic BRICS bonds, which is far too slow to do inside a routing call. It is done once here and cached.

The cache maps a core SMILES to the local models that contain a compound built on it. That is the only
direction the router needs: given the query's cores, which models are in scope.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import router as rt  # noqa: E402

CACHE = HERE / "cache" / "cores.json"


def main() -> int:
    registry = json.loads((HERE / "out" / "registry.json").read_text(encoding="utf-8"))
    models = [m for m in registry["models"] if m.get("eligible")]
    index: dict[str, set[str]] = defaultdict(set)
    compounds = 0
    for i, model in enumerate(models, 1):
        target = model["target_chembl_id"]
        rows = json.loads((HERE / "cache" / "train" / f"{target}.json").read_text(encoding="utf-8"))["rows"]
        for row in rows:
            compounds += 1
            for core in rt._cores(row["canonical_smiles"]):
                index[core].add(target)
        if i % 20 == 0:
            print(f"  {i}/{len(models)} models, {compounds:,} compounds, {len(index):,} cores",
                  file=sys.stderr)
    CACHE.write_text(json.dumps({core: sorted(ts) for core, ts in index.items()}), encoding="utf-8")
    print(f"{len(index):,} distinct cores from {compounds:,} training compounds -> {CACHE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
