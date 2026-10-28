#!/usr/bin/env python3
"""Route every molecule to its own target's models, work out the index, and write the one ranked CSV.

    ti/rank.py                       # ti/out/therapeutic_index.csv + ti/out/audit.json
    ti/rank.py --out-dir DIR

WHAT THE NUMBER IN THE LAST COLUMN MEANS

    therapeutic_index = p_toxicity(hERG) - p_activity(the molecule's own primary target)

Both sides are -log10 of a molar concentration from binding assays on the human protein, so the difference is a
plain log10 ratio. A therapeutic_index of 2.0 means the molecule binds its therapeutic target about a hundredfold
more tightly than it binds the cardiac hERG channel. Higher is a wider margin. This is the selectivity margin a
medicinal chemist works to, and it is the only form of therapeutic index these datasets can support.

IT IS NOT A CLINICAL THERAPEUTIC INDEX. Not LD50/ED50, not dose-aware, not evidence of safety in a person. It is
an in vitro selectivity margin over one well-characterised liability, for ranking a batch against itself.

WHERE EACH SIDE COMES FROM, RECORDED PER MOLECULE, NEVER SILENTLY

    measured             ChEMBL has a binding measurement for this molecule at this target; we use it
    series_hansch        a Hansch model on this molecule's own congeneric series that passed every gate
    fallback_nonlinear   the declared fallback for this target, with its scaffold-grouped q2 attached
    unavailable          no measurement and no model that validates; the cell is empty and the row says why

THE ROUTING RULE, WHICH IS THE POINT OF THE EXERCISE

A molecule's activity may only come from a model fitted on its own target, with the same standard type, the
same assay type and the same organism. There is no pooling across targets and no fallback to a parent family.
A number from the wrong target's model is worse than no number, because it looks exactly like a right one.

Which target that is gets decided in a fixed order, and the row says which way it went:

    chembl_mechanism   ChEMBL's mechanism-of-action table records a target against this molecule. A recorded
                       annotation always wins; it is a curated fact and the router is a guess.
    structure_router   No annotation, or none with a usable model. ti/router.py then compares the structure
                       against every eligible local model's training chemistry and either names one, reports
                       several, or abstains. This is the case a chemist with a new compound is actually in:
                       they do not have to say what their molecule targets.

A routed target is an inference from chemical similarity. It is never a measurement, and target_source says so
on every row so that the two can never be read as the same thing.

WHY THERE IS NO SINGLE GLOBAL RANKING

Potency against one receptor and potency against another are different quantities from different assays, so
ordering them together produces a number with no referent. The file is therefore ranked *within* each target:
rank_in_target 1 is the widest margin among the molecules routed to that same model, which is the comparison a
chemist working on that target actually wants. Groups are ordered largest first; unrankable rows follow with a
stated reason. The global algorithm is the assembly of these local models plus the router, not one pooled fit.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from descriptors import DESCRIPTORS, HANSCH_TERMS, MEASURED, compute  # noqa: E402
from fit import (FALLBACK_MIN_Q2, MIN_SERIES, MIN_SERIES_SIMILARITY, SERIES_GATES,  # noqa: E402
                 load_all, predict)
from pull_training import LIABILITY_TARGET  # noqa: E402
import registry as reg  # noqa: E402
import router as rt  # noqa: E402

HERE = Path(__file__).resolve().parent
RESOLVED = HERE / "cache" / "resolved.json"
OUT = HERE / "out"

IDENTITY = ["rank_in_target", "n_in_target", "name", "molecule_chembl_id",
            "target_chembl_id", "target_name", "target_source", "routing_decision",
            "routing_score", "routing_separation", "routing_alternatives",
            "canonical_smiles", "inchikey", "murcko_scaffold"]
# FAERS reaction terms are spontaneous reports with no exposure denominator. They travel with the row as
# context for a reader and are never fitted against; see ti/adverse.py for why that matters.
FAERS = ["faers_top_reactions", "faers_top_reaction_reports", "faers_reports_total"]
PROVENANCE = ["p_activity", "p_activity_source", "p_activity_model", "p_activity_quality",
              "p_toxicity_herg", "p_toxicity_source", "p_toxicity_model", "p_toxicity_quality",
              "applicability_domain", "lipophilic_optimum_clogp", "status"]
COLUMNS = IDENTITY + DESCRIPTORS + MEASURED + FAERS + PROVENANCE + ["therapeutic_index"]

STATUS_ORDER = {"ranked": 0, "no_toxicity_model": 1, "no_activity_model": 2,
                "route_ambiguous": 3, "no_route": 4, "no_structure": 5}


def murcko(smiles: str) -> str:
    from rdkit import Chem, RDLogger
    from rdkit.Chem.Scaffolds import MurckoScaffold

    RDLogger.DisableLog("rdApp.*")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return ""
    try:
        return MurckoScaffold.MurckoScaffoldSmiles(mol=mol) or "(acyclic)"
    except Exception:
        return ""


def side(models: dict | None, chembl_id: str, descriptors: dict, scaffold: str, smiles: str) -> dict:
    """One side of the index. Measurement first, then this target's own models, then nothing."""
    if models is None:
        return {"value": None, "source": "unavailable", "model": "", "quality": "",
                "domain": "", "optimum": None, "why": "no training set for that target"}
    if chembl_id and chembl_id in models["measured"]:
        return {"value": models["measured"][chembl_id], "source": "measured", "model": "",
                "quality": "ChEMBL binding assay", "domain": "measured", "optimum": None, "why": ""}
    out = predict(models, descriptors, scaffold, smiles)
    if out["value"] is None:
        return {"value": None, "source": "unavailable", "model": "", "quality": "",
                "domain": "", "optimum": None, "why": out.get("note", "no usable model")}
    return {"value": out["value"], "source": out["tier"], "model": out["model_id"],
            "quality": out["quality"], "domain": out["domain"],
            "optimum": out.get("lipophilic_optimum_clogp"), "why": ""}


def choose_target(molecule: dict, descriptors: dict, models: dict,
                  registry: dict, bank, owner) -> dict:
    """Decide which local model this molecule may use, and record how that decision was reached.

    The order is fixed and never reversed. A target ChEMBL records against the molecule itself is a curated
    annotation; a target the router proposes is an inference from chemical similarity. So an annotation with a
    usable model is taken first, and only when there is none does the structure decide. The returned dict
    always carries target_source, so a reader of the CSV can tell a recorded target from an inferred one
    without having to know how the pipeline works.
    """
    mechanism = molecule.get("target_chembl_id") or ""
    if mechanism and mechanism in models:
        return {"target": mechanism, "target_source": "chembl_mechanism",
                "routing_decision": "mechanism", "score": "", "separation": "", "alternatives": "",
                "why": ""}

    result = rt.route(descriptors["canonical_smiles"], registry, bank, owner)
    candidates = result.get("candidates", [])
    alternatives = "; ".join(f"{c['target_chembl_id']}:{c['score']:.2f}" for c in candidates[:3])

    if result["decision"] == "abstain":
        return {"target": None, "target_source": "structure_router", "routing_decision": "abstain",
                "score": result.get("score", ""), "separation": result.get("separation", ""),
                "alternatives": alternatives,
                "why": f"the router abstained: {result.get('reason', 'nothing close enough')}"}

    # Routed, or ambiguous between several models. An ambiguous molecule is still placed under its best
    # candidate, because refusing outright throws away a usable comparison and tells the reader less than
    # saying so does. Aminergic ligands are the common case: haloperidol genuinely resembles the chemistry
    # measured against D2, D3, 5-HT1A, H1 and alpha-1A, because it genuinely binds all of them. The row
    # therefore carries routing_decision = ambiguous plus the other candidates and their scores, and a reader
    # who wants only the confident subset filters on that column. What is never done is presenting an
    # ambiguous assignment as a settled one.
    best = next((c for c in candidates if c["target_chembl_id"] in models), None)
    if best is None:
        return {"target": None, "target_source": "structure_router",
                "routing_decision": result["decision"], "score": result.get("score", ""),
                "separation": result.get("separation", ""), "alternatives": alternatives,
                "why": "none of the router's candidate targets has a fitted model"}
    return {"target": best["target_chembl_id"], "target_source": "structure_router",
            "routing_decision": result["decision"], "score": best["score"],
            "separation": result.get("separation", ""), "alternatives": alternatives, "why": ""}


def build(out_dir: Path) -> dict:
    if not RESOLVED.exists():
        raise SystemExit("run ti/resolve.py --out ti/cache/resolved.json first")
    resolved = json.loads(RESOLVED.read_text(encoding="utf-8"))
    models = load_all()
    if LIABILITY_TARGET not in models:
        raise SystemExit(f"the liability target {LIABILITY_TARGET} has no model; run ti/fit.py --all")
    liability = models[LIABILITY_TARGET]
    registry, bank, owner = reg.load()
    faers_path = HERE / "cache" / "faers.json"
    faers = json.loads(faers_path.read_text(encoding="utf-8")) if faers_path.exists() else {}

    rows, reasons = [], Counter()
    for molecule in resolved["molecules"]:
        record = {c: "" for c in COLUMNS}
        record["name"] = molecule["name"]
        record["molecule_chembl_id"] = molecule.get("chembl_id") or ""
        record["target_chembl_id"] = molecule.get("target_chembl_id") or ""
        record["target_name"] = molecule.get("mechanism_of_action") or ""
        for key in MEASURED:
            value = molecule.get(key)
            record[key] = "" if value is None else value

        descriptors, note = compute(molecule.get("smiles") or "")
        if descriptors is None:
            record["status"] = "no_structure"
            reasons[f"no usable structure: {note}"] += 1
            rows.append(record)
            continue
        record["canonical_smiles"] = descriptors["canonical_smiles"]
        record["inchikey"] = descriptors["inchikey"]
        record["murcko_scaffold"] = murcko(descriptors["canonical_smiles"])
        for key in DESCRIPTORS:
            record[key] = round(float(descriptors[key]), 4)

        for key, value in (faers.get(molecule["name"]) or {}).items():
            if key in record:
                record[key] = value

        routing = choose_target(molecule, descriptors, models, registry, bank, owner)
        record["target_chembl_id"] = routing["target"] or (molecule.get("target_chembl_id") or "")
        record["target_source"] = routing["target_source"]
        record["routing_decision"] = routing["routing_decision"]
        record["routing_score"] = routing["score"]
        record["routing_separation"] = routing["separation"]
        record["routing_alternatives"] = routing["alternatives"]
        if routing["target"] is None:
            # Only reached when no candidate target had a fitted model at all.
            record["status"] = ("route_ambiguous" if routing["routing_decision"] == "ambiguous"
                                else "no_route")
            reasons[routing["why"]] += 1
            rows.append(record)
            continue

        activity = side(models.get(record["target_chembl_id"]), record["molecule_chembl_id"],
                        descriptors, record["murcko_scaffold"], record["canonical_smiles"])
        toxicity = side(liability, record["molecule_chembl_id"], descriptors, record["murcko_scaffold"],
                        record["canonical_smiles"])
        for prefix, got in (("p_activity", activity), ("p_toxicity_herg", toxicity)):
            record[prefix] = "" if got["value"] is None else got["value"]
            record[f"{prefix.replace('p_toxicity_herg', 'p_toxicity')}_source"] = got["source"]
            record[f"{prefix.replace('p_toxicity_herg', 'p_toxicity')}_model"] = got["model"]
            record[f"{prefix.replace('p_toxicity_herg', 'p_toxicity')}_quality"] = got["quality"]
        record["lipophilic_optimum_clogp"] = activity["optimum"] if activity["optimum"] is not None else ""

        if activity["value"] is None or toxicity["value"] is None:
            record["status"] = ("no_activity_model" if activity["value"] is None else "no_toxicity_model")
            reasons[activity["why"] or toxicity["why"] or "no value"] += 1
            rows.append(record)
            continue

        domains = [d for d in (activity["domain"], toxicity["domain"]) if d]
        record["applicability_domain"] = ("outside" if any("outside" in d for d in domains)
                                          else "measured" if all(d == "measured" for d in domains)
                                          else "inside")
        record["status"] = "ranked"
        # TI = TD50/ED50, so log TI = log(TD50) - log(ED50). Both sides here are p-values (p = -log10 molar),
        # so log(TD50) = -p_herg and log(ED50) = -p_activity, and the difference is p_activity - p_herg. Writing
        # it the other way round inverts the whole ranking: it puts the molecules that grip the heart channel
        # harder than their own target at the top. Theophylline (p_act 4.20, p_hERG 5.36) is the check - it must
        # come out at -1.16, a warning, not +1.16, the best in the batch.
        record["therapeutic_index"] = round(activity["value"] - toxicity["value"], 3)
        rows.append(record)

    # Rank inside each target, never across them. A molecule's rank is its position among the molecules
    # routed to the same local model, which is the only comparison the underlying numbers support.
    ranked_rows = [r for r in rows if r["status"] == "ranked"]
    groups: dict[str, list] = {}
    for record in ranked_rows:
        groups.setdefault(record["target_chembl_id"], []).append(record)
    for target, members in groups.items():
        members.sort(key=lambda r: (-r["therapeutic_index"], r["name"]))
        for i, record in enumerate(members, start=1):
            record["rank_in_target"] = i
            record["n_in_target"] = len(members)

    # Groups are written largest first, so the substantive ranked lists are at the top of the file, and the
    # rows that could not be ranked follow with their reason.
    order = sorted(groups, key=lambda t: (-len(groups[t]), t))
    rows = ([r for t in order for r in groups[t]]
            + sorted((r for r in rows if r["status"] != "ranked"),
                     key=lambda r: (STATUS_ORDER.get(r["status"], 9), r["name"])))

    # Check the arithmetic independently of the code that produced it, before writing anything. A sign slip
    # here inverts the entire deliverable while leaving every number looking plausible: an earlier run shipped
    # a CSV in which Paliperidone's 7.164 - 5.890 was recorded as -1.274, and nothing about the file looked
    # wrong. This recomputes the index from the two columns beside it and refuses to write if they disagree.
    for record in rows:
        if record["status"] != "ranked":
            continue
        expected = round(float(record["p_activity"]) - float(record["p_toxicity_herg"]), 3)
        if abs(expected - float(record["therapeutic_index"])) > 1e-6:
            raise SystemExit(
                f"arithmetic check failed for {record['name']}: p_activity {record['p_activity']} - "
                f"p_toxicity_herg {record['p_toxicity_herg']} = {expected}, but the index column says "
                f"{record['therapeutic_index']}. Nothing was written.")

    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "therapeutic_index.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    ranked = [r for r in rows if r["status"] == "ranked"]
    audit = {
        "endpoint": {
            "name": "therapeutic_index",
            "definition": "p_activity(primary target) - p_toxicity(hERG, CHEMBL240), both -log10 mol/L",
            "units": "log10 ratio",
            "direction": "higher is a wider margin over the cardiac liability",
            "is_not": "not LD50/ED50, not a clinical therapeutic index, not dose-aware, not safety evidence",
        },
        "inputs": {
            name: hashlib.sha256((Path("/mnt/project-files") / name).read_bytes()).hexdigest()[:16]
            for name in ("dataset1.md", "dataset2.md", "dataset3.md")
            if (Path("/mnt/project-files") / name).exists()
        },
        "software": {"rdkit": __import__("rdkit").__version__,
                     "numpy": __import__("numpy").__version__,
                     "scikit-learn": __import__("sklearn").__version__,
                     "python": sys.version.split()[0]},
        "descriptors": {
            "declared_block": DESCRIPTORS,
            "hansch_terms": HANSCH_TERMS,
            "measured_not_fitted": MEASURED,
            "note": "the measured_ columns are human measurements, carried through and never fitted against",
        },
        "acceptance": {
            "series_hansch": {"min_n": MIN_SERIES, "min_median_tanimoto": MIN_SERIES_SIMILARITY, **SERIES_GATES},
            "fallback_nonlinear": {"min_q2_scaffold_grouped": FALLBACK_MIN_Q2, "max_shuffled_q2": 0.1},
        },
        "liability_target": LIABILITY_TARGET,
        "routing_rule": ("activity only from a model fitted on the molecule's own target; no pooling across "
                         "targets. The target comes from ChEMBL's mechanism table where one is recorded, "
                         "otherwise from ti/router.py on structure alone, and target_source says which."),
        "ranking_rule": ("ranked within each target, never across them: rank_in_target 1 is the widest margin "
                         "among the molecules routed to that same local model"),
        "registry": {
            "eligible_local_models": registry["counts"]["eligible local models"],
            "refused_for_low_support": registry["counts"]["refused for low support"],
            "training_compounds_in_the_bank": registry["counts"]["training compounds in the bank"],
            "fingerprint": registry["fingerprint"],
            "min_support": registry["min_support"],
        },
        "routing": {
            "thresholds": dict(zip(("scope_floor", "margin"), rt.thresholds())),
            "basis": "Morgan r=2 top-5 mean Tanimoto against each local model's training set",
            "is_not": "a measured target assignment; a routed target is an inference from structure",
            "decisions": dict(Counter(r["routing_decision"] for r in rows).most_common()),
            "targets_with_a_ranked_group": len(groups),
            "largest_group": max((len(v) for v in groups.values()), default=0),
        },
        "counts": {
            "molecules in": len(rows),
            "ranked": len(ranked),
            "both sides measured": sum(1 for r in ranked if r["p_activity_source"] == "measured"
                                       and r["p_toxicity_source"] == "measured"),
            "at least one side predicted": sum(1 for r in ranked if "measured" not in
                                               (r["p_activity_source"], r["p_toxicity_source"])),
            "from a validated Hansch series model": sum(1 for r in ranked if "series_hansch" in
                                                        (r["p_activity_source"], r["p_toxicity_source"])),
            "inside the applicability domain": sum(1 for r in ranked if r["applicability_domain"] != "outside"),
        },
        "not_ranked": dict(reasons.most_common()),
        "models": {
            tid: {
                "rows": m["n_rows"],
                "standard_type": m["standard_type"],
                "organism": m["organism"],
                "series_tried": len(m["series"]),
                "series_validated": sum(1 for s in m["series"].values() if s["passes"]),
                "fallback_q2_scaffold_grouped": m["fallback"]["q2_scaffold_grouped"],
                "fallback_shuffled_q2": m["fallback"]["scramble_q2_grouped"],
                "fallback_usable": m["fallback"]["usable"],
            }
            for tid, m in sorted(models.items())
        },
        "source_exclusions": resolved["exclusions"],
        "input_ledger": resolved["ledger"],
    }
    (out_dir / "audit.json").write_text(json.dumps(audit, indent=1, sort_keys=True), encoding="utf-8")

    # A compact copy for the explorer page's overlay. The page is static and fetches this; it never reads the CSV,
    # which is the deliverable and can be large.
    site = Path(__file__).resolve().parent.parent / "site" / "data" / "ti"
    site.mkdir(parents=True, exist_ok=True)
    keep = ["rank_in_target", "n_in_target", "name", "target_chembl_id", "target_name", "target_source",
            "routing_decision", "clogp", "mw", "tpsa", "qed",
            "p_activity", "p_activity_source", "p_activity_quality", "p_toxicity_herg",
            "p_toxicity_source", "p_toxicity_quality", "applicability_domain",
            "lipophilic_optimum_clogp", "therapeutic_index"]
    series = [
        {"target_id": tid, "n": m["n"], "terms": m["terms"], "r2": m["r2"], "q2_loo": m["q2_loo"],
         "median_tanimoto": m["median_tanimoto"], "optimum": m["lipophilic_optimum_clogp"],
         "coefficients": m["coefficients"], "scaffold": m["scaffold"]}
        for tid, target in sorted(models.items())
        for m in sorted(target["series"].values(), key=lambda x: -x["q2_loo"]) if m["passes"]
    ]
    (site / "summary.json").write_text(json.dumps({
        "endpoint": audit["endpoint"],
        "counts": audit["counts"],
        "acceptance": audit["acceptance"],
        "routing_rule": audit["routing_rule"],
        "descriptors": audit["descriptors"]["declared_block"],
        "hansch_terms": audit["descriptors"]["hansch_terms"],
        "liability_target": LIABILITY_TARGET,
        "not_ranked": audit["not_ranked"],
        "models": audit["models"],
        "validated_series": sorted(series, key=lambda x: -x["q2_loo"]),
        "ranked": [{k: r[k] for k in keep} for r in rows if r["status"] == "ranked"][:400],
        "software": audit["software"],
    }, indent=0, sort_keys=True), encoding="utf-8")

    return {"csv": csv_path, "audit": out_dir / "audit.json", "rows": rows, "audit_data": audit,
            "site": site / "summary.json"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", type=Path, default=OUT)
    args = ap.parse_args()
    result = build(args.out_dir)
    for key, value in result["audit_data"]["counts"].items():
        print(f"{key:42s} {value}")
    print("\nnot ranked:")
    for reason, n in result["audit_data"]["not_ranked"].items():
        print(f"  {n:5d}  {reason}")
    # There is no global top, so the console shows the head of the largest cohort and names the target it
    # belongs to. Printing a cross-target "top 12" would be the very comparison this ranking refuses to make.
    ranked = [r for r in result["rows"] if r["status"] == "ranked"]
    if ranked:
        target = ranked[0]["target_chembl_id"]
        cohort = [r for r in ranked if r["target_chembl_id"] == target][:12]
        print(f"\nlargest cohort - {cohort[0]['target_name'] or target} ({target}), "
              f"{cohort[0]['n_in_target']} molecules, top {len(cohort)}:")
        for r in cohort:
            print(f"  {r['rank_in_target']:4d} {r['therapeutic_index']:7.2f}  {r['name'][:30]:30s}"
                  f" {r['p_activity_source'][:8]:8s}/{r['p_toxicity_source'][:8]:8s}"
                  f" {r['routing_decision']:10s} {r['applicability_domain']}")
    print(f"\nwrote {result['csv']}\nwrote {result['audit']}\nwrote {result['site']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
