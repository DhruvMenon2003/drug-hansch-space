"""Structure standardisation, computed descriptors, property rules, cliffs, and selection.

Everything here is *computed*, not measured, and is tagged that way so a reader can never
mistake a Crippen log P for a shake-flask one. The Hansch block in `series.py` uses
tabulated experimental substituent constants instead; these descriptors serve Tiers 3 and 4
only, as the plan says.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass, field

import numpy as np
from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdFingerprintGenerator, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize

RDLogger.DisableLog("rdApp.*")

SOURCE_TYPE = "computed"

# One curated block rather than every RDKit descriptor: each of these is interpretable, and a
# wall of 200 correlated columns would make the genetic algorithm's job meaningless.
DESCRIPTORS: dict[str, object] = {
    "cLogP": Crippen.MolLogP,
    "cMR": Crippen.MolMR,
    "TPSA": rdMolDescriptors.CalcTPSA,
    "MolWt": Descriptors.MolWt,
    "HeavyAtoms": lambda m: float(m.GetNumHeavyAtoms()),
    "HBD": rdMolDescriptors.CalcNumHBD,
    "HBA": rdMolDescriptors.CalcNumHBA,
    "RotBonds": rdMolDescriptors.CalcNumRotatableBonds,
    "Rings": rdMolDescriptors.CalcNumRings,
    "AromaticRings": rdMolDescriptors.CalcNumAromaticRings,
    "FractionCSP3": rdMolDescriptors.CalcFractionCSP3,
    "Heteroatoms": lambda m: float(rdMolDescriptors.CalcNumHeteroatoms(m)),
    "LabuteASA": rdMolDescriptors.CalcLabuteASA,
    "BalabanJ": Descriptors.BalabanJ,
    "BertzCT": Descriptors.BertzCT,
    "HallKierAlpha": rdMolDescriptors.CalcHallKierAlpha,
    "Kappa1": rdMolDescriptors.CalcKappa1,
    "Kappa2": rdMolDescriptors.CalcKappa2,
    "Kappa3": rdMolDescriptors.CalcKappa3,
    "Chi0v": rdMolDescriptors.CalcChi0v,
    "Chi1v": rdMolDescriptors.CalcChi1v,
    "Chi2v": rdMolDescriptors.CalcChi2v,
    "Chi3v": rdMolDescriptors.CalcChi3v,
    "QED": QED.qed,
}

LIPOPHILICITY_PAIR = ("cLogP", "cLogP_sq")


def descriptor_names(parabolic: bool = True) -> list[str]:
    names = list(DESCRIPTORS)
    if parabolic:
        names.insert(names.index("cLogP") + 1, "cLogP_sq")
    return names


def descriptor_block(smiles: list[str], parabolic: bool = True
                     ) -> tuple[np.ndarray, list[str], list[int]]:
    """Returns (X, names, indices of the rows that could be computed)."""
    names = descriptor_names(parabolic)
    rows, ok = [], []
    for i, smi in enumerate(smiles):
        mol = Chem.MolFromSmiles(smi)
        if mol is None:
            continue
        vals = {k: float(f(mol)) for k, f in DESCRIPTORS.items()}
        if parabolic:
            vals["cLogP_sq"] = vals["cLogP"] ** 2
        row = [vals[n] for n in names]
        if not all(math.isfinite(v) for v in row):
            continue
        rows.append(row)
        ok.append(i)
    return np.asarray(rows, dtype=float), names, ok


def lipophilicity_group(names: list[str]) -> list[tuple[int, ...]]:
    """The (cLogP, cLogP^2) columns as one selection unit, per the project's logP rule."""
    if all(n in names for n in LIPOPHILICITY_PAIR):
        return [tuple(names.index(n) for n in LIPOPHILICITY_PAIR)]
    return []


# ---------------------------------------------------------------------------------------
# Standardisation
# ---------------------------------------------------------------------------------------

@dataclass
class Standardised:
    compound_id: str
    before: str
    after: str
    inchikey: str
    changed: bool
    note: str = ""


def standardise(records: list[dict], smiles_key: str = "smiles",
                id_key: str = "compound_id") -> tuple[list[Standardised], dict]:
    """Largest fragment, neutralise, canonical tautomer - counted before and after."""
    chooser = rdMolStandardize.LargestFragmentChooser()
    uncharger = rdMolStandardize.Uncharger()
    tauto = rdMolStandardize.TautomerEnumerator()
    out, stats = [], collections.Counter()
    for rec in records:
        smi = rec[smiles_key]
        mol = Chem.MolFromSmiles(smi)
        if mol is None:
            out.append(Standardised(rec[id_key], smi, "", "", False, "unparseable SMILES"))
            stats["unparseable"] += 1
            continue
        steps = []
        n_frags = len(Chem.GetMolFrags(mol))
        if n_frags > 1:
            mol = chooser.choose(mol)
            steps.append(f"largest of {n_frags} fragments")
        charged = any(a.GetFormalCharge() for a in mol.GetAtoms())
        if charged:
            neutral = uncharger.uncharge(mol)
            if Chem.MolToSmiles(neutral) != Chem.MolToSmiles(mol):
                mol = neutral
                steps.append("neutralised")
        canon = tauto.Canonicalize(mol)
        if Chem.MolToSmiles(canon) != Chem.MolToSmiles(mol):
            mol = canon
            steps.append("canonical tautomer")
        after = Chem.MolToSmiles(mol)
        for s in steps:
            stats[s.split(" of ")[0]] += 1
        out.append(Standardised(rec[id_key], smi, after, Chem.MolToInchiKey(mol),
                                after != Chem.MolToSmiles(Chem.MolFromSmiles(smi)),
                                "; ".join(steps)))
    stats["changed"] = sum(1 for s in out if s.changed)
    stats["total"] = len(out)
    return out, dict(stats)


# ---------------------------------------------------------------------------------------
# Property rules: flagged, never removed
# ---------------------------------------------------------------------------------------

def property_rule_flags(smiles: str) -> dict:
    """Lipinski Ro5, Astex Ro3 and the Pfizer 3/75 rule. A violation is a flag, not a verdict.

    Removing a compound for failing a developability heuristic would bias the very
    structure-activity relationship being fitted, so these travel with the row.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return {}
    logp = Crippen.MolLogP(mol)
    mw = Descriptors.MolWt(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    rot = rdMolDescriptors.CalcNumRotatableBonds(mol)
    ro5 = sum([mw > 500, logp > 5, hbd > 5, hba > 10])
    ro3 = sum([mw > 300, logp > 3, hbd > 3, hba > 3, rot > 3])
    return {"ro5_violations": ro5, "ro5_pass": ro5 <= 1,
            "ro3_violations": ro3, "ro3_pass": ro3 == 0,
            "pfizer_3_75_risk": bool(logp > 3 and tpsa < 75),
            "cLogP": logp, "MolWt": mw, "TPSA": tpsa, "HBD": hbd, "HBA": hba, "RotBonds": rot}


# ---------------------------------------------------------------------------------------
# Matched molecular pairs and activity cliffs
# ---------------------------------------------------------------------------------------

def _fp_gen(radius: int = 2, bits: int = 2048):
    return rdFingerprintGenerator.GetMorganGenerator(radius=radius, fpSize=bits)


def fingerprints(smiles: list[str], radius: int = 2, bits: int = 2048) -> list:
    gen = _fp_gen(radius, bits)
    out = []
    for smi in smiles:
        mol = Chem.MolFromSmiles(smi)
        out.append(None if mol is None else gen.GetFingerprint(mol))
    return out


@dataclass
class Cliff:
    a: str
    b: str
    similarity: float
    delta: float
    sali: float
    position: str = ""


def activity_cliffs(ids: list[str], smiles: list[str], y: list[float],
                    similarity_min: float = 0.8, delta_min: float = 1.0
                    ) -> tuple[list[Cliff], dict]:
    """Near-neighbour pairs with a large potency gap, scored by SALI.

    SALI = |delta y| / (1 - Tanimoto). A pair at similarity 1.0 would divide by zero, so the
    denominator is floored at a thousandth of a similarity unit and the pair is reported as
    the near-identical structure it is. The returned statistics say how many pairs were
    examined and how many were near neighbours at all, so "no cliffs" can be told apart
    from "no near neighbours to have a cliff between".
    """
    fps = fingerprints(smiles)
    out: list[Cliff] = []
    pairs = neighbours = 0
    best_sim = 0.0
    for i in range(len(ids)):
        if fps[i] is None:
            continue
        for j in range(i + 1, len(ids)):
            if fps[j] is None:
                continue
            pairs += 1
            sim = DataStructs.TanimotoSimilarity(fps[i], fps[j])
            best_sim = max(best_sim, sim)
            if sim < similarity_min:
                continue
            neighbours += 1
            d = abs(float(y[i]) - float(y[j]))
            if d < delta_min:
                continue
            out.append(Cliff(ids[i], ids[j], sim, d, d / max(1.0 - sim, 1e-3)))
    out.sort(key=lambda c: -c.sali)
    stats = {"pairs_examined": pairs, "near_neighbour_pairs": neighbours,
             "cliffs": len(out), "similarity_min": similarity_min,
             "delta_min": delta_min, "highest_similarity_seen": best_sim}
    return out, stats


def series_cliffs(series, y_by_id: dict[str, float], delta_min: float = 1.0) -> list[Cliff]:
    """Cliffs inside one congeneric series: members differing at exactly one position.

    This is the matched molecular pair in its strict sense - one structural change, one
    potency change - which is what makes the comparison interpretable at all.
    """
    positions = series.varying_positions() or series.positions
    out: list[Cliff] = []
    members = [m for m in series.members if m in y_by_id]
    for i, a in enumerate(members):
        for b in members[i + 1:]:
            diff = [p for p in positions if series.r_groups[a][p] != series.r_groups[b][p]]
            if len(diff) != 1:
                continue
            d = abs(y_by_id[a] - y_by_id[b])
            if d < delta_min:
                continue
            p = diff[0]
            out.append(Cliff(a, b, float("nan"), d, float("nan"),
                             f"{p}: {series.r_groups[a][p]} -> {series.r_groups[b][p]}"))
    out.sort(key=lambda c: -c.delta)
    return out


# ---------------------------------------------------------------------------------------
# Feature selection: the board's genetic algorithm, minimising intercorrelation
# ---------------------------------------------------------------------------------------

@dataclass
class GAResult:
    columns: tuple[int, ...]
    names: list[str]
    fitness: float
    q2: float
    mean_abs_r: float
    history: list[float] = field(default_factory=list)
    generations: int = 0


def mean_abs_intercorrelation(X: np.ndarray, cols) -> float:
    cols = list(cols)
    if len(cols) < 2:
        return 0.0
    sub = X[:, cols]
    keep = [k for k in range(sub.shape[1]) if sub[:, k].std() > 0]
    if len(keep) < 2:
        return 0.0
    c = np.corrcoef(sub[:, keep], rowvar=False)
    iu = np.triu_indices_from(c, k=1)
    return float(np.nanmean(np.abs(c[iu])))


def genetic_feature_selection(X: np.ndarray, y: np.ndarray, names: list[str],
                              fitness_fn, max_features: int,
                              groups: list[tuple[int, ...]] | None = None,
                              population: int = 60, generations: int = 40,
                              correlation_penalty: float = 0.35,
                              mutation: float = 0.12, elite: int = 6,
                              seed: int = 0) -> GAResult:
    """Binary-mask GA over selection units, scoring quality minus mean |r| among the picks.

    `fitness_fn(X_sub, y) -> float` is supplied by the caller so the GA never decides what
    "good" means; the penalty term is the board's instruction to minimise intercorrelation.
    Units come from the same grouping rule as subset selection, so a parabolic pair is one
    gene and can never be half-selected.
    """
    from qsar_core import _units  # same unit rule as best_subset_aicc

    units = _units(X.shape[1], groups)
    rng = np.random.default_rng(seed)
    n_units = len(units)
    cap = min(max_features, n_units)

    def columns_of(mask) -> tuple[int, ...]:
        return tuple(j for k, u in enumerate(units) if mask[k] for j in u)

    def score(mask) -> tuple[float, float, float]:
        cols = columns_of(mask)
        if not cols:
            return -1e9, float("nan"), float("nan")
        q = fitness_fn(X[:, list(cols)], y)
        r = mean_abs_intercorrelation(X, cols)
        return q - correlation_penalty * r, q, r

    def random_mask():
        k = int(rng.integers(1, cap + 1))
        m = np.zeros(n_units, dtype=bool)
        m[rng.permutation(n_units)[:k]] = True
        return m

    def repair(m):
        on = np.flatnonzero(m)
        if len(on) == 0:
            m[rng.integers(n_units)] = True
        elif len(on) > cap:
            m[rng.permutation(on)[cap:]] = False
        return m

    pop = [random_mask() for _ in range(population)]
    scored = [(score(m)[0], m) for m in pop]
    history = []
    for _ in range(generations):
        scored.sort(key=lambda t: -t[0])
        history.append(scored[0][0])
        nxt = [m for _, m in scored[:elite]]
        while len(nxt) < population:
            a, b = (scored[int(rng.integers(0, max(2, population // 2)))][1] for _ in range(2))
            cut = int(rng.integers(1, n_units)) if n_units > 1 else 1
            child = np.concatenate([a[:cut], b[cut:]]).copy()
            flip = rng.random(n_units) < mutation
            child[flip] = ~child[flip]
            nxt.append(repair(child))
        scored = [(score(m)[0], m) for m in nxt]
    scored.sort(key=lambda t: -t[0])
    best = scored[0][1]
    fit, q, r = score(best)
    history.append(fit)
    cols = columns_of(best)
    return GAResult(cols, [names[i] for i in cols], fit, q, r, history, generations)


# ---------------------------------------------------------------------------------------
# Atom-level attribution and similarity maps
# ---------------------------------------------------------------------------------------

def atom_weights(mol, predict, radius: int = 2, bits: int = 2048) -> list[float]:
    """Per-atom contribution: the prediction minus the prediction with that atom masked out.

    This is what RDKit's own similarity-map helper does internally; doing it here means the
    weights can be inspected, reused and tested without depending on a drawing call.
    `predict` takes one fingerprint bit vector and returns a number.
    """
    import warnings
    from rdkit.Chem.Draw import SimilarityMaps

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        full = float(predict(SimilarityMaps.GetMorganFingerprint(
            mol, radius=radius, fpType="bv", nBits=bits)))
        out = []
        for i in range(mol.GetNumAtoms()):
            masked = SimilarityMaps.GetMorganFingerprint(
                mol, atomId=i, radius=radius, fpType="bv", nBits=bits)
            out.append(full - float(predict(masked)))
    return out


def similarity_map_png(mol, weights: list[float], size: tuple[int, int] = (460, 400)) -> bytes:
    """A similarity map as PNG bytes, across the RDKit versions that changed this signature.

    RDKit 2023 and later require an explicit drawer; older releases return a matplotlib
    figure. Both paths are taken here so the notebook renders on whatever Colab ships.
    """
    import warnings
    from rdkit.Chem.Draw import SimilarityMaps, rdMolDraw2D

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            d = rdMolDraw2D.MolDraw2DCairo(*size)
            SimilarityMaps.GetSimilarityMapFromWeights(mol, list(weights), draw2d=d)
            d.FinishDrawing()
            return d.GetDrawingText()
        except TypeError:
            import io
            fig = SimilarityMaps.GetSimilarityMapFromWeights(mol, list(weights), colorMap="bwr")
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
            return buf.getvalue()
