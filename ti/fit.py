#!/usr/bin/env python3
"""Build and judge the models for one target: a Hansch model per congeneric series, plus one declared fallback.

    ti/fit.py --target CHEMBL240          # judge one target, printed
    ti/fit.py --all                       # fit every pulled target, cache the result
    ti/fit.py --report                    # what is cached

WHY TWO KINDS OF MODEL, WHICH IS THE WHOLE SCIENTIFIC POINT

A Hansch model is a model of a *series*, not of a target. Hansch's own fits were ten to thirty congeners sharing
one core, where only the substituent changes, so a handful of physicochemical terms really can carry the
structure-activity relationship and the clogp parabola really does locate an optimum.

Measured here on the full ChEMBL binding sets, scaffold-grouped so whole series are held out, the diverse-set
linear fit is worthless and the nonlinear one is not:

    hERG (CHEMBL240, n=5039, 2481 distinct Bemis-Murcko scaffolds)
        six Hansch terms, linear          q2 = 0.07     <- no predictive power at all
        sixteen descriptors, linear       q2 = 0.11
        sixteen descriptors, nonlinear    q2 = 0.32
    serotonin transporter (CHEMBL217)     q2 = 0.33 nonlinear, 0.17 on the six terms alone
    dopamine D2 (CHEMBL224)               q2 = 0.41 nonlinear, 0.19 on the six terms alone

Inside one congeneric series the linear form works, but only if it is fitted the way QSAR practice requires, and
getting that wrong is easy. Fitting all six terms to a 15-member series gave q2_LOO of -0.2, -3.4 and -30.8 here:
not a finding about chemistry, just six parameters memorising twenty points and then failing on the twenty-first.
Two corrections fix it, and both are standard rather than clever:

  1. CAP THE TERMS AT n/5. The Topliss-Costello rule: at least five compounds per variable, or chance
     correlation dominates. A 15-member series gets three terms, a 30-member series gets six.
  2. SELECT THE TERMS ON AICc, NOT ON q2. Picking the subset that maximises q2_LOO and then reporting that same
     q2_LOO as the model's predictivity is selection bias, and it is one of the most criticised errors in the
     QSAR literature: the number quoted is the maximum of many tries, not an estimate of anything. So the subset
     is chosen on corrected Akaike information - a fit criterion, computed without ever looking at held-out
     performance - and q2_LOO is then measured once on that subset and reported untouched.

The squared term is also centred, (clogp - mean)^2, which removes most of its collinearity with clogp itself.

Done that way, 72 of 543 candidate series across the pulled targets clear r2 >= 0.6 and q2_LOO >= 0.5, the best
of them at q2_LOO 0.83 to 0.95. Those are real Hansch models and they are where the mechanistic reading comes
from.

For a molecule in no validated series there is one declared fallback per target, on the same sixteen
descriptors, nonlinear. It is reported with its own scaffold-grouped q2 and labelled non-mechanistic, because it
is: it gives a number and no equation to read. It is not dressed up as a Hansch result. The ten descriptors
beyond the Hansch six earn their place there - dropping to the six costs the fallback half its predictivity.
The 202-descriptor RDKit pool was tried and is not used: q2 0.40 against 0.32 does not buy back the loss of a
small declared descriptor block.

EVERY NUMBER A MODEL EMITS CARRIES WHICH MODEL MADE IT AND WHETHER THE MOLECULE WAS INSIDE ITS DOMAIN.
That is OECD principle 3, and it is the difference between a prediction and a guess.
"""

from __future__ import annotations

import argparse
import itertools
import json
import pickle
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from descriptors import DESCRIPTORS, HANSCH_TERMS  # noqa: E402

HERE = Path(__file__).resolve().parent
TRAIN = HERE / "cache" / "train"
MODELS = HERE / "cache" / "models"

# A series needs enough members that six terms are not fitting noise: 15 keeps better than two members per term.
MIN_SERIES = 15
# Shared scaffold is necessary and not sufficient. Murcko reduction strips substituents, so every molecule whose
# only ring is a benzene collapses to "c1ccccc1" - 33 of them on hERG, and they are structurally unrelated. That
# is a bucket, not a series, and a Hansch fit over it means nothing. So a series must also BE congeneric: its
# members have to resemble each other. Median pairwise Tanimoto on Morgan r=2 is the direct test.
MIN_SERIES_SIMILARITY = 0.55
# Golbraikh-Tropsha style acceptance. A series model that misses any of these is reported and not used.
SERIES_GATES = {"min_r2": 0.6, "min_q2_loo": 0.5, "max_scramble_q2": 0.05}
# Topliss-Costello: at least this many compounds per fitted variable, or the fit is chance correlation.
COMPOUNDS_PER_TERM = 5
# The fallback is held to a lower bar because it is judged the hard way, with whole series held out, and is only
# ever used where no series model applies. Below this it is not used either.
FALLBACK_MIN_Q2 = 0.25
SCRAMBLES = 30
DOMAIN_K = 5
DOMAIN_PERCENTILE = 95


def _ols(X: np.ndarray, y: np.ndarray):
    A = np.column_stack([np.ones(len(X)), X])
    beta, *_ = np.linalg.lstsq(A, y, rcond=None)
    return beta


def _apply(beta: np.ndarray, X: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(len(X)), X]) @ beta


def _r2(y: np.ndarray, pred: np.ndarray) -> float:
    ss_res = float(np.sum((y - pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0


def series_similarity(rows: list[dict]) -> tuple[float, float]:
    """(median, membership floor) of the pairwise Tanimoto inside a candidate series.

    Two different numbers, for two different jobs, and sharing one constant between them was a mistake worth
    recording.

    The *median* certifies the group: a low median means a scaffold bucket, not a congeneric set, and it is
    compared against the fixed MIN_SERIES_SIMILARITY gate. That is a statement about the group.

    The *floor* admits a new molecule to the group, and it cannot be the same fixed number. A molecule at the
    edge of a congeneric series is still a member of it. Judged against a flat 0.55, 9-aminocamptothecin scored
    0.535 against the validated camptothecin series and silatecan 0.549 - both true camptothecins, both refused
    by a hundredth. So the bar is taken from the series itself: the 10th percentile of its own pairwise
    similarities, i.e. 'at least as much a member as the least typical member already in it'. Self-calibrating,
    the same shape as the kNN percentile domain used for the fallback, and it still refuses what it should -
    edotecarin and becatecarin score 0.10 against that series, because they are indolocarbazoles, not
    camptothecins, and they go to the fallback.
    """
    from rdkit import DataStructs

    fps = _fingerprints([row["canonical_smiles"] for row in rows])
    if len(fps) < 2:
        return 0.0, 1.0
    sims = []
    for i in range(1, len(fps)):
        sims.extend(DataStructs.BulkTanimotoSimilarity(fps[i], fps[:i]))
    return float(np.median(sims)), float(np.percentile(sims, 10))


def _fingerprints(smiles_list: list[str]) -> list:
    from rdkit import Chem, RDLogger
    from rdkit.Chem import rdFingerprintGenerator

    RDLogger.DisableLog("rdApp.*")
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    out = []
    for smiles in smiles_list:
        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            out.append(gen.GetFingerprint(mol))
    return out


def belongs_to(series: dict, smiles: str) -> float:
    """Median Tanimoto from one molecule to the members of one series. The membership test at prediction time.

    This is the same measurement, on the same fingerprint, that decided the series was congeneric in the first
    place. That symmetry is the point: a series model's applicability domain is 'molecules of this series', and
    membership of a chemical series is a similarity statement, not a string match on a reduced skeleton.

    Exact scaffold equality was the first implementation and it was wrong in a way worth recording. Topotecan
    and irinotecan reduce to O=C1CCc2cc3n(c(=O)c2CO1)Cc1cc2ccccc2nc1-3; the validated camptothecin series
    reduces to ...cc2ccncc2nc1-3. One ring nitrogen apart, the same chemotype, and exact matching refused them.
    Every approved drug in the batch was refused that way, so the interpretable tier contributed nothing at all.
    """
    from rdkit import DataStructs

    fps = series.get("_fps")
    if fps is None:
        fps = series["_fps"] = _fingerprints(series.get("_members", []))
    query = _fingerprints([smiles])
    if not fps or not query:
        return 0.0
    return float(np.median(DataStructs.BulkTanimotoSimilarity(query[0], fps)))


def _aicc(X: np.ndarray, y: np.ndarray) -> float:
    """Corrected Akaike information. Penalises parameters, and the correction matters at these sample sizes."""
    n, k = len(y), X.shape[1] + 1
    rss = float(np.sum((y - _apply(_ols(X, y), X)) ** 2))
    if rss <= 0 or n - k - 1 <= 0:
        return float("inf")
    return n * np.log(rss / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1)


def _terms_of(rows: list[dict]) -> dict:
    """The six candidate terms for one series, with the square centred to break its collinearity with clogp."""
    logp = np.array([float(r["clogp"]) for r in rows])
    out = {"clogp": logp, "clogp_sq": (logp - logp.mean()) ** 2}
    for term in HANSCH_TERMS:
        if term not in out:
            out[term] = np.array([float(r[term]) for r in rows])
    return out


def _q2_loo(X: np.ndarray, y: np.ndarray) -> float:
    n = len(y)
    pred = np.empty(n)
    for i in range(n):
        keep = np.arange(n) != i
        pred[i] = _apply(_ols(X[keep], y[keep]), X[i:i + 1])[0]
    return _r2(y, pred)


def select_terms(columns: dict, y: np.ndarray) -> tuple | None:
    """Choose the term subset on AICc alone, with at most n/5 terms. q2 never participates in this choice."""
    n = len(y)
    limit = max(1, min(len(HANSCH_TERMS), n // COMPOUNDS_PER_TERM))
    best = (float("inf"), None)
    for size in range(1, limit + 1):
        for combo in itertools.combinations(HANSCH_TERMS, size):
            # A squared term without its linear partner is not a parabola, it is a U with no position.
            if "clogp_sq" in combo and "clogp" not in combo:
                continue
            X = np.column_stack([columns[t] for t in combo])
            if np.linalg.matrix_rank(np.column_stack([np.ones(n), X])) < X.shape[1] + 1:
                continue
            score = _aicc(X, y)
            if score < best[0]:
                best = (score, combo)
    return best[1]


def fit_series(rows: list[dict], scaffold: str, rng: np.random.Generator) -> dict:
    """One Hansch model on one congeneric series: select terms on AICc, then judge honestly."""
    y = np.array([float(r["y"]) for r in rows])
    n = len(y)
    columns = _terms_of(rows)
    terms = select_terms(columns, y)
    if terms is None:
        return {"kind": "series_hansch", "scaffold": scaffold, "n": n, "passes": False,
                "gates": {"fittable": False}, "terms": [], "median_tanimoto": 0.0,
                "membership_floor": 1.0,
                "r2": 0.0, "q2_loo": -9.99, "scramble_q2": 0.0, "lipophilic_optimum_clogp": None}

    X = np.column_stack([columns[t] for t in terms])
    beta = _ols(X, y)
    r2 = _r2(y, _apply(beta, X))
    q2_loo = _q2_loo(X, y)

    # The scramble is scored the same way the model is, out of sample, so it cannot pass by memorising.
    scramble = []
    for _ in range(SCRAMBLES):
        shuffled = rng.permutation(y)
        scramble.append(_q2_loo(X, shuffled))
    scramble_q2 = float(np.mean(scramble))

    similarity, floor = series_similarity(rows)
    gates = {
        f"n >= {MIN_SERIES}": n >= MIN_SERIES,
        f"congeneric (median Tanimoto >= {MIN_SERIES_SIMILARITY})": similarity >= MIN_SERIES_SIMILARITY,
        f"at most n/{COMPOUNDS_PER_TERM} terms": len(terms) <= max(1, n // COMPOUNDS_PER_TERM),
        f"r2 >= {SERIES_GATES['min_r2']}": r2 >= SERIES_GATES["min_r2"],
        f"q2_loo >= {SERIES_GATES['min_q2_loo']}": q2_loo >= SERIES_GATES["min_q2_loo"],
        f"shuffled q2 < {SERIES_GATES['max_scramble_q2']}": scramble_q2 < SERIES_GATES["max_scramble_q2"],
    }

    coefficients = {"intercept": round(float(beta[0]), 4)}
    coefficients.update({t: round(float(b), 4) for t, b in zip(terms, beta[1:])})

    # The parabola's vertex. The square is centred, so the vertex sits at mean(clogp) - b1 / (2 * b2), and it is
    # only an optimum when b2 is negative. A vertex outside the fitted range is an extrapolation, not a finding.
    optimum = None
    if "clogp_sq" in terms and coefficients["clogp_sq"] < -1e-6:
        logp = columns["clogp"]
        vertex = logp.mean() - coefficients["clogp"] / (2 * coefficients["clogp_sq"])
        if logp.min() <= vertex <= logp.max():
            optimum = round(float(vertex), 2)

    return {
        "kind": "series_hansch",
        "scaffold": scaffold,
        "n": n,
        "median_tanimoto": round(similarity, 3),
        "membership_floor": round(floor, 3),
        "terms": list(terms),
        "coefficients": coefficients,
        "r2": round(r2, 4),
        "q2_loo": round(q2_loo, 4),
        "scramble_q2": round(scramble_q2, 4),
        "gates": gates,
        "passes": all(gates.values()),
        "lipophilic_optimum_clogp": optimum,
        "y_mean": round(float(y.mean()), 3),
        "clogp_mean": round(float(columns["clogp"].mean()), 4),
        "descriptor_min": [round(float(v), 4) for v in X.min(axis=0)],
        "descriptor_max": [round(float(v), 4) for v in X.max(axis=0)],
        "_beta": beta.tolist(),
        "_members": [r["canonical_smiles"] for r in rows],
    }


def fit_fallback(rows: list[dict], seed: int = 0) -> dict:
    """The declared fallback: same sixteen descriptors, nonlinear, judged with whole series held out."""
    from sklearn.ensemble import RandomForestRegressor

    X = np.array([[float(r[k]) for k in DESCRIPTORS] for r in rows])
    y = np.array([float(r["y"]) for r in rows])
    scaffolds = [r["scaffold"] for r in rows]

    # Grouped folds: a scaffold is wholly in or wholly out, so a near-duplicate cannot sit on both sides of the
    # split and flatter the model. Random k-fold on this data overstates q2 badly.
    order = sorted(set(scaffolds))
    fold_of = {s: i % 5 for i, s in enumerate(order)}
    folds = np.array([fold_of[s] for s in scaffolds])

    def forest():
        return RandomForestRegressor(n_estimators=300, min_samples_leaf=2, n_jobs=-1, random_state=seed)

    pred = np.zeros_like(y)
    for f in range(5):
        tr, te = folds != f, folds == f
        if not te.any() or not tr.any():
            continue
        model = forest()
        model.fit(X[tr], y[tr])
        pred[te] = model.predict(X[te])
    q2_grouped = _r2(y, pred)

    # The scramble has to be scored the same way the model is, out of sample. A forest fitted on shuffled labels
    # and scored on its own training rows reaches r2 = 0.69 by memorising them, which says nothing. Held out, a
    # shuffled model has to land near zero, and that is the check worth making.
    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(y)
    scramble_pred = np.zeros_like(y)
    for f in range(5):
        tr, te = folds != f, folds == f
        if not te.any() or not tr.any():
            continue
        model = forest()
        model.fit(X[tr], shuffled[tr])
        scramble_pred[te] = model.predict(X[te])
    scramble_r2 = _r2(shuffled, scramble_pred)

    final = forest()
    final.fit(X, y)

    # Applicability domain for a model with no leverage to compute: how far the molecule sits from the training
    # set in standardised descriptor space, against how far the training molecules sit from each other.
    centre = X.mean(axis=0)
    spread = X.std(axis=0)
    spread[spread < 1e-9] = 1.0
    Z = (X - centre) / spread
    sample = Z if len(Z) <= 1500 else Z[rng.choice(len(Z), 1500, replace=False)]
    d = np.sqrt(((sample[:, None, :] - sample[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(d, np.inf)
    own = np.sort(d, axis=1)[:, :DOMAIN_K].mean(axis=1)
    limit = float(np.percentile(own, DOMAIN_PERCENTILE))

    return {
        "kind": "fallback_nonlinear",
        "n": len(y),
        "n_scaffolds": len(order),
        "terms": DESCRIPTORS,
        "q2_scaffold_grouped": round(q2_grouped, 4),
        "scramble_q2_grouped": round(scramble_r2, 4),
        "usable": q2_grouped >= FALLBACK_MIN_Q2 and scramble_r2 < 0.1,
        "min_q2": FALLBACK_MIN_Q2,
        "interpretable": False,
        "note": "a number with no equation to read; the mechanistic reading comes from the series models",
        "_model": final,
        "_centre": centre,
        "_spread": spread,
        "_reference": Z,
        "_domain_limit": limit,
        "y_min": round(float(y.min()), 3),
        "y_max": round(float(y.max()), 3),
    }


def build(target_id: str, seed: int = 0) -> dict | None:
    path = TRAIN / f"{target_id}.json"
    if not path.exists():
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    rows = record.get("rows") or []
    if len(rows) < MIN_SERIES:
        return None

    rng = np.random.default_rng(seed)
    counts = Counter(r["scaffold"] for r in rows)
    series = {}
    for scaffold, n in counts.items():
        if n < MIN_SERIES or scaffold == "(acyclic)":
            continue
        members = [r for r in rows if r["scaffold"] == scaffold]
        series[scaffold] = fit_series(members, scaffold, rng)

    return {
        "target_id": record["target_id"],
        "organism": record.get("organism"),
        "standard_type": record.get("standard_type"),
        "assay_type": record.get("assay_type"),
        "activity_units": record.get("activity_units"),
        "measured": {r["molecule_chembl_id"]: r["y"] for r in rows},
        "series": series,
        "fallback": fit_fallback(rows, seed=seed),
        "n_rows": len(rows),
    }


def assign_series(models: dict, scaffold: str, smiles: str) -> tuple:
    """Pick the validated series this molecule belongs to, or (None, 0.0, "").

    Exact scaffold identity is taken first because it is the strictest case. Otherwise the molecule has to earn
    its way in: median Tanimoto to that series' own members at or above that series' membership floor, the 10th
    percentile of its own internal pairwise similarity. Nothing below it is admitted, so a molecule that merely
    resembles a series still goes to the fallback rather than borrowing an equation it has no claim on.
    """
    exact = models["series"].get(scaffold)
    if exact is not None and exact["passes"]:
        return exact, 1.0, "same scaffold"

    best, best_sim = None, 0.0
    for series in models["series"].values():
        if not series["passes"]:
            continue
        sim = belongs_to(series, smiles)
        if sim > best_sim and sim >= series.get("membership_floor", MIN_SERIES_SIMILARITY):
            best, best_sim = series, sim
    if best is not None:
        return best, best_sim, (f"median Tanimoto {best_sim:.2f} to the series, "
                                f"floor {best['membership_floor']:.2f}")
    return None, best_sim, ""


def predict(models: dict, descriptors: dict, scaffold: str, smiles: str) -> dict:
    """Route one molecule inside one target: the series it belongs to if that series has a validated model.

    There is no routing to another target, ever. Inside the target, a molecule reaches a series model only by
    belonging to that series on the measurement in assign_series; otherwise it goes to the declared fallback,
    labelled, or to nothing at all. Handing a molecule the nearest available equation is how a confident,
    meaningless number gets made.
    """
    model, similarity, how = assign_series(models, scaffold, smiles)
    if model is not None:
        row = []
        for term in model["terms"]:
            if term == "clogp_sq":
                row.append((float(descriptors["clogp"]) - model["clogp_mean"]) ** 2)
            else:
                row.append(float(descriptors[term]))
        X = np.array([row])
        value = float(_apply(np.array(model["_beta"]), X)[0])
        lo = np.array(model["descriptor_min"])
        hi = np.array(model["descriptor_max"])
        inside = bool(np.all(X[0] >= lo) and np.all(X[0] <= hi))
        return {
            "value": round(value, 3),
            "tier": "series_hansch",
            "model_id": f"{models['target_id']}:series(n={model['n']}):{'+'.join(model['terms'])}",
            "quality": f"q2_loo={model['q2_loo']:.2f}, {how}",
            "domain": "inside" if inside else "outside (descriptor range)",
            "series_similarity": round(similarity, 3),
            "interpretable": True,
            "lipophilic_optimum_clogp": model["lipophilic_optimum_clogp"],
        }

    fallback = models["fallback"]
    if not fallback["usable"]:
        return {"value": None, "tier": "unavailable", "model_id": "", "quality": "", "domain": "",
                "interpretable": False,
                "note": f"no validated series model and the fallback is below q2={fallback['min_q2']}"}

    x = np.array([[float(descriptors[k]) for k in DESCRIPTORS]])
    value = float(fallback["_model"].predict(x)[0])
    z = (x - fallback["_centre"]) / fallback["_spread"]
    d = np.sqrt(((fallback["_reference"] - z) ** 2).sum(axis=1))
    near = float(np.sort(d)[:DOMAIN_K].mean())
    return {
        "value": round(value, 3),
        "tier": "fallback_nonlinear",
        "model_id": f"{models['target_id']}:fallback",
        "quality": f"q2_grouped={fallback['q2_scaffold_grouped']:.2f}",
        "domain": "inside" if near <= fallback["_domain_limit"] else "outside (unlike the training set)",
        "interpretable": False,
    }


def build_all(seed: int = 0) -> dict:
    MODELS.mkdir(parents=True, exist_ok=True)
    out = {}
    for path in sorted(TRAIN.glob("CHEMBL*.json")):
        target_id = path.stem
        models = build(target_id, seed=seed)
        if models is None:
            print(f"  {target_id}: too few rows to fit", file=sys.stderr)
            continue
        kept = sum(1 for m in models["series"].values() if m["passes"])
        print(f"  {target_id}: {models['n_rows']:5d} rows, {len(models['series']):3d} series tried, "
              f"{kept:3d} validated, fallback q2={models['fallback']['q2_scaffold_grouped']:.3f}"
              f"{'' if models['fallback']['usable'] else '  (unusable)'}", file=sys.stderr)
        out[target_id] = models
    (MODELS / "models.pkl").write_bytes(pickle.dumps(out))
    return out


def load_all() -> dict:
    path = MODELS / "models.pkl"
    if not path.exists():
        raise SystemExit("run ti/fit.py --all first")
    return pickle.loads(path.read_bytes())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--target")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    if args.all:
        out = build_all()
        series = sum(len(m["series"]) for m in out.values())
        kept = sum(1 for m in out.values() for s in m["series"].values() if s["passes"])
        usable = sum(1 for m in out.values() if m["fallback"]["usable"])
        print(f"\n{len(out)} targets, {series} series fitted, {kept} passed every gate, "
              f"{usable} usable fallbacks")
        return 0

    if args.report:
        for tid, m in sorted(load_all().items()):
            kept = [s for s in m["series"].values() if s["passes"]]
            print(f"{tid:16s} {m['n_rows']:5d} rows  {len(kept):3d}/{len(m['series']):3d} series validated  "
                  f"fallback q2={m['fallback']['q2_scaffold_grouped']:.3f}")
        return 0

    if not args.target:
        ap.error("give --target, --all or --report")
    models = build(args.target)
    if models is None:
        print("no training set for that target")
        return 1
    print(f"{models['target_id']}  {models['organism']}  {models['activity_units']}")
    print(f"{models['n_rows']} compounds, {len(models['series'])} series with n >= {MIN_SERIES}\n")
    kept = sorted((s for s in models["series"].values() if s["passes"]), key=lambda s: -s["q2_loo"])
    print(f"{len(kept)} series passed every gate:")
    for s in kept[:12]:
        opt = f"optimum clogp {s['lipophilic_optimum_clogp']}" if s["lipophilic_optimum_clogp"] else "no optimum in range"
        print(f"  n={s['n']:3d}  r2={s['r2']:.3f}  q2_loo={s['q2_loo']:.3f}  "
              f"tanimoto={s['median_tanimoto']:.2f}  {'+'.join(s['terms'])}  {opt}")
        print(f"       {s['scaffold'][:88]}")
    f = models["fallback"]
    print(f"\nfallback: q2 (whole series held out) = {f['q2_scaffold_grouped']:.3f}, "
          f"shuffled-label q2 = {f['scramble_q2_grouped']:.3f}, {'usable' if f['usable'] else 'NOT usable'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
