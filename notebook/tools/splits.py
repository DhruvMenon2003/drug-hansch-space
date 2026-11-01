"""One split object, built once and reused by every tier, plus the applicability domain.

Comparing four tiers on four different splits would compare the splits, not the tiers. So
the split is made once here - Bemis-Murcko scaffold clusters, with a Tanimoto cutoff that
keeps a test molecule from being a near-duplicate of a training one - and every tier is
handed the same object.
"""
from __future__ import annotations

import collections
from dataclasses import dataclass, field

import numpy as np
from rdkit import DataStructs, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

RDLogger.DisableLog("rdApp.*")


def scaffold_of(smiles: str) -> str | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return MurckoScaffold.MurckoScaffoldSmiles(mol=mol)


def scaffold_clusters(ids: list[str], smiles: list[str]) -> dict[str, str]:
    """compound id -> scaffold SMILES. The scaffold is the grouping GroupKFold respects."""
    out = {}
    for cid, smi in zip(ids, smiles):
        sc = scaffold_of(smi)
        if sc is not None:
            out[cid] = sc
    return out


@dataclass
class Split:
    train: list[str]
    test: list[str]
    groups: dict[str, str]
    folds: list[tuple[list[str], list[str]]] = field(default_factory=list)
    near_duplicates_moved: list[tuple[str, str, float]] = field(default_factory=list)
    report: dict = field(default_factory=dict)


def _fps(smiles: list[str]):
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    out = []
    for smi in smiles:
        m = Chem.MolFromSmiles(smi)
        out.append(None if m is None else gen.GetFingerprint(m))
    return out


def scaffold_split(ids: list[str], smiles: list[str], test_fraction: float = 0.25,
                   tanimoto_cutoff: float = 0.95, n_folds: int = 5,
                   seed: int = 0) -> Split:
    """Whole scaffolds to one side or the other, largest first, then a near-duplicate sweep.

    Assigning whole scaffolds means a test compound never shares its core with a training
    one. The sweep afterwards catches the remaining case the scaffold rule cannot see: two
    different cores whose whole molecules are still near-identical by fingerprint. Such a
    test compound is moved into training, and the move is recorded.
    """
    groups = scaffold_clusters(ids, smiles)
    by_scaffold: dict[str, list[str]] = collections.defaultdict(list)
    for cid in ids:
        if cid in groups:
            by_scaffold[groups[cid]].append(cid)
    order = sorted(by_scaffold, key=lambda s: (-len(by_scaffold[s]), s))
    target = int(round(test_fraction * sum(len(v) for v in by_scaffold.values())))
    test: list[str] = []
    # Largest scaffolds to training, so the test set is the sparse chemotypes: the harder
    # and more honest direction for a scaffold split.
    for sc in reversed(order):
        if len(test) >= target:
            break
        test.extend(by_scaffold[sc])
    test_set = set(test)
    train = [c for c in ids if c in groups and c not in test_set]

    smi_of = dict(zip(ids, smiles))
    fp_train = _fps([smi_of[c] for c in train])
    moved = []
    for cid in list(test):
        fp = _fps([smi_of[cid]])[0]
        if fp is None:
            continue
        sims = [(DataStructs.TanimotoSimilarity(fp, f), train[k])
                for k, f in enumerate(fp_train) if f is not None]
        if not sims:
            continue
        s, nearest = max(sims)
        if s >= tanimoto_cutoff:
            moved.append((cid, nearest, float(s)))
            test.remove(cid)
            train.append(cid)
    rng = np.random.default_rng(seed)
    split = Split(train=train, test=test, groups=groups, near_duplicates_moved=moved)
    split.folds = group_k_fold(train, groups, n_folds=n_folds, seed=seed)
    split.report = {
        "n_total": len(ids), "n_train": len(train), "n_test": len(test),
        "scaffolds_total": len(by_scaffold),
        "scaffolds_train": len({groups[c] for c in train}),
        "scaffolds_test": len({groups[c] for c in test}),
        "shared_scaffolds": len({groups[c] for c in train} & {groups[c] for c in test}),
        "near_duplicates_moved": len(moved),
        "tanimoto_cutoff": tanimoto_cutoff,
        "folds": len(split.folds),
        "fold_sizes": [len(te) for _, te in split.folds],
    }
    return split


def group_k_fold(ids: list[str], groups: dict[str, str], n_folds: int = 5,
                 seed: int = 0) -> list[tuple[list[str], list[str]]]:
    """Folds over scaffold clusters: a scaffold is never split across a fold boundary.

    Written out rather than imported so the assignment rule is visible: scaffolds are taken
    largest first and each goes to whichever fold is currently smallest, which balances fold
    sizes without ever cutting a cluster in two.
    """
    members: dict[str, list[str]] = collections.defaultdict(list)
    for cid in ids:
        if cid in groups:
            members[groups[cid]].append(cid)
    buckets: list[list[str]] = [[] for _ in range(n_folds)]
    for sc in sorted(members, key=lambda s: (-len(members[s]), s)):
        smallest = min(range(n_folds), key=lambda k: (len(buckets[k]), k))
        buckets[smallest].extend(members[sc])
    folds = []
    for k in range(n_folds):
        test = buckets[k]
        train = [c for j in range(n_folds) if j != k for c in buckets[j]]
        if test and train:
            folds.append((train, test))
    return folds


# ---------------------------------------------------------------------------------------
# Applicability domain
# ---------------------------------------------------------------------------------------

@dataclass
class Domain:
    h_star: float
    leverage: np.ndarray
    inside_leverage: np.ndarray
    inside_box: np.ndarray
    inside_both: np.ndarray
    lower: np.ndarray
    upper: np.ndarray
    report: dict = field(default_factory=dict)


def applicability_domain(X_train: np.ndarray, X_query: np.ndarray,
                         percentile: float = 1.0) -> Domain:
    """Hat leverage against 3p/n, and a percentile bounding box over the training ranges.

    Two criteria because they fail differently: leverage catches a compound far from the
    training centroid in the fitted space, the box catches one outside the observed range of
    any single descriptor. A prediction outside either is labelled, not quietly reported.
    """
    from qsar_core import leverage_of

    Xtr = np.asarray(X_train, dtype=float)
    Xq = np.asarray(X_query, dtype=float)
    if Xtr.ndim == 1:
        Xtr, Xq = Xtr.reshape(-1, 1), Xq.reshape(-1, 1)
    p = Xtr.shape[1]
    h_star = 3.0 * (p + 1) / len(Xtr)
    lev = leverage_of(Xtr, Xq)
    lower = np.percentile(Xtr, percentile, axis=0)
    upper = np.percentile(Xtr, 100.0 - percentile, axis=0)
    in_box = np.all((Xq >= lower) & (Xq <= upper), axis=1)
    in_lev = lev <= h_star
    dom = Domain(h_star=h_star, leverage=lev, inside_leverage=in_lev, inside_box=in_box,
                 inside_both=in_lev & in_box, lower=lower, upper=upper)
    dom.report = {"h_star": h_star, "percentile": percentile, "n_query": len(Xq),
                  "inside_leverage": int(in_lev.sum()), "inside_box": int(in_box.sum()),
                  "inside_both": int((in_lev & in_box).sum()),
                  "outside_either": int((~(in_lev & in_box)).sum())}
    return dom
