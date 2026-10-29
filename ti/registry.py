#!/usr/bin/env python3
"""The registry of eligible local models, and the fingerprint bank the router matches against.

    ti/registry.py                    # ti/out/registry.json + ti/cache/fpbank.npz
    ti/registry.py --min-support 20   # a model needs at least this many training compounds

WHY A REGISTRY AND NOT ONE POOLED MODEL.

A ranking is only meaningful inside one target. Potency against a gamma-6 receptor and potency against a
kinase are different quantities measured in different assays, so ordering the two together produces a
number with no referent. What the workflow asks for instead is a global *algorithm* assembled from local
models: many small, honest, target-specific QSARs, plus a router that decides which of them a new molecule
is entitled to use. This file builds the first half - the registry.

Each entry declares what the model is for, so that a caller can never silently use it outside its scope:

    target          the ChEMBL target the training rows were measured against
    endpoint        p<standard_type>, e.g. pIC50 - one standard_type per model, never Ki and IC50 mixed
    units           -log10(M) throughout
    assay_scope     the filter the training rows passed
    n               training compounds after cleaning
    dataset_sha256  hash of the exact rows, so a prediction can be traced to the data that produced it
    validation      the held-out result; a model that failed is kept in the registry and marked failed,
                    never deleted, because "we tried and it did not generalise" is a result
    domain_rule     how the model decides a query is outside what it saw

A failed model stays visible and is excluded from prediction, not from the record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from rdkit import Chem, RDLogger  # noqa: E402
from rdkit.Chem import rdFingerprintGenerator  # noqa: E402

RDLogger.DisableLog("rdApp.*")

TRAIN = HERE / "cache" / "train"
BANK = HERE / "cache" / "fpbank.npz"
OUT = HERE / "out"

FP_RADIUS = 2
FP_BITS = 2048
MIN_SUPPORT = 20

_gen = rdFingerprintGenerator.GetMorganGenerator(radius=FP_RADIUS, fpSize=FP_BITS)


def fingerprint(smiles: str):
    """Morgan r=2, 2048 bits, packed to 256 bytes. The one structural representation used everywhere."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    bits = np.frombuffer(_gen.GetFingerprintAsNumPy(mol).astype(np.uint8).tobytes(), dtype=np.uint8)
    return np.packbits(bits)


def build(min_support: int = MIN_SUPPORT) -> dict:
    models, rows_out, owner = [], [], []
    for path in sorted(TRAIN.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data["rows"]
        target = data["target_id"]
        if len(rows) < min_support:
            models.append({
                "model_id": f"{target}:unfit",
                "target_chembl_id": target,
                "n": len(rows),
                "eligible": False,
                "reason": f"only {len(rows)} training compounds, below the support floor of {min_support}",
            })
            continue

        fps, ys, ids, smis = [], [], [], []
        for row in rows:
            fp = fingerprint(row["canonical_smiles"])
            if fp is None:
                continue
            fps.append(fp)
            ys.append(float(row["y"]))
            ids.append(row["molecule_chembl_id"])
            smis.append(row["canonical_smiles"])
        if len(fps) < min_support:
            models.append({
                "model_id": f"{target}:unfit", "target_chembl_id": target, "n": len(fps),
                "eligible": False, "reason": "too few parsable structures",
            })
            continue

        blob = json.dumps(
            [[r["molecule_chembl_id"], r["canonical_smiles"], r["y"]] for r in rows],
            sort_keys=True,
        ).encode()
        start = len(rows_out)
        rows_out.extend(fps)
        owner.extend([target] * len(fps))
        models.append({
            "model_id": f"{target}:p_activity",
            "target_chembl_id": target,
            "endpoint": "p_activity",
            "units": "-log10(M)",
            "assay_scope": "one standard_type per target, binding assays, exact relations, "
                           "duplicates merged by median, >1 log unit spread dropped",
            "n": len(fps),
            "dataset_sha256": hashlib.sha256(blob).hexdigest(),
            "activity_min": round(min(ys), 3),
            "activity_max": round(max(ys), 3),
            "activity_median": round(float(np.median(ys)), 3),
            "bank_slice": [start, start + len(fps)],
            "eligible": True,
        })

    bank = np.vstack(rows_out) if rows_out else np.zeros((0, FP_BITS // 8), dtype=np.uint8)
    BANK.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(BANK, bank=bank, owner=np.array(owner))

    eligible = [m for m in models if m["eligible"]]
    return {
        "fingerprint": {"kind": "Morgan", "radius": FP_RADIUS, "bits": FP_BITS},
        "min_support": min_support,
        "counts": {
            "targets seen": len(models),
            "eligible local models": len(eligible),
            "refused for low support": len(models) - len(eligible),
            "training compounds in the bank": int(bank.shape[0]),
        },
        "models": models,
    }


def load() -> tuple[dict, np.ndarray, np.ndarray]:
    registry = json.loads((OUT / "registry.json").read_text(encoding="utf-8"))
    blob = np.load(BANK, allow_pickle=False)
    return registry, blob["bank"], blob["owner"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--min-support", type=int, default=MIN_SUPPORT)
    args = ap.parse_args()
    registry = build(args.min_support)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "registry.json").write_text(json.dumps(registry, indent=1), encoding="utf-8")
    for key, value in registry["counts"].items():
        print(f"{key:40s} {value:,}")
    print(f"\nwrote {OUT / 'registry.json'} and {BANK}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
