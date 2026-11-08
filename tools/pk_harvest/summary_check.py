#!/usr/bin/env python3
"""Independent Python computation of the row-5 summary cells, for cross-checking the Excel-365 formulas.

    uv run --with openpyxl python tools/pk_harvest/summary_check.py data/therapeutic_index/Therapeutic_Index_Table.xlsx

LibreOffice 24.2 cannot evaluate LET / FILTER / SORTBY / TAKE / MAP / LAMBDA, so the values below are what Excel
365 should display in B5, D5, F5, H5 and K5. Log TI is recomputed here as LOG10(toxic/therapeutic) with the
workbook's IFERROR(...,0) convention; In Vivo Free Drug Concentration as dose*Fabs/(CL*1e-3*interval).
"""

import math
import statistics
import sys
from collections import defaultdict

import openpyxl

wb = openpyxl.load_workbook(sys.argv[1], data_only=False)
ws = wb["Drug Leaderboard"]
rows = []
for r in range(25, 1398):
    name, target = ws[f"Z{r}"].value, ws[f"AC{r}"].value
    ther, tox = ws[f"AE{r}"].value, ws[f"AF{r}"].value
    try:
        logti = math.log10(tox / ther) if ther and tox and tox / ther > 0 else 0.0
    except (TypeError, ZeroDivisionError, ValueError):
        logti = 0.0
    try:
        conc = ws[f"AJ{r}"].value * ws[f"AL{r}"].value / (ws[f"AI{r}"].value * 1e-3 * ws[f"AK{r}"].value)
    except (TypeError, ZeroDivisionError):
        conc = 0.0
    rows.append((name, (target or "").strip() if isinstance(target, str) else target, logti, conc))

pos = [x for x in rows if x[2] > 0]
n = len(pos)
wide = sum(1 for x in pos if x[2] > math.log10(4))
narrow = sum(1 for x in pos if x[2] < math.log10(4))
print(f"drugs with Log TI > 0: {n}")
print(f"B5 % wide (TI>4):   {wide}/{n} = {wide / n:.4f}" if n else "B5: no data")
print(f"D5 % narrow (TI<4): {narrow}/{n} = {narrow / n:.4f}" if n else "D5: no data")
top = sorted(pos, key=lambda x: -x[2])[:5]
print("F5 top 5:", [(x[0], round(x[2], 3)) for x in top])
bottom = sorted(pos, key=lambda x: (x[2], -x[3]))[:5]
print("H5 bottom 5:", [(x[0], round(x[2], 3), round(x[3], 2)) for x in bottom])
groups = defaultdict(list)
for x in pos:
    if x[1]:
        groups[x[1]].append(x[2])
if groups:
    med = {g: statistics.median(v) for g, v in groups.items()}
    best = max(med, key=med.get)
    print(f"K5 category: {best} (median log TI {med[best]:.2f}) over {len(groups)} categories")
else:
    print("K5: no drug with Log TI > 0 has a Drug Target")
