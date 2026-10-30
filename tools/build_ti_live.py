#!/usr/bin/env python3
"""Join the ranked therapeutic-index run to the explorer's own drugs and write site/data/ti/live.json.

    python3 -I tools/build_ti_live.py                 # ti/out/therapeutic_index.csv -> site/data/ti/live.json
    python3 -I tools/build_ti_live.py --check         # fail if the file on disk is not what this would write

The explorer page (site/js/ti-live.js) shows the index for the drug under the pointer and for the drugs in the
current view. It must not do the matching itself: the ranked run covers 1,345 molecules from DrugBank and ChEMBL,
the page knows 759 drugs keyed by PubChem CID, and the two sides meet only through an InChIKey or a ChEMBL id.
That join is done here, once, so the page reads a file keyed by its own CID and nothing is matched by name in a
browser. Molecules the run ranked that the explorer does not carry are counted in `meta.counts`, never dropped
silently; drugs the run could not rank keep no entry at all, which is what the readout says about them.

Standard library only. The index itself is never recomputed here: every number is copied from the run's own CSV.
"""
import argparse
import csv
import hashlib
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "ti" / "out" / "therapeutic_index.csv"
AUDIT_PATH = ROOT / "ti" / "out" / "audit.json"
DRUGS_PATH = ROOT / "site" / "data" / "drugs.json"
OUT_PATH = ROOT / "site" / "data" / "ti" / "live.json"
BATCH_PATH = ROOT / "site" / "data" / "ti" / "batch.json"

# Colour and band edges on the index, fixed for the whole batch so that a filter never re-colours the plot under
# the reader. The quartiles of the 649 ranked molecules are 0.89 / 1.81 / 2.92, so these five bands split them
# roughly evenly and 0 keeps its meaning: at or below it the modelled hERG number is not under the activity.
BREAKS = [0.0, 1.0, 2.0, 3.0]

# measured pharmacokinetic columns carried through for the free-concentration work: fraction unbound, half-life (h),
# steady-state volume (L/kg), clearance (mL/min/kg), mean residence time (h). Measured values, never model inputs.
PK = {"fu": "measured_fu", "t12": "measured_t_half_h", "vdss": "measured_vdss_l_per_kg",
      "cl": "measured_cl_ml_per_min_per_kg", "mrt": "measured_mrt_h"}

FIELDS = {
    "ti": "therapeutic index: p_activity - p_toxicity(hERG), both -log10 mol/L",
    "rank": "rank within its own target, 1 is the widest margin", "n": "molecules ranked at that target",
    "tid": "target ChEMBL id", "tname": "target name", "tsrc": "chembl_mechanism or structure (routed)",
    "rdec": "routing decision", "act": "p_activity", "asrc": "where p_activity came from",
    "aq": "quality note on p_activity", "herg": "p_toxicity at hERG", "hsrc": "where that came from",
    "hq": "quality note on it", "ad": "applicability domain: measured, inside or outside",
    "opt": "log P optimum of the series model, when there is one", "pk": "measured PK values: " + ", ".join(PK),
}


def num(s):
    """A float, or None for an empty cell."""
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def load_rows(csv_path):
    with csv_path.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def build(csv_path=CSV_PATH, drugs_path=DRUGS_PATH, audit_path=AUDIT_PATH):
    rows = load_rows(csv_path)
    ranked = [r for r in rows if r.get("status") == "ranked"]
    drugs = json.loads(drugs_path.read_text(encoding="utf-8"))["drugs"]

    by_ik, by_chembl = {}, {}
    for d in drugs:
        if d.get("ik"):
            by_ik.setdefault(d["ik"], []).append(d["cid"])
        if d.get("chembl"):
            by_chembl.setdefault(d["chembl"], []).append(d["cid"])

    out, hits = {}, {"inchikey": 0, "chembl_id": 0, "no_match": 0}
    for r in ranked:
        cids = by_ik.get(r["inchikey"])
        how = "inchikey"
        if not cids:
            cids, how = by_chembl.get(r["molecule_chembl_id"]), "chembl_id"
        if not cids:
            hits["no_match"] += 1
            continue
        hits[how] += 1
        pk = {k: num(r.get(col)) for k, col in PK.items()}
        rec = {
            "ti": num(r["therapeutic_index"]), "rank": int(r["rank_in_target"]), "n": int(r["n_in_target"]),
            "tid": r["target_chembl_id"], "tname": r["target_name"] or r["target_chembl_id"],
            "tsrc": r["target_source"], "rdec": r["routing_decision"],
            "act": num(r["p_activity"]), "asrc": r["p_activity_source"], "aq": r["p_activity_quality"],
            "herg": num(r["p_toxicity_herg"]), "hsrc": r["p_toxicity_source"], "hq": r["p_toxicity_quality"],
            "ad": r["applicability_domain"], "opt": num(r["lipophilic_optimum_clogp"]),
            "match": how,
        }
        if any(v is not None for v in pk.values()):
            rec["pk"] = {k: v for k, v in pk.items() if v is not None}
        for cid in cids:                     # two explorer rows can share one structure; both get the same record
            out[str(cid)] = rec

    audit = json.loads(audit_path.read_text(encoding="utf-8")) if audit_path.exists() else {}
    all_ti = sorted(x for x in (num(r["therapeutic_index"]) for r in ranked) if x is not None)
    mine = sorted(rec["ti"] for rec in out.values() if rec["ti"] is not None)
    spread = lambda v: ({"n": len(v), "min": round(v[0], 3), "median": round(statistics.median(v), 3),
                         "max": round(v[-1], 3)} if v else {"n": 0})

    return {
        "meta": {
            "endpoint": audit.get("endpoint", {}),
            "liability_target": audit.get("liability_target", "CHEMBL240"),
            "breaks": BREAKS,
            "fields": FIELDS,
            "counts": {
                "molecules in the run": len(rows),
                "ranked in the run": len(ranked),
                "matched by InChIKey": hits["inchikey"],
                "matched by ChEMBL id": hits["chembl_id"],
                "ranked but not a drug on this page": hits["no_match"],
                "drugs on this page": len(drugs),
                "drugs on this page with an index": len(out),
            },
            "batch": spread(all_ti),
            "here": spread(mine),
            "source": {
                "csv": str(csv_path.relative_to(ROOT)),
                "csv_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
                "drugs_sha256": hashlib.sha256(drugs_path.read_bytes()).hexdigest(),
                "built_by": "tools/build_ti_live.py",
            },
        },
        "drugs": out,
    }


# The decision workbench (site/js/ti-decide.js) re-derives the ranking under the reader's own inclusion rules, so it
# needs every ranked molecule, not only the ones the explorer draws: a rank within a target is wrong if some of that
# target's molecules are missing from the file. Hence a second, compact output. Target names are interned because 649
# rows share 170 of them. No number is recomputed here either; only membership and rank move, and they move in the
# browser, from these same values.
BATCH_FIELDS = {
    "name": "molecule name", "m": "molecule ChEMBL id", "t": "index into targets[]", "ts": "target source",
    "rd": "routing decision", "a": "p_activity", "as": "where p_activity came from", "h": "p_toxicity at hERG",
    "hs": "where that came from", "ad": "applicability domain", "ti": "therapeutic index",
    "cid": "PubChem CID when this molecule is also a drug on the page, else absent",
}


def build_batch(csv_path=CSV_PATH, drugs_path=DRUGS_PATH, audit_path=AUDIT_PATH):
    rows = load_rows(csv_path)
    ranked = [r for r in rows if r.get("status") == "ranked"]
    drugs = json.loads(drugs_path.read_text(encoding="utf-8"))["drugs"]
    by_ik, by_chembl = {}, {}
    for d in drugs:
        if d.get("ik"):
            by_ik.setdefault(d["ik"], []).append(d["cid"])
        if d.get("chembl"):
            by_chembl.setdefault(d["chembl"], []).append(d["cid"])

    order, targets, mols = {}, [], []
    for r in ranked:
        tid = r["target_chembl_id"]
        if tid not in order:
            order[tid] = len(targets)
            targets.append({"id": tid, "name": r["target_name"] or tid})
        rec = {
            "name": r["name"], "m": r["molecule_chembl_id"], "t": order[tid],
            "ts": r["target_source"], "rd": r["routing_decision"],
            "a": num(r["p_activity"]), "as": r["p_activity_source"],
            "h": num(r["p_toxicity_herg"]), "hs": r["p_toxicity_source"],
            "ad": r["applicability_domain"], "ti": num(r["therapeutic_index"]),
        }
        cids = by_ik.get(r["inchikey"]) or by_chembl.get(r["molecule_chembl_id"])
        if cids:
            rec["cids"] = sorted(cids)
        mols.append(rec)

    counted = {}
    for m in mols:
        counted[m["t"]] = counted.get(m["t"], 0) + 1
    for i, t in enumerate(targets):
        t["n"] = counted.get(i, 0)

    audit = json.loads(audit_path.read_text(encoding="utf-8")) if audit_path.exists() else {}
    vocab = lambda key: sorted({m[key] for m in mols})
    return {
        "meta": {
            "endpoint": audit.get("endpoint", {}),
            "liability_target": audit.get("liability_target", "CHEMBL240"),
            "breaks": BREAKS,
            "fields": BATCH_FIELDS,
            "vocabulary": {k: vocab(k) for k in ("as", "hs", "ad", "ts", "rd")},
            "counts": {
                "molecules in the run": len(rows),
                "ranked in the run": len(ranked),
                "targets": len(targets),
                "also drugs on this page": sum(len(m.get("cids", ())) for m in mols),
                "targets with one molecule": sum(1 for t in targets if t["n"] == 1),
            },
            "source": {
                "csv": str(csv_path.relative_to(ROOT)),
                "csv_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
                "built_by": "tools/build_ti_live.py",
            },
            "note": "Inclusion rules in the browser re-derive membership and rank from these fixed numbers. "
                    "Nothing here is refitted on the page; a decision that would need a refit is a recorded run.",
        },
        "targets": targets,
        "molecules": mols,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--csv", type=Path, default=CSV_PATH)
    ap.add_argument("--drugs", type=Path, default=DRUGS_PATH)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    ap.add_argument("--batch", type=Path, default=BATCH_PATH)
    ap.add_argument("--check", action="store_true", help="compare with the file on disk instead of writing it")
    args = ap.parse_args()

    wanted = {args.out: build(args.csv, args.drugs), args.batch: build_batch(args.csv, args.drugs)}
    texts = {p: json.dumps(d, indent=0, sort_keys=True) + "\n" for p, d in wanted.items()}
    if args.check:
        stale = [p for p, t in texts.items() if not p.exists() or p.read_text(encoding="utf-8") != t]
        for p in texts:
            print(f"{p.name}: {'OUT OF DATE, run tools/build_ti_live.py' if p in stale else 'up to date'}")
        return 1 if stale else 0
    for p, t in texts.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(t, encoding="utf-8")
    data = wanted[args.out]
    c = data["meta"]["counts"]
    print(f"{args.out.relative_to(ROOT)}: {c['drugs on this page with an index']} of {c['drugs on this page']} drugs "
          f"carry an index ({c['matched by InChIKey']} by InChIKey, {c['matched by ChEMBL id']} by ChEMBL id); "
          f"{c['ranked but not a drug on this page']} ranked molecules are not drugs on this page")
    b = wanted[args.batch]["meta"]["counts"]
    print(f"{args.batch.relative_to(ROOT)}: the whole ranked batch for the decision workbench, "
          f"{b['ranked in the run']} molecules at {b['targets']} targets "
          f"({b['targets with one molecule']} targets hold a single molecule)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
