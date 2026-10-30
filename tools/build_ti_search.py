#!/usr/bin/env python3
"""Run the per-target model search for real and record it, so the page can replay a pruner instead of guessing.

    python3 -I tools/build_ti_search.py                 # site/data/qsar/*.json -> site/data/ti/search.json
    python3 -I tools/build_ti_search.py --check         # fail if the file on disk is not what this would write

ti/models.py already searches a hyperparameter, on one line: the ridge penalty is picked by trying 0.1, 1, 10 and
100 and keeping whichever scores best under five-fold cross-validation. Every candidate gets all five folds, so
nothing is ever stopped early. That is the decision this file opens up. The search is widened to the two knobs
that actually move the answer -- which descriptor block, and how the model is penalised -- and run on each
target's own training rows, recording the held-out score after every fold of every candidate.

With that table recorded, a pruner is no longer a thing to be imagined: it is a rule replayed over the same
numbers. Three policies are replayed here. The exhaustive one spends every fold. Median pruning stops a
candidate when its running score falls below the median of the candidates that have finished at the same fold.
Successive halving spends one fold on everything, promotes the top third, spends three folds on those, and
promotes again. Each policy reports the candidate it selects, what that candidate scored, and how many
folds it had to pay for -- so the question "does the pruner change my answer, or only my bill?" has an answer per
target rather than an opinion.

The intermediate score at fold t is the held-out R-squared pooled over folds 0..t, which is the same statistic as
the final objective computed on less data. That matters: a pruner cannot then prune on a quantity that disagrees
with what it is optimising, and the exhaustive policy's pick is exactly the pick ti/models.py would make given the
same candidate list. Per-fold R-squared taken fold by fold would be noisier and would not add up to the objective.

Both fold schemes are recorded, because which one is used is itself one of these decisions and the more important
one: random folds split a congeneric series across train and test and flatter the model, while scaffold folds hold
a whole chemical series out and ask the harder question. The gap between the two is printed for every target.

Lipophilicity is one descriptor, not two: logP and its square enter and leave together and are counted once, so
the Hansch block is five descriptors in six columns and the wide block nine in ten.

numpy, and ti/models.py for the fitting primitives, so that every number here comes from the pipeline's own
arithmetic rather than a second implementation of it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ti"))

import models  # noqa: E402  (ti/models.py: the fitting primitives, imported rather than copied)

QSAR_DIR = ROOT / "site" / "data" / "qsar"
OUT_PATH = ROOT / "site" / "data" / "ti" / "search.json"

K = 5          # folds, as in ti/models.py
# Recorded scores are integer hundredths of R-squared with a floor at -100. A candidate a whole variance worse
# than predicting the mean is a loser whatever its remaining digits say, and the floor keeps the file small enough
# to ship. Every policy below is replayed on these integers, and so is the page's own replay, so the two cannot
# disagree on a near tie. The winning candidate's exact score is carried separately, unrounded.
SCALE, FLOOR = 100, -100
MIN_N = 25     # ti/models.py GATES["min_n"]: below this a target is not fitted at all

# The candidate list, in the order the search visits it. Two knobs: the descriptor block, and the penalty.
# "ols" is no penalty at all. The order is fixed and recorded, because a pruner's behaviour depends on it.
BLOCKS = {"hansch": models.HANSCH, "wide": models.WIDE}
PENALTIES = [("ols", None), ("ridge", 0.1), ("ridge", 1.0), ("ridge", 10.0), ("ridge", 100.0)]
TRIALS = [{"block": b, "kind": k, "alpha": a} for b in BLOCKS for k, a in PENALTIES]

# Median pruning, as Optuna's MedianPruner is configured by default in spirit: let a couple of candidates finish
# before pruning anything, and never prune on the first fold alone.
MEDIAN = {"n_startup_trials": 2, "n_warmup_steps": 1}
# Successive halving: one fold to start, keep the top third at each rung. With five folds the rungs land at 1, 3
# and 5 folds, so a candidate that survives both cuts is fully evaluated.
HALVING = {"min_resource": 1, "reduction_factor": 3}


def rungs(k: int, min_resource: int, factor: int) -> list[int]:
    """Fold counts at which halving stops to compare candidates, the last one being the full budget."""
    out, r = [], min_resource
    while r < k:
        out.append(r)
        r *= factor
    return out + [k]


def partials(X: np.ndarray, y: np.ndarray, kind: str, alpha, folds: list[np.ndarray]) -> list[float]:
    """Held-out R-squared pooled over the first t+1 folds, for t = 0..k-1. The objective is the last entry."""
    pred = np.full(len(y), np.nan)
    seen: list[float] = []
    for fold in folds:
        mask = np.ones(len(y), dtype=bool)
        mask[fold] = False
        if len(fold) and mask.sum() >= X.shape[1] + 2:
            if kind == "ols":
                pred[fold] = models._predict(models._ols(X[mask], y[mask]), X[fold])
            else:
                pred[fold] = models._ridge_predict(models._ridge(X[mask], y[mask], alpha), X[fold])
        ok = ~np.isnan(pred)
        seen.append(models._r2(y[ok], pred[ok]) if ok.sum() > 3 else float("nan"))
    return seen


def quantise(curve: list[float]) -> list[int | None]:
    """Float R-squared to the integer hundredths every policy is replayed on. A fold with no score stays empty."""
    return [None if v != v else max(FLOOR, int(round(v * SCALE))) for v in curve]


def score(v) -> int:
    """A missing score must lose, never win, and never silently count as zero."""
    return FLOOR - 1 if v is None else v


def run_full(table: list[list[float]]) -> dict:
    """Every candidate, every fold: what ti/models.py does today."""
    best = max(range(len(table)), key=lambda i: score(table[i][-1]))
    return {"pick": best, "folds": sum(len(row) for row in table)}


def run_median(table, k: int, startup: int = None, warmup: int = None) -> dict:
    """Stop a candidate once its running score sits below the median of those already finished at that fold.

    Only candidates that finished contribute to the median, which is what Optuna's MedianPruner compares against:
    a pruned candidate reports no final score and so can never be selected, however good its first fold looked.
    """
    startup = MEDIAN["n_startup_trials"] if startup is None else startup
    warmup = MEDIAN["n_warmup_steps"] if warmup is None else warmup
    done, spent = [], 0                   # done: (trial index, its curve), in the order they finished
    for i, row in enumerate(table):
        for t in range(k):
            spent += 1
            if t + 1 == k:
                done.append((i, row))
                break
            if len(done) < startup or t < warmup:
                continue
            others = [score(curve[t]) for _, curve in done]
            if others and score(row[t]) < float(np.median(others)):
                break                     # pruned, and never added to done: it votes on nothing
    best = max(done, key=lambda pair: score(pair[1][-1]))[0] if done else 0
    return {"pick": best, "folds": spent, "pruned": len(table) - len(done)}


def run_halving(table: list[list[float]], k: int) -> dict:
    """One fold on everything, then keep the top third at each rung and spend the next rung's folds on those."""
    ladder = rungs(k, HALVING["min_resource"], HALVING["reduction_factor"])
    alive, spent, paid = list(range(len(table))), 0, {i: 0 for i in range(len(table))}
    for rung in ladder:
        for i in alive:
            spent += rung - paid[i]
            paid[i] = rung
        if rung == ladder[-1]:
            break
        keep = max(1, len(alive) // HALVING["reduction_factor"])
        alive = sorted(alive, key=lambda i: -score(table[i][rung - 1]))[:keep]
    best = max(alive, key=lambda i: score(table[i][-1]))
    return {"pick": best, "folds": spent, "pruned": len(table) - len(alive)}


def search_target(target_id: str) -> dict | None:
    data = models.load_target(target_id)
    if data is None or len(data["y"]) < MIN_N:
        return None
    y = data["y"]
    X = {name: models._matrix(data["rows"], terms) for name, terms in BLOCKS.items()}
    schemes = {"random": models._folds(len(y), K, None),
               "scaffold": models._folds(len(y), K, data["scaffold"])}
    out = {"n": int(len(y)), "scaffolds": len({str(s) for s in data["scaffold"]}), "schemes": {}}
    for scheme, folds in schemes.items():
        exact = [partials(X[t["block"]], y, t["kind"], t["alpha"], folds) for t in TRIALS]
        table = [quantise(row) for row in exact]
        full = run_full(table)
        policies = {"full": full, "median": run_median(table, len(folds)), "halving": run_halving(table, len(folds))}
        for res in policies.values():
            final = exact[res["pick"]][-1]
            res["score"] = round(final, 4) if final == final else None
            res["same_pick"] = res["pick"] == full["pick"]
        out["schemes"][scheme] = {
            "folds": len(folds),
            "curves": table,
            # the pipeline's own gate on the winner: below this ti/models.py would not use the model at all
            "winner_passes_gate": bool(policies["full"]["score"] is not None
                                       and policies["full"]["score"] >= models.GATES["min_q2"]),
            "policies": policies,
        }
    return out


def build() -> dict:
    targets = {}
    for path in sorted(QSAR_DIR.glob("*.json")):
        if path.name == "index.json":          # the folder's own table of contents, not a target
            continue
        got = search_target(path.stem)
        if got is not None:
            targets[path.stem] = got
    names = {}
    for tid in targets:
        blob = json.loads((QSAR_DIR / f"{tid}.json").read_text(encoding="utf-8"))
        names[tid] = blob["target"]["name"]
    return {
        "meta": {
            "built_by": "tools/build_ti_search.py",
            "what": "the per-target model search, recorded candidate by candidate and fold by fold, so that a "
                    "pruning rule can be replayed over real numbers instead of described",
            "objective": "held-out R-squared, five-fold, pooled across the folds seen so far; the last entry of "
                         "a curve is the candidate's final score",
            "curve_scale": {"unit": "hundredths of R-squared", "divide_by": SCALE, "floor": FLOOR,
                            "note": "every policy, here and on the page, is replayed on these integers; the "
                                    "winning candidate's score is carried unrounded beside it"},
            "gate": {"min_q2": models.GATES["min_q2"],
                     "note": "ti/models.py will not use a model whose held-out R-squared is under this, so at a "
                             "target where no candidate clears it the pruner changes the bill and nothing else"},
            "trials": TRIALS,
            "blocks": {name: {"columns": terms,
                              "descriptors": len([t for t in terms if t != "clogp_sq"]),
                              "note": "logP and its square are one descriptor in two columns"}
                       for name, terms in BLOCKS.items()},
            "folds": K,
            "seed": models.SEED,
            "median_pruner": MEDIAN,
            "halving_pruner": dict(HALVING, rungs=rungs(K, HALVING["min_resource"], HALVING["reduction_factor"])),
            "schemes": {"random": "folds drawn at random over molecules, so one chemical series can sit on both "
                                  "sides of the split",
                        "scaffold": "folds drawn over Bemis-Murcko scaffolds, so a whole series is held out at once"},
            "counts": {"targets": len(targets)},
            "names": names,
        },
        "targets": targets,
    }


def summarise(blob: dict) -> list[str]:
    lines = []
    for scheme in ("random", "scaffold"):
        rows = [t["schemes"][scheme] for t in blob["targets"].values() if scheme in t["schemes"]]
        full = sum(r["policies"]["full"]["folds"] for r in rows)
        for name in ("median", "halving"):
            same = sum(1 for r in rows if r["policies"][name]["same_pick"])
            spent = sum(r["policies"][name]["folds"] for r in rows)
            lines.append(f"{scheme:9s} {name:8s} same candidate at {same} of {len(rows)} targets, "
                         f"{100 * spent / full:.0f}% of the folds")
        gaps = [r["policies"]["full"]["score"] for r in rows if r["policies"]["full"]["score"] is not None]
        lines.append(f"{scheme:9s} best score, median across targets: {float(np.median(gaps)):.3f}")
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the file on disk is not what this would write")
    args = ap.parse_args()
    blob = build()
    text = json.dumps(blob, separators=(",", ":"), sort_keys=False) + "\n"
    if args.check:
        if not OUT_PATH.exists() or OUT_PATH.read_text(encoding="utf-8") != text:
            print(f"stale: {OUT_PATH.relative_to(ROOT)}", file=sys.stderr)
            return 1
        print(f"up to date: {OUT_PATH.relative_to(ROOT)}")
        return 0
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print(f"{OUT_PATH.relative_to(ROOT)}: {len(blob['targets'])} targets, {len(TRIALS)} candidates each, "
          f"{len(text) / 1024:.0f} KB, sha256 {hashlib.sha256(text.encode()).hexdigest()[:12]}")
    for line in summarise(blob):
        print("  " + line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
