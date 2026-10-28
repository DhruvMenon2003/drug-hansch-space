#!/usr/bin/env python3
"""Place one new molecule in the ranked list of the target its structure belongs to.

    ti/place.py --smiles "CN1CCN(CC1)c1ccc2[nH]c3ccccc3c2c1"      # route it, rank it, show the neighbours
    ti/place.py --smiles "..." --target CHEMBL217                  # skip the router, name the model yourself
    ti/place.py --smiles "..." --json                              # machine-readable

THE QUESTION THIS ANSWERS.

You have designed a molecule against some target. You want to know how its margin between potency and cardiac
liability compares with the compounds already known against that same target - and you should not have to tell
the tool what the target is, because working that out is part of the job.

So: the structure goes in alone. The router decides which local model is entitled to speak about it. That
model predicts potency, the hERG model predicts the liability, and the molecule is inserted into that target's
ranked list so you can see what it sits between.

WHAT THE ANSWER IS AND IS NOT.

The rank is a position among the molecules in this dataset routed to the same model, not a position among all
known ligands for that target. The index is a log ratio of two predicted binding affinities, not a dose and
not a safety margin. If the router abstains, that is the answer: the molecule is unlike anything in the
registry, and no model here is entitled to a number for it.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from descriptors import compute  # noqa: E402
from fit import load_all  # noqa: E402
from pull_training import LIABILITY_TARGET  # noqa: E402
import registry as reg  # noqa: E402
import router as rt  # noqa: E402
from rank import murcko, side  # noqa: E402

OUT = HERE / "out"
NEIGHBOURS = 4          # rows shown either side of the query in the ranked list
MAX_TARGETS = 3         # how many candidate targets an ambiguous query is placed against


def _stale(rows: list) -> str | None:
    """Refuse to rank a molecule against a cohort whose own arithmetic does not hold.

    The cohort is read back out of the published CSV, so a stale or wrongly signed CSV would quietly make the
    query look better or worse than the molecules it is being compared with - the one failure mode that is
    invisible on the page. This recomputes a sample of indices from the two columns beside them and says so
    rather than comparing against numbers it cannot vouch for.
    """
    checked = 0
    for row in rows:
        if row.get("status") != "ranked":
            continue
        try:
            expected = round(float(row["p_activity"]) - float(row["p_toxicity_herg"]), 3)
        except (KeyError, ValueError):
            return ("the published CSV is missing the columns this comparison needs; re-run ti/rank.py")
        if abs(expected - float(row["therapeutic_index"])) > 1e-6:
            return (f"the published CSV is stale: {row['name']}'s index should be {expected} from the two "
                    f"columns beside it but reads {row['therapeutic_index']}. Re-run ti/rank.py before "
                    f"comparing anything against it.")
        checked += 1
        if checked >= 50:
            break
    return None


def _placement(target: str, descriptors: dict, scaffold: str, models: dict,
               liability_value: float, csv_rows: list) -> dict | None:
    """Predict and rank this molecule inside one target's cohort. None when that model cannot speak."""
    activity = side(models[target], "", descriptors, scaffold, descriptors["canonical_smiles"])
    if activity["value"] is None:
        return {"target": target, "ok": False, "why": activity["why"] or "no prediction available"}
    index = round(activity["value"] - liability_value, 3)
    cohort = sorted((r for r in csv_rows if r["target_chembl_id"] == target and r["status"] == "ranked"),
                    key=lambda r: -float(r["therapeutic_index"]))
    ahead = sum(1 for r in cohort if float(r["therapeutic_index"]) > index)
    return {
        "target": target, "ok": True,
        "p_activity": activity["value"], "p_activity_source": activity["source"],
        "p_activity_model": activity["model"], "p_activity_quality": activity["quality"],
        "therapeutic_index": index,
        "applicability_domain": "outside" if "outside" in (activity["domain"] or "") else "inside",
        "rank_in_target": ahead + 1, "n_in_target": len(cohort) + 1,
        # Rank is recomputed from the sorted order rather than read from the column, so this works against
        # any version of the CSV and never disagrees with the index it is showing.
        "cohort": [{"name": r["name"], "therapeutic_index": float(r["therapeutic_index"]),
                    "routing_decision": r.get("routing_decision", ""),
                    "rank_in_target": i} for i, r in enumerate(cohort, start=1)],
    }


def place(smiles: str, target: str | None = None, max_targets: int = MAX_TARGETS) -> dict:
    descriptors, note = compute(smiles)
    if descriptors is None:
        return {"ok": False, "why": f"could not use that structure: {note}"}

    registry, bank, owner = reg.load()
    models = load_all()
    if LIABILITY_TARGET not in models:
        return {"ok": False, "why": f"the liability model {LIABILITY_TARGET} is missing; run ti/fit.py --all"}

    scaffold = murcko(descriptors["canonical_smiles"])
    toxicity = side(models[LIABILITY_TARGET], "", descriptors, scaffold, descriptors["canonical_smiles"])
    if toxicity["value"] is None:
        return {"ok": False, "why": f"the hERG model cannot speak about this molecule: {toxicity['why']}"}

    if target is not None:
        routing = {"target_source": "named by the caller", "decision": "named", "candidates": []}
        wanted = [target]
    else:
        result = rt.route(descriptors["canonical_smiles"], registry, bank, owner)
        routing = {"target_source": "structure_router", "decision": result["decision"],
                   "score": result.get("score"), "separation": result.get("separation"),
                   "candidates": result.get("candidates", [])[:8], "reason": result.get("reason", "")}
        if result["decision"] == "abstain":
            return {"ok": False, "routing": routing, "query": descriptors,
                    "why": result.get("reason", "the router would not route this molecule")}
        # A routed query is placed against one model. An ambiguous one is placed against each of its best
        # candidates, because that is what the ambiguity actually means: the chemistry is consistent with
        # several targets, and the chemist knows which of them they are working on.
        wanted = [c["target_chembl_id"] for c in routing["candidates"] if c["target_chembl_id"] in models]
        wanted = wanted[:1] if result["decision"] == "routed" else wanted[:max_targets]

    if not wanted:
        return {"ok": False, "routing": routing, "query": descriptors,
                "why": "none of the candidate targets has a fitted model in this run"}

    csv_path = OUT / "therapeutic_index.csv"
    csv_rows = []
    if csv_path.exists():
        csv.field_size_limit(10 ** 9)
        with csv_path.open(encoding="utf-8") as handle:
            csv_rows = list(csv.DictReader(handle))
        stale = _stale(csv_rows)
        if stale:
            return {"ok": False, "query": {"canonical_smiles": descriptors["canonical_smiles"],
                                           "clogp": descriptors["clogp"], "mw": descriptors["mw"],
                                           "tpsa": descriptors["tpsa"]},
                    "routing": routing, "why": stale}

    scores = {c["target_chembl_id"]: c for c in routing["candidates"]}
    placements = []
    for tid in wanted:
        if tid not in models:
            placements.append({"target": tid, "ok": False, "why": "no fitted model for that target"})
            continue
        got = _placement(tid, descriptors, scaffold, models, toxicity["value"], csv_rows)
        got["routing_score"] = scores.get(tid, {}).get("score")
        got["training_compounds"] = scores.get(tid, {}).get("n")
        placements.append(got)

    return {
        "ok": any(p.get("ok") for p in placements),
        "query": {"smiles": smiles, "canonical_smiles": descriptors["canonical_smiles"],
                  "inchikey": descriptors["inchikey"], "murcko_scaffold": scaffold,
                  "clogp": descriptors["clogp"], "mw": descriptors["mw"], "tpsa": descriptors["tpsa"]},
        "routing": routing,
        "p_toxicity_herg": toxicity["value"], "p_toxicity_model": toxicity["model"],
        "placements": placements,
    }


def show(result: dict) -> None:
    if "query" in result and "canonical_smiles" in result["query"]:
        q = result["query"]
        print(f"\nquery        {q['canonical_smiles']}")
        print(f"             clogP {q['clogp']}   MW {q['mw']}   TPSA {q['tpsa']}")

    routing = result.get("routing") or {}
    if routing.get("decision") == "named":
        print(f"\ntarget       named by the caller, not routed")
    elif routing:
        print(f"\nrouting      {routing['decision'].upper()}  -  {routing.get('reason', '')}")
        print("             a routed target is an inference from chemistry, never a measured assignment")
        for cand in routing.get("candidates", [])[:6]:
            print(f"   {cand['target_chembl_id']:14s} similarity {cand['score']:.3f}  "
                  f"({cand['n']:,} training compounds)")

    if not result["ok"]:
        print(f"\nNOT PLACED: {result['why']}\n")
        return

    print(f"\npredicted    p_hERG {result['p_toxicity_herg']:.2f}   [{result['p_toxicity_model']}]")
    placed = [p for p in result["placements"] if p.get("ok")]
    if len(placed) > 1:
        print(f"\nThe router could not settle on one target, so the molecule is placed against each of the "
              f"{len(placed)} best candidates below. Pick the one you are working on.")

    for p in result["placements"]:
        print(f"\n{'=' * 78}")
        if not p.get("ok"):
            print(f"{p['target']}  -  not placed: {p['why']}")
            continue
        score = f", structural similarity {p['routing_score']:.3f}" if p.get("routing_score") else ""
        print(f"{p['target']}  ({p.get('training_compounds') or '?'} training compounds{score})")
        print(f"   p_activity {p['p_activity']:.2f}  [{p['p_activity_source']}, {p['p_activity_quality']}]")
        print(f"   index      {p['therapeutic_index']:+.2f}   (p_activity - p_hERG; higher is a wider margin)")
        print(f"   domain     {p['applicability_domain']}")
        rank, total, cohort = p["rank_in_target"], p["n_in_target"], p["cohort"]
        print(f"\n   rank {rank} of {total}\n")
        lo = max(0, rank - 1 - NEIGHBOURS)
        hi = min(len(cohort), rank - 1 + NEIGHBOURS)
        for i in range(lo, rank - 1):
            flag = "~" if cohort[i]["routing_decision"] == "ambiguous" else " "
            print(f"     {i+1:4d} {flag} {cohort[i]['therapeutic_index']:+7.2f}  {cohort[i]['name']}")
        print(f"   > {rank:4d}   {p['therapeutic_index']:+7.2f}  YOUR MOLECULE")
        for i in range(rank - 1, hi):
            flag = "~" if cohort[i]["routing_decision"] == "ambiguous" else " "
            print(f"     {i+2:4d} {flag} {cohort[i]['therapeutic_index']:+7.2f}  {cohort[i]['name']}")
    print(f"\n   ~ marks a cohort member whose own target assignment was ambiguous\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--smiles", required=True)
    ap.add_argument("--target", help="skip the router and use this target's model")
    ap.add_argument("--max-targets", type=int, default=MAX_TARGETS)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    result = place(args.smiles, args.target, args.max_targets)
    if args.json:
        print(json.dumps(result, indent=1))
    else:
        show(result)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
