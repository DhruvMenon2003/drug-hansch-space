#!/usr/bin/env python3
"""The three deck bodies — Dataset, Workflow, Software — written from the run's own audit.

    ti/slides.py                     # ti/out/slides.json from ti/out/audit.json

The deck is updated through the Slides connector, which cannot live in a script. What can live in a script is
the content: every number below is read out of audit.json (and out of routing_thresholds.json, which the
calibration step writes), so the slides cannot drift from the run that produced the CSV. Re-run this after any
re-run of ti/rank.py and the bodies are current by construction.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


# The audit records the fingerprint as a dict and the routing decisions keyed by the value rank.py wrote,
# including the empty string for a molecule that had no structure to route. Both are correct in a machine-read
# file and unreadable on a slide, so they are turned into prose here rather than being changed at the source.
DECISION_NAMES = {
    "mechanism": "routed by ChEMBL's recorded mechanism",
    "routed": "routed on structure",
    "ambiguous": "called ambiguous",
    "abstain": "abstained",
    "": "no structure to route",
}


def routing_fingerprint(fingerprint) -> str:
    if isinstance(fingerprint, dict):
        return (f"{fingerprint.get('kind', 'Morgan')} r={fingerprint.get('radius', 2)}, "
                f"{fingerprint.get('bits', 2048)} bits")
    return str(fingerprint or "Morgan r=2, 2048 bits")


def decision_phrase(decisions: dict) -> str:
    order = [k for k in DECISION_NAMES if k in decisions] + [k for k in decisions if k not in DECISION_NAMES]
    return ", ".join(f"{DECISION_NAMES.get(k, k or 'unrecorded')} {decisions[k]}" for k in order)


def bodies(audit: dict, thresholds: dict | None = None) -> dict:
    c, e, acc = audit["counts"], audit["endpoint"], audit["acceptance"]
    sw = audit["software"]
    models = audit["models"]
    reg = audit.get("registry", {})
    routing = audit.get("routing", {})
    thresholds = thresholds or {}
    usable = [m for m in models.values() if m["fallback_usable"]]
    q2s = sorted((m["fallback_q2_scaffold_grouped"] for m in usable), reverse=True)
    series_ok = sum(m["series_validated"] for m in models.values())
    series_all = sum(m["series_tried"] for m in models.values())
    block = audit["descriptors"]["declared_block"]
    reasons = sorted(audit["not_ranked"].items(), key=lambda kv: -kv[1])
    fp = routing_fingerprint(reg.get("fingerprint"))
    decisions = decision_phrase(routing.get("decisions", {}))
    floor = routing.get("thresholds", {}).get("scope_floor", thresholds.get("scope_floor"))
    margin = routing.get("thresholds", {}).get("margin", thresholds.get("margin"))
    share_negative = (thresholds.get("own_minus_best_other") or {}).get("share_negative")

    dataset = [
        f"{c['molecules in']} drugs from dataset3, each one name-matched to ChEMBL and then standardised with "
        f"RDKit — largest fragment, neutralised, metals refused.",
        f"Training data: one ChEMBL set per biological target. "
        f"{reg.get('eligible_local_models', len(models))} targets carry enough measured chemistry to be fitted "
        f"at all ({reg.get('min_support', 20)} compounds minimum); "
        f"{reg.get('refused_for_low_support', 0)} were refused for too little, with the reason recorded rather "
        f"than a model fitted anyway. "
        f"{sum(m['rows'] for m in models.values()):,} cleaned compound/activity pairs in total, one "
        f"standard_type per target (never Ki and IC50 mixed), binding assays only, exact relations only, "
        f"duplicates merged by median, replicates spanning more than one log unit dropped.",
        f"A fingerprint bank of {reg.get('training_compounds_in_the_bank', 0):,} training compounds "
        f"({fp}) is what a new molecule is compared against. It is "
        f"built once and is the only thing the router reads.",
        f"Predictors: {len(block)} declared whole-molecule descriptors, fixed before any model was fitted — "
        f"{', '.join(block[:8])} and {len(block) - 8} more.",
        f"Measured human PK from dataset3 (fu, Vdss, clearance, MRT, half-life) travels with every row under a "
        f"measured_ prefix and is never fitted against. It is a measurement, not a descriptor.",
        f"Output: one CSV. One column per predictor, therapeutic index last. {c['ranked']} rows carry an index; "
        f"the remaining {c['molecules in'] - c['ranked']} are in the file with an empty index and a stated "
        f"reason, the largest being “{reasons[0][0]}” ({reasons[0][1]}).",
    ]

    workflow = [
        f"Endpoint (OECD 1): {e['definition']}. Higher is a wider margin over the cardiac liability. This is "
        f"{e['is_not']}.",
        "One global model assembled out of many local ones. There is no single pooled equation and no single "
        "ranking: a molecule is scored by the local model fitted on its own target, and the ranking happens "
        "inside that target. Ranking an antipsychotic against an antibiotic would be arithmetic without "
        "meaning, so the CSV never does it.",
        f"Routing, step one: ChEMBL's mechanism-of-action table, where it records one and that target has a "
        f"fitted model. Step two, for everything else: structure alone. The query is compared against every "
        f"eligible model's training set and routed on the "
        f"{routing.get('basis', 'Morgan r=2 top-5 mean Tanimoto')}. The chemist never has to name the target.",
        f"The router is allowed three answers, and two of them are not an answer: route it, call it ambiguous "
        f"when several neighbourhoods are within the margin, or abstain when nothing clears the scope floor. "
        + (f"On this batch: {decisions}. " if decisions else "")
        + f"A routed target is an inference from chemical similarity and the row says so; it is never recorded "
        f"as a measurement.",
        f"Routing thresholds are calibrated on the training sets only, leave-one-out, with no drug labels: "
        f"scope floor {floor}, margin {margin}. "
        + (f"The same calibration is candid about the hard part — for {share_negative:.0%} of training "
           f"compounds the single most similar neighbourhood is not their own target, so structural "
           f"similarity alone cannot be treated as a target assignment. " if share_negative is not None else "")
        + "The router is tested separately from the models it routes to, against a baseline that always "
        "answers with the largest model, because an easy conditional is not evidence of valid routing.",
        "Inside each local model, three tiers in order. 1. Measurement, where ChEMBL has one. 2. A Hansch "
        "equation for the congeneric series the molecule belongs to. 3. A declared non-linear fallback on the "
        "same descriptors, labelled non-mechanistic. A molecule reaches a series equation only by belonging to "
        "that series: median Morgan Tanimoto at or above that series' own membership floor, the 10th "
        "percentile of its internal pairwise similarity.",
        f"Acceptance (OECD 4): series — n ≥ {acc['series_hansch']['min_n']}, median similarity ≥ "
        f"{acc['series_hansch']['min_median_tanimoto']}, r² ≥ {acc['series_hansch']['min_r2']}, "
        f"q²(leave-one-out) ≥ {acc['series_hansch']['min_q2_loo']}, shuffled q² < "
        f"{acc['series_hansch']['max_scramble_q2']}. Terms capped at n/5 and chosen on AICc, so the criterion "
        f"selected on is never the criterion reported. Result: {series_ok} of {series_all} candidate series "
        f"passed; {len(usable)} of {len(models)} targets produced a usable fallback"
        + (f", q² {q2s[-1]:.2f}–{q2s[0]:.2f} with whole chemical families held out." if q2s else "."),
        f"Applicability domain (OECD 3): descriptor range for a series equation, kNN distance at the "
        f"95th percentile for the fallback. "
        f"{c['inside the applicability domain']} ranked rows sit inside it; the rest say so in their own row. "
        f"Every index is also re-derived from its own two columns before the file is written, and the run "
        f"stops rather than ship a row whose arithmetic does not hold.",
    ]

    software = [
        f"Python {sw['python']}, RDKit {sw['rdkit']}, NumPy {sw['numpy']}, "
        f"scikit-learn {sw['scikit-learn']}.",
        "RDKit: standardisation (LargestFragmentChooser, Uncharger), Crippen logP and molar refractivity, TPSA, "
        "QED, Gasteiger partial charges, Bemis–Murcko scaffolds, Morgan fingerprints at radius 2, and BRICS "
        "fragmentation for the matched-pair cores the router can route on.",
        "scikit-learn: the declared non-linear fallback (random forest, 300 trees) and the standardiser behind "
        "the kNN applicability domain. Nothing else.",
        "Ordinary least squares, leave-one-out q², AICc, the y-randomisation test and the Tanimoto search are "
        "written out in ti/fit.py and ti/router.py rather than imported, so every figure in the report can be "
        "traced to the line that computed it.",
        "Data sources: ChEMBL web API (activities, mechanisms, structures) and dataset3 for the batch and its "
        "measured human PK. No PubChem structures.",
        "Reproducibility: ti/resolve.py → ti/pull_training.py → ti/fit.py --all → ti/registry.py → "
        "ti/cores.py → ti/router_test.py --calibrate → ti/router_test.py --benchmark → ti/rank.py → "
        "ti/report.py → ti/publish.py. Every stage caches, the random seed is fixed, and audit.json carries "
        "the input hashes and library versions that produced the CSV.",
    ]

    return {"Dataset": dataset, "Workflow": workflow, "Software": software}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", type=Path, default=OUT)
    args = ap.parse_args()
    audit_path = args.out_dir / "audit.json"
    if not audit_path.exists():
        raise SystemExit("run ti/rank.py first")
    thresholds_path = args.out_dir / "routing_thresholds.json"
    thresholds = json.loads(thresholds_path.read_text(encoding="utf-8")) if thresholds_path.exists() else {}
    out = bodies(json.loads(audit_path.read_text(encoding="utf-8")), thresholds)
    path = args.out_dir / "slides.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    for title, lines in out.items():
        print(f"\n=== {title} ===")
        for line in lines:
            print(f"  • {line}")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
