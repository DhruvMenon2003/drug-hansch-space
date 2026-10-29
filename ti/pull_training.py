#!/usr/bin/env python3
"""Pull the full ChEMBL activity set for the targets this run actually needs, with structures.

    ti/pull_training.py --targets CHEMBL240 CHEMBL203      # named targets
    ti/pull_training.py --from-resolved --top 40           # the targets most of the batch routes to, plus hERG
    ti/pull_training.py --report                           # what is already cached

WHY THIS EXISTS RATHER THAN REUSING site/data/qsar/

Those cached sets are capped at 250 compounds because they are shipped to a browser. For a Hansch model that cap
is fatal in a way that is easy to miss: 250 compounds spread over a diverse target fall into ~200 Butina clusters,
so every congeneric series is left with three or four members and nothing can be fitted inside one. A Hansch
model is not a model of a target, it is a model of a *series* - Hansch's own fits were ten to thirty congeners
sharing a core. Fitting six whole-molecule terms across 250 unrelated chemotypes gives what it gave here on hERG:
r2 = 0.16, q2 = 0.12. That is not a weak model, it is the wrong unit of analysis.

So this pulls the whole set, keeps the SMILES, and computes the real Bemis-Murcko scaffold for every compound.
Series then have enough members to fit, and the scaffold is a chemically meaningful grouping rather than a
distance-threshold artefact.

CLEANING, IN ORDER, ALL OF IT COUNTED IN THE LEDGER

  1. one standard_type per target, chosen as Ki if Ki has the most rows, else IC50 - never mixed, because a Ki
     and an IC50 are different numbers and averaging them is averaging two different experiments
  2. binding assays only (assay_type B), human target only
  3. an exact relation only: '>' and '<' rows are censored observations, not measurements
  4. a pchembl_value must be present (ChEMBL's own -log10 molar, so the units are fixed)
  5. structure standardised by ti/descriptors.standardise - salt off, neutral, no metals
  6. duplicate molecules merged by median; a molecule whose replicates span more than one log unit is dropped,
     because at that spread the median is not a measurement of anything
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from rdkit import Chem, RDLogger
from rdkit.Chem.Scaffolds import MurckoScaffold

sys.path.insert(0, str(Path(__file__).resolve().parent))
from descriptors import DESCRIPTORS, compute  # noqa: E402

RDLogger.DisableLog("rdApp.*")

CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
CACHE = Path(__file__).resolve().parent / "cache" / "train"
USER_AGENT = "drug-hansch-space/ti (research use; contact via repository)"
MAX_ROWS = 6000
LIABILITY_TARGET = "CHEMBL240"  # hERG / KCNH2, the cardiac liability used as the toxicity side of the index


def _get(url: str, retries: int = 4):
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(2.0 * (attempt + 1))
    return None


def _count(target_id: str, standard_type: str) -> int:
    url = (f"{CHEMBL}/activity?target_chembl_id={target_id}&standard_type={standard_type}"
           f"&assay_type=B&pchembl_value__isnull=false&format=json&limit=1")
    payload = _get(url)
    return int(payload["page_meta"]["total_count"]) if payload else 0


def fetch_target(target_id: str) -> dict | None:
    """Everything for one target: choose the type, page through, clean, describe. Returns the cacheable record."""
    counts = {t: _count(target_id, t) for t in ("Ki", "IC50")}
    standard_type = max(counts, key=lambda t: counts[t])
    if counts[standard_type] < 40:
        return {"target_id": target_id, "skipped": f"only {counts} usable rows in ChEMBL", "rows": []}

    raw, offset = [], 0
    while offset < min(counts[standard_type], MAX_ROWS):
        url = (f"{CHEMBL}/activity?target_chembl_id={target_id}&standard_type={standard_type}"
               f"&assay_type=B&pchembl_value__isnull=false&format=json&limit=1000&offset={offset}"
               f"&only=molecule_chembl_id,canonical_smiles,pchembl_value,standard_relation,"
               f"standard_type,target_organism,assay_chembl_id")
        payload = _get(url)
        if not payload or not payload.get("activities"):
            break
        raw.extend(payload["activities"])
        offset += 1000

    ledger = defaultdict(int)
    ledger["rows from ChEMBL"] = len(raw)
    by_molecule: dict[str, list] = defaultdict(list)
    smiles_of: dict[str, str] = {}
    organism = None
    for row in raw:
        organism = organism or row.get("target_organism")
        if (row.get("standard_relation") or "=") != "=":
            ledger["censored relation (> or <)"] += 1
            continue
        if not row.get("canonical_smiles") or row.get("pchembl_value") in (None, ""):
            ledger["no structure or no pchembl"] += 1
            continue
        molecule = row["molecule_chembl_id"]
        by_molecule[molecule].append(float(row["pchembl_value"]))
        smiles_of.setdefault(molecule, row["canonical_smiles"])

    rows = []
    for molecule, values in by_molecule.items():
        if len(values) > 1:
            ledger["duplicates merged"] += len(values) - 1
            if max(values) - min(values) > 1.0:
                ledger["replicates spread over one log unit"] += 1
                continue
        data, note = compute(smiles_of[molecule])
        if data is None:
            ledger[f"structure refused: {note}"] += 1
            continue
        mol = Chem.MolFromSmiles(data["canonical_smiles"])
        scaffold = MurckoScaffold.MurckoScaffoldSmiles(mol=mol) if mol else ""
        rows.append({
            "molecule_chembl_id": molecule,
            "y": round(statistics.median(values), 3),
            "scaffold": scaffold or "(acyclic)",
            **{k: round(float(data[k]), 4) for k in DESCRIPTORS},
            "canonical_smiles": data["canonical_smiles"],
        })

    ledger["kept"] = len(rows)
    return {
        "target_id": target_id,
        "organism": organism,
        "standard_type": standard_type,
        "assay_type": "B",
        "activity_units": f"p{standard_type} (-log10 mol/L, ChEMBL pchembl_value)",
        "counts_by_type": counts,
        "ledger": dict(ledger),
        "rows": rows,
    }


def pull(target_ids: list[str], workers: int = 4) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [t for t in target_ids if not (CACHE / f"{t}.json").exists()]
    print(f"{len(target_ids)} targets requested, {len(todo)} not yet cached", file=sys.stderr)

    def work(target_id: str):
        record = fetch_target(target_id)
        if record is not None:
            (CACHE / f"{target_id}.json").write_text(json.dumps(record, indent=0, sort_keys=True), encoding="utf-8")
        return target_id, (record or {}).get("ledger", {}).get("kept", 0)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for target_id, kept in pool.map(work, todo):
            print(f"  {target_id}: {kept} compounds", file=sys.stderr)

    summary = {}
    for target_id in target_ids:
        path = CACHE / f"{target_id}.json"
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            summary[target_id] = len(record.get("rows", []))
    return summary


def targets_from_resolved(top: int) -> list[str]:
    path = Path(__file__).resolve().parent / "cache" / "resolved.json"
    if not path.exists():
        raise SystemExit("run ti/resolve.py --out ti/cache/resolved.json first")
    data = json.loads(path.read_text(encoding="utf-8"))
    counts = defaultdict(int)
    for mol in data["molecules"]:
        if mol.get("target_chembl_id"):
            counts[mol["target_chembl_id"]] += 1
    ranked = [t for t, _ in sorted(counts.items(), key=lambda kv: -kv[1])][:top]
    if LIABILITY_TARGET not in ranked:
        ranked.append(LIABILITY_TARGET)
    print(f"{len(counts)} distinct targets in the batch; taking the top {top} plus the liability target",
          file=sys.stderr)
    return ranked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--targets", nargs="*", default=[])
    ap.add_argument("--from-resolved", action="store_true")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if args.report:
        for path in sorted(CACHE.glob("CHEMBL*.json")):
            record = json.loads(path.read_text(encoding="utf-8"))
            print(f"{record['target_id']:16s} {len(record.get('rows', [])):5d} compounds  "
                  f"{record.get('standard_type', '-')}  {record.get('skipped', '')}")
        return 0

    ids = list(args.targets)
    if args.from_resolved:
        ids += targets_from_resolved(args.top)
    if not ids:
        ap.error("give --targets or --from-resolved")
    summary = pull(sorted(set(ids)))
    print(f"\n{len(summary)} targets cached, {sum(summary.values())} compounds in total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
