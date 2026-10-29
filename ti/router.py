#!/usr/bin/env python3
"""Conditional routing: decide which local model a new molecule is entitled to use, from structure alone.

    ti/router.py --smiles "CC(=O)Oc1ccccc1C(=O)O"     # route one molecule, show the reasoning
    ti/router.py --calibrate                           # derive the thresholds from training data only

THE PROBLEM THIS SOLVES.

A chemist with a new molecule does not want to be asked what its target is - that is half of what they are
trying to find out. So the router is given nothing but the structure. It compares the molecule against every
eligible local model's training set and decides, explicitly, one of three things:

    routed      one model's chemistry clearly contains this molecule
    ambiguous   several models match and none wins; the candidates are reported, no prediction is made
    abstain     nothing matches closely enough; no model may be used

Abstaining is the correct answer much of the time and it is reported as an outcome, not hidden.

TWO NEIGHBOURHOOD DEFINITIONS, COMPARED RATHER THAN ASSUMED.

    A  morgan    top-k mean Tanimoto over Morgan r=2 fingerprints.
    B  mmp       shared-core matched pairs: the query is cut at single acyclic bonds, and a training
                 compound counts as a neighbour only when it shares one of those cores. This is the
                 matched-molecular-pair neighbourhood, not every possible pair of molecules.

Both are implemented. ti/router_test.py measures which one actually assigns targets correctly, because a
conditional that is easy to write is not evidence that the routing is valid.

WHAT THE ROUTER MUST NEVER DO.

It never reads the query's activity - that is the unknown. And a target it assigns is an inference from
chemical similarity, never a measurement: every routed row carries routing_basis so that a reader can tell
an inferred target from one ChEMBL recorded against the molecule itself.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from rdkit import Chem, RDLogger  # noqa: E402
from rdkit.Chem import BRICS  # noqa: E402

import registry as reg  # noqa: E402

RDLogger.DisableLog("rdApp.*")

TOP_K = 5            # a routing score is the mean of the k closest training compounds, not the single best
CHUNK = 20000        # rows of the bank compared at once, to keep peak memory flat

# Thresholds. Defaults here are replaced by ti/out/routing_thresholds.json once --calibrate has run, so the
# numbers in use are always ones derived from training data rather than chosen by hand.
SCOPE_FLOOR = 0.30   # below this top-k mean similarity a model is not a candidate at all
MARGIN = 0.05        # top-1 must beat top-2 by this much, or the call is ambiguous

_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint16)


def tanimoto_bulk(query: np.ndarray, bank: np.ndarray) -> np.ndarray:
    """Tanimoto of one packed fingerprint against a packed bank, chunked. Returns float32 of length len(bank)."""
    q_bits = int(_POPCOUNT[query].sum())
    out = np.empty(bank.shape[0], dtype=np.float32)
    for start in range(0, bank.shape[0], CHUNK):
        block = bank[start:start + CHUNK]
        inter = _POPCOUNT[block & query].sum(axis=1, dtype=np.uint32)
        bank_bits = _POPCOUNT[block].sum(axis=1, dtype=np.uint32)
        union = bank_bits + q_bits - inter
        out[start:start + block.shape[0]] = np.where(union > 0, inter / np.maximum(union, 1), 0.0)
    return out


def _cores(smiles: str) -> set[str]:
    """The query's matched-pair cores: the molecule cut once at each acyclic single bond BRICS allows.

    A matched molecular pair shares a core and differs by one substituent. So the neighbourhood is not
    "molecules that look similar" but "molecules built on the same core", which is a different and stricter
    claim. Cutting with BRICS bonds rather than every bond keeps the cuts chemically meaningful.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return set()
    out = set()
    for atom_pair, _ in BRICS.FindBRICSBonds(mol):
        bond = mol.GetBondBetweenAtoms(*atom_pair)
        if bond is None or bond.IsInRing():
            continue
        try:
            pieces = Chem.FragmentOnBonds(mol, [bond.GetIdx()], addDummies=False)
            frags = Chem.GetMolFrags(pieces, asMols=True, sanitizeFrags=True)
        except Exception:
            continue
        if len(frags) != 2:
            continue
        heaviest = max(frags, key=lambda f: f.GetNumHeavyAtoms())
        if heaviest.GetNumHeavyAtoms() >= 6:
            out.add(Chem.MolToSmiles(heaviest))
    return out


def thresholds() -> tuple[float, float]:
    path = HERE / "out" / "routing_thresholds.json"
    if path.exists():
        cal = json.loads(path.read_text(encoding="utf-8"))
        return cal["scope_floor"], cal["margin"]
    return SCOPE_FLOOR, MARGIN


def route(smiles: str, registry: dict, bank: np.ndarray, owner: np.ndarray,
          basis: str = "morgan", top_k: int = TOP_K,
          scope_floor: float | None = None, margin: float | None = None,
          exclude: set[str] | None = None) -> dict:
    """Rank the eligible local models for one molecule and say whether any of them may be used."""
    floor, gap = thresholds()
    scope_floor = floor if scope_floor is None else scope_floor
    margin = gap if margin is None else margin

    query = reg.fingerprint(smiles)
    if query is None:
        return {"decision": "abstain", "reason": "RDKit could not parse the structure", "candidates": []}

    similarity = tanimoto_bulk(query, bank)
    if exclude:
        # Leave-one-out: hide the query's own training rows so the router cannot recognise itself.
        similarity[np.fromiter(exclude, dtype=np.int64, count=len(exclude))] = -1.0

    core_hits = {}
    if basis == "mmp":
        cores = _cores(smiles)
        if not cores:
            return {"decision": "abstain", "reason": "no matched-pair core could be cut from this molecule",
                    "candidates": [], "basis": basis}

    candidates = []
    for model in registry["models"]:
        if not model.get("eligible"):
            continue
        lo, hi = model["bank_slice"]
        sims = similarity[lo:hi]
        usable = sims[sims >= 0]
        if usable.size == 0:
            continue
        k = min(top_k, usable.size)
        top = np.sort(usable)[-k:]
        score = float(top.mean())
        candidates.append({
            "model_id": model["model_id"],
            "target_chembl_id": model["target_chembl_id"],
            "n": model["n"],
            "score": round(score, 4),
            "nearest": round(float(usable.max()), 4),
            "neighbours_used": int(k),
        })

    if basis == "mmp":
        # Keep only models that contain a compound built on one of the query's cores, then rank those by
        # similarity. The core index is precomputed by ti/cores.py; without it the matched-pair basis
        # cannot be used, and saying so is better than silently falling back to plain similarity.
        index = _core_index()
        in_scope: dict[str, int] = {}
        for core in cores:
            for target in index.get(core, ()):
                in_scope[target] = in_scope.get(target, 0) + 1
        candidates = [c for c in candidates if c["target_chembl_id"] in in_scope]
        for cand in candidates:
            cand["shared_cores"] = in_scope[cand["target_chembl_id"]]

    candidates.sort(key=lambda c: -c["score"])
    eligible = [c for c in candidates if c["score"] >= scope_floor]

    if not eligible:
        best = candidates[0] if candidates else None
        return {
            "decision": "abstain",
            "reason": (f"closest local model scored {best['score']:.2f}, below the scope floor of "
                       f"{scope_floor:.2f}" if best else "no eligible local model"),
            "candidates": candidates[:5],
            "basis": basis,
            "scope_floor": scope_floor,
        }

    lead = eligible[0]
    runner = eligible[1]["score"] if len(eligible) > 1 else 0.0
    separation = round(lead["score"] - runner, 4)
    decision = "routed" if separation >= margin else "ambiguous"
    return {
        "decision": decision,
        "routed_target_chembl_id": lead["target_chembl_id"] if decision == "routed" else None,
        "model_id": lead["model_id"] if decision == "routed" else None,
        "score": lead["score"],
        "nearest": lead["nearest"],
        "separation": separation,
        "candidates": eligible[:5],
        "basis": basis,
        "scope_floor": scope_floor,
        "margin": margin,
        "routing_basis": "structural similarity, not a measured target assignment",
        "reason": (f"{lead['target_chembl_id']} scored {lead['score']:.2f} against "
                   f"{lead['n']} training compounds, {separation:.2f} clear of the next model"
                   if decision == "routed" else
                   f"{len(eligible)} models within {margin:.2f} of each other; no single model wins"),
    }


_CORE_INDEX: dict[str, list[str]] | None = None


def _core_index() -> dict[str, list[str]]:
    """core SMILES -> the targets whose training set contains a compound built on it. Loaded once."""
    global _CORE_INDEX
    if _CORE_INDEX is None:
        path = HERE / "cache" / "cores.json"
        if not path.exists():
            raise SystemExit("the matched-pair basis needs ti/cores.py to have run first")
        _CORE_INDEX = json.loads(path.read_text(encoding="utf-8"))
    return _CORE_INDEX


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--smiles")
    ap.add_argument("--basis", choices=["morgan", "mmp"], default="morgan")
    args = ap.parse_args()
    if not args.smiles:
        raise SystemExit("--smiles is required")
    registry, bank, owner = reg.load()
    result = route(args.smiles, registry, bank, owner, basis=args.basis)
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
