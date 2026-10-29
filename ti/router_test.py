#!/usr/bin/env python3
"""Calibrate the routing thresholds on training data, then test the router against known targets.

    ti/router_test.py --calibrate              # thresholds from training similarity alone
    ti/router_test.py --benchmark              # does structure-only routing recover the real target?
    ti/router_test.py --benchmark --basis mmp  # the same test with the matched-pair neighbourhood

THE TWO STEPS ARE DELIBERATELY SEPARATE AND IN THIS ORDER.

Calibration may only see the training sets - never the drug labels the benchmark is scored on. Otherwise the
thresholds would be tuned until the accuracy looked good, and the accuracy would then be a description of
the tuning rather than of the router. So:

  --calibrate  asks one question of the training data: how similar is a compound to its own target's set,
               compared with the best other target's set? Leave-one-out, so a compound never sees itself.
               The scope floor is the 10th percentile of the own-set distribution: a floor that still
               admits nine out of ten genuine members. The margin is the 25th percentile of the gap
               between own and best-other, so that a lead smaller than most genuine leads reads as
               ambiguous rather than as an answer.

  --benchmark  then runs the frozen thresholds against drugs whose target ChEMBL records from the
               mechanism-of-action table. The router is given the structure only. The drug's own training
               rows are hidden, because a router that recognises a molecule it was trained on has
               demonstrated nothing.

WHAT IS REPORTED, AND WHY EACH NUMBER MATTERS.

    coverage         share of drugs the router was willing to route at all
    top-1 accuracy   of those, the share sent to the target ChEMBL actually records
    top-3 accuracy   the share whose true target was among the three best candidates
    ambiguous        several models tied; reported as candidates, no prediction made
    abstained        nothing close enough; no model used
    wrong            routed confidently to the wrong target - the error that matters most

A baseline sits beside them: always route to the largest model. Beating that is the minimum bar for
claiming the conditional does any work.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import registry as reg  # noqa: E402
import router as rt  # noqa: E402

OUT = HERE / "out"
PER_MODEL = 15      # compounds sampled per model for calibration
SEED = 0


def calibrate() -> dict:
    registry, bank, owner = reg.load()
    models = [m for m in registry["models"] if m.get("eligible")]
    rng = random.Random(SEED)
    own, gap = [], []

    for i, model in enumerate(models, 1):
        lo, hi = model["bank_slice"]
        idx = list(range(lo, hi))
        for j in rng.sample(idx, min(PER_MODEL, len(idx))):
            sims = rt.tanimoto_bulk(bank[j], bank)
            sims[j] = -1.0                      # leave-one-out
            best_own, best_other = -1.0, -1.0
            for other in models:
                a, b = other["bank_slice"]
                usable = sims[a:b]
                usable = usable[usable >= 0]
                if usable.size == 0:
                    continue
                k = min(rt.TOP_K, usable.size)
                score = float(np.sort(usable)[-k:].mean())
                if other["model_id"] == model["model_id"]:
                    best_own = score
                elif score > best_other:
                    best_other = score
            if best_own >= 0:
                own.append(best_own)
                if best_other >= 0:
                    gap.append(best_own - best_other)
        if i % 40 == 0:
            print(f"  calibrated against {i}/{len(models)} models", file=sys.stderr)

    own_arr, gap_arr = np.array(own), np.array(gap)
    out = {
        "sampled_compounds": len(own),
        "own_target_top5_similarity": {
            "p10": round(float(np.percentile(own_arr, 10)), 4),
            "median": round(float(np.median(own_arr)), 4),
            "p90": round(float(np.percentile(own_arr, 90)), 4),
        },
        "own_minus_best_other": {
            "p25": round(float(np.percentile(gap_arr, 25)), 4),
            "median": round(float(np.median(gap_arr)), 4),
            "share_negative": round(float((gap_arr < 0).mean()), 4),
        },
        "scope_floor": round(float(np.percentile(own_arr, 10)), 4),
        "margin": round(max(float(np.percentile(gap_arr, 25)), 0.01), 4),
        "derived_from": "training sets only, leave-one-out; no drug labels were used",
    }
    (OUT / "routing_thresholds.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


def benchmark(basis: str = "morgan", limit: int | None = None) -> dict:
    registry, bank, owner = reg.load()
    resolved = json.loads((HERE / "cache" / "resolved.json").read_text(encoding="utf-8"))
    eligible = {m["target_chembl_id"] for m in registry["models"] if m.get("eligible")}
    by_target = {m["target_chembl_id"]: m for m in registry["models"] if m.get("eligible")}
    largest = max(by_target.values(), key=lambda m: m["n"])["target_chembl_id"]

    # Map every bank row to its ChEMBL molecule id, so a drug's own training rows can be hidden.
    row_of: dict[str, list[int]] = {}
    for model in by_target.values():
        lo, _ = model["bank_slice"]
        rows = json.loads((HERE / "cache" / "train" / f"{model['target_chembl_id']}.json")
                          .read_text(encoding="utf-8"))["rows"]
        for offset, row in enumerate(rows):
            row_of.setdefault(row["molecule_chembl_id"], []).append(lo + offset)

    # Ground truth is EVERY target ChEMBL records against the molecule, not just the first row of the
    # mechanism table. Many drugs have several real targets - haloperidol is recorded against D2, D3 and
    # 5-HT2A among others - and scoring against an arbitrary one of them would mark a correct answer wrong.
    cases = []
    for mol in resolved["molecules"]:
        if not mol.get("smiles"):
            continue
        truths = {m["target_chembl_id"] for m in (mol.get("mechanisms") or [])} & eligible
        if truths:
            cases.append((mol, truths))
    if limit:
        cases = cases[:limit]

    tally = Counter()
    rows, baseline_right = [], 0
    for i, (mol, truths) in enumerate(cases, 1):
        baseline_right += (largest in truths)
        hide = set(row_of.get(mol.get("chembl_id") or "", []))
        result = rt.route(mol["smiles"], registry, bank, owner, basis=basis, exclude=hide)
        decision = result["decision"]
        tally[decision] += 1
        ranked = [c["target_chembl_id"] for c in result.get("candidates", [])]
        if decision == "routed":
            hit = result["routed_target_chembl_id"] in truths
            tally["top1_right" if hit else "wrong"] += 1
        if truths & set(ranked[:3]):
            tally["top3_in_candidates"] += 1
        # An ambiguous call still ranks its candidates, so its best candidate is scored separately: it says
        # whether the ordering is useful even when the margin rule declines to commit to it.
        if decision == "ambiguous" and ranked:
            tally["ambiguous_best_right" if ranked[0] in truths else "ambiguous_best_wrong"] += 1
        rows.append({"name": mol["name"], "truth": sorted(truths), "decision": decision,
                     "routed": result.get("routed_target_chembl_id"), "ranked": ranked[:3],
                     "score": result.get("score")})
        if i % 100 == 0:
            print(f"  routed {i}/{len(cases)}", file=sys.stderr)

    n = len(cases)
    routed = tally["routed"]
    out = {
        "basis": basis,
        "thresholds": dict(zip(("scope_floor", "margin"), rt.thresholds())),
        "drugs_with_a_known_eligible_target": n,
        "coverage": round(routed / n, 4) if n else 0.0,
        "routed": routed,
        "ambiguous": tally["ambiguous"],
        "abstained": tally["abstain"],
        "top1_accuracy_of_routed": round(tally["top1_right"] / routed, 4) if routed else None,
        "top1_right": tally["top1_right"],
        "wrong": tally["wrong"],
        "top3_accuracy_of_all": round(tally["top3_in_candidates"] / n, 4) if n else None,
        "ambiguous_best_candidate_right": round(
            tally["ambiguous_best_right"] / max(tally["ambiguous"], 1), 4) if tally["ambiguous"] else None,
        "baseline_always_largest_model": round(baseline_right / n, 4) if n else None,
        "note": ("the router saw structures only; each drug's own training rows were hidden; a routing is "
                 "counted correct when it names any target ChEMBL records for that molecule"),
        "targets_per_drug_median": sorted(len(t) for _, t in cases)[len(cases) // 2] if cases else 0,
    }
    (OUT / f"router_benchmark_{basis}.json").write_text(
        json.dumps({"summary": out, "cases": rows}, indent=1), encoding="utf-8")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--benchmark", action="store_true")
    ap.add_argument("--basis", choices=["morgan", "mmp"], default="morgan")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.calibrate:
        for key, value in calibrate().items():
            print(f"{key:34s} {value}")
    if args.benchmark:
        for key, value in benchmark(args.basis, args.limit).items():
            print(f"{key:34s} {value}")
    if not (args.calibrate or args.benchmark):
        raise SystemExit("pass --calibrate or --benchmark")
    return 0


if __name__ == "__main__":
    sys.exit(main())
