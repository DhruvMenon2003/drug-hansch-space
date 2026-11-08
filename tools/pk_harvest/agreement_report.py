#!/usr/bin/env python3
"""How often do harvested CL / Vss / fu values agree with the Lombardo-2018 values already in the table?

    uv run --with openpyxl python tools/pk_harvest/agreement_report.py data/therapeutic_index/Therapeutic_Index_Table_input.xlsx

This is an external validity check on the extractor: the table values come from a curated IV-PK database, the
harvested values from independent papers. Ratios are max/min; 'within 1.5x' / 'within 2x' are reported per
parameter, together with the status distribution and the worst disagreements for manual review.
"""

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import openpyxl

RES = Path(__file__).resolve().parent / "cache" / "results"
wb = openpyxl.load_workbook(sys.argv[1], read_only=True)
ws = wb["Drug Leaderboard"]
existing = {}
# columns AH (34) .. AM (39): Vss, CL, dose, interval, Fabs, fu — streamed, not addressed per cell (read-only mode is slow otherwise)
for i, row in enumerate(ws.iter_rows(min_row=25, max_row=1397, min_col=34, max_col=39, values_only=True), start=1):
    vals = {}
    for key, v in (("Vss", row[0]), ("CL", row[1]), ("fu", row[5])):
        if isinstance(v, (int, float)) and v > 0:
            vals[key] = float(v)
    existing[i] = vals

status = Counter()
ratios = defaultdict(list)
worst = []
n_src = Counter()
for p in sorted(RES.glob("*.json")):
    d = json.loads(p.read_text("utf-8"))
    status[d["status"]] += 1
    n_src[len(d.get("sources") or [])] += 1
    ex = existing.get(d["index"], {})
    for si, s in enumerate(d.get("sources") or [], 1):
        for param in ("CL", "Vss", "fu"):
            h = s["params"].get(param)
            if h and param in ex and h["value"] > 0:
                ratio = max(ex[param], h["value"]) / min(ex[param], h["value"])
                ratios[param].append(ratio)
                if ratio > 3:
                    worst.append((ratio, d["drug"], param, ex[param], h["value"], h["subtype"], h["reported"], s["rec"].get("doi")))

print("status:", dict(status))
print("sources per drug:", dict(n_src))
for param, rs in ratios.items():
    rs.sort()
    n = len(rs)
    w15 = sum(1 for x in rs if x <= 1.5) / n
    w2 = sum(1 for x in rs if x <= 2) / n
    med = rs[n // 2]
    print(f"{param}: n={n} within 1.5x={w15:.0%} within 2x={w2:.0%} median ratio={med:.2f} geometric-mean log10 ratio={sum(math.log10(x) for x in rs) / n:.3f}")
worst.sort(reverse=True)
print("\nworst disagreements (ratio > 3):")
for w in worst[:25]:
    print(f"  {w[0]:6.1f}x {w[1][:28]:28s} {w[2]:4s} table={w[3]:<8g} paper={w[4]:<8g} {w[5]:22s} rep={w[6]!r:30.30} {w[7]}")
