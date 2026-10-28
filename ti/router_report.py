#!/usr/bin/env python3
"""Write the router benchmark up as prose, so the result can be judged without reading JSON.

    ti/router_report.py               # ti/out/router_benchmark.md from whichever benchmarks have run

The question this answers is narrow and worth stating plainly: if nobody tells the pipeline what a molecule's
target is, does the structure alone send it to the right model? Everything downstream depends on the answer,
because a confident prediction from the wrong target's model is the most expensive mistake this pipeline can
make - it is indistinguishable from a right one on the page.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

NAMES = {"morgan": "A · Morgan fingerprint neighbours", "mmp": "B · shared-core matched pairs"}


def main() -> int:
    runs = {}
    for basis in ("morgan", "mmp"):
        path = OUT / f"router_benchmark_{basis}.json"
        if path.exists():
            runs[basis] = json.loads(path.read_text(encoding="utf-8"))
    if not runs:
        raise SystemExit("run ti/router_test.py --benchmark first")

    thresholds = json.loads((OUT / "routing_thresholds.json").read_text(encoding="utf-8")) \
        if (OUT / "routing_thresholds.json").exists() else {}

    L: list[str] = []
    w = L.append
    w("# Does structure alone find the right target?")
    w("")
    w("A chemist with a new molecule should not have to declare its target. So the router is given the "
      "structure and nothing else, and has to decide which of the local models that molecule is entitled to "
      "use. This file is the test of whether it can.")
    w("")
    w("## How the test was set up")
    w("")
    w("The molecules are drugs whose target ChEMBL records in its mechanism-of-action table, which gives a "
      "ground truth that was never shown to the router. Two things were done to keep the test honest:")
    w("")
    w("- **Each drug's own training rows were hidden.** A router that recognises a molecule it was trained on "
      "has demonstrated nothing. With the drug's own rows removed, it has to reach the right model through its "
      "neighbours.")
    w("- **The thresholds were fixed before the test ran, from training data only.** They come from a "
      "leave-one-out comparison inside the training sets: how similar is a compound to its own target's "
      "chemistry, against the best other target's. No drug label was used to set them. Tuning them until the "
      "accuracy looked good would have made the accuracy a description of the tuning.")
    if thresholds:
        w("")
        w(f"Scope floor **{thresholds.get('scope_floor')}** (the 10th percentile of the own-target "
          f"distribution, so nine in ten genuine members still clear it) and margin "
          f"**{thresholds.get('margin')}** (the 25th percentile of the lead a genuine member holds over the "
          f"best rival target). A lead smaller than that reads as ambiguous rather than as an answer.")
        own = thresholds.get("own_target_top5_similarity", {})
        gap = thresholds.get("own_minus_best_other", {})
        if own and gap:
            w("")
            w(f"For scale: a compound's median similarity to its own target's chemistry is "
              f"**{own.get('median')}**, and the median amount by which its own target beats the best rival "
              f"is **{gap.get('median')}**. In **{gap.get('share_negative', 0):.1%}** of cases some other "
              f"target's chemistry was actually the closer match, which is the irreducible difficulty of the "
              f"problem rather than a defect in the router.")
    w("")
    w("## Results")
    w("")
    w("| | " + " | ".join(NAMES[b] for b in runs) + " |")
    w("| --- |" + " --- |" * len(runs))
    rows = [
        ("drugs with a known, modellable target", "drugs_with_a_known_eligible_target", "{:,}"),
        ("coverage (willing to route at all)", "coverage", "{:.1%}"),
        ("top-1 accuracy, of those routed", "top1_accuracy_of_routed", "{:.1%}"),
        ("true target among the 3 best candidates", "top3_accuracy_of_all", "{:.1%}"),
        ("routed confidently to the wrong target", "wrong", "{:,}"),
        ("ambiguous (candidates shown, no prediction)", "ambiguous", "{:,}"),
        ("abstained (no model used)", "abstained", "{:,}"),
        ("baseline: always route to the largest model", "baseline_always_largest_model", "{:.1%}"),
    ]
    for label, key, fmt in rows:
        cells = []
        for basis in runs:
            value = runs[basis]["summary"].get(key)
            cells.append(fmt.format(value) if isinstance(value, (int, float)) else "–")
        w(f"| {label} | " + " | ".join(cells) + " |")
    w("")
    w("**The baseline is the bar to beat.** Always sending every molecule to the largest model requires no "
      "chemistry at all. If the router does not beat that, the conditional is decoration.")
    w("")

    best = max(runs, key=lambda b: runs[b]["summary"].get("top1_accuracy_of_routed") or 0)
    summary = runs[best]["summary"]
    acc, base = summary.get("top1_accuracy_of_routed"), summary.get("baseline_always_largest_model")
    w("## What this means in practice")
    w("")
    if acc is not None and base is not None:
        verdict = ("clears" if acc > base * 2 else "beats" if acc > base else "does not beat")
        w(f"The better of the two neighbourhoods is **{NAMES[best]}**, at **{acc:.1%}** top-1 accuracy against "
          f"a **{base:.1%}** baseline: it {verdict} the bar. Read the three numbers together rather than the "
          f"accuracy alone - a router can buy accuracy by abstaining more, so coverage of "
          f"**{summary.get('coverage', 0):.1%}** is part of the same claim.")
        w("")
    w("The honest reading of a routed row is: *this molecule's chemistry resembles the compounds measured "
      "against this target, closely enough and distinctly enough that this target's model is the one entitled "
      "to speak about it.* It is not a claim that the molecule binds that target. For that, run the assay.")
    w("")
    w("An **ambiguous** result is useful in its own right: it says the molecule sits between two chemical "
      "neighbourhoods, and the candidates are in the row. An **abstain** says the molecule is unlike anything "
      "in the registry, which for a genuinely novel scaffold is the correct and most informative answer.")
    w("")
    if len(runs) == 1:
        missing = "mmp" if "morgan" in runs else "morgan"
        w(f"> Only one neighbourhood has been benchmarked so far. {NAMES[missing]} is implemented but its "
          f"numbers are not in this table yet, so no comparison between the two is claimed here.")
        w("")

    path = OUT / "router_benchmark.md"
    path.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
