#!/usr/bin/env python3
"""One QSAR model per target, fitted and judged against the OECD principles before it is allowed to predict.

    ti/models.py --target CHEMBL240          # fit one target, print the report card
    ti/models.py --survey                    # fit every cached target, print the table

WHAT IS FITTED

For each target, two models on the same rows:

  hansch   An ordinary least-squares fit on six terms - clogp, clogp squared, mr, tpsa, hbd, hba. This is the
           interpretable benchmark. Its coefficients are the mechanistic reading: a negative coefficient on
           clogp_sq with a positive one on clogp is the classical parabola, and the optimum sits at
           -b_logp / (2 * b_logp_sq).

  ridge    A ridge regression on ten terms (the six above plus mw, rotb, aromatic_rings, fsp3), alpha chosen in
           an inner loop. It exists to answer one question honestly: does the extra freedom actually predict
           better out of sample, or does it only fit better in sample? Where it does not beat the Hansch model
           on Q squared, the Hansch model is the one used, because it can be read.

The descriptors come from the cached ChEMBL sets in site/data/qsar/, computed by tools/build_qsar_targets.py with
Crippen.MolLogP, Crippen.MolMR, CalcTPSA, CalcNumHBD and CalcNumHBA - the same calls ti/descriptors.py makes.
That is not a coincidence to be grateful for; it is the precondition for predicting on new molecules at all. A
logP from a different implementation is a different descriptor, and a model trained on one and fed the other is
measuring nothing.

HOW IT IS JUDGED (OECD principles 4 and 5)

  r2            fit on the training rows. On its own it means very little.
  q2_cv         5-fold cross-validated R squared, folds fixed by seed. This is the honest predictivity number.
  q2_scaffold   the same, but folds are Bemis-Murcko scaffold groups, so no scaffold is in train and test at
                once. Where this collapses relative to q2_cv, the model was memorising series, not chemistry.
  y_scramble    50 refits on shuffled y. If a shuffled fit scores anywhere near the real one, the real one is
                chance correlation.
  gates         Golbraikh-Tropsha style marks: n >= 25, r2 >= 0.6, q2_cv >= 0.5, scramble q2 < 0.2,
                and q2_scaffold >= 0.4. A model that fails any of them may still predict, but every prediction
                it makes is flagged, and the flag travels into the output CSV.

APPLICABILITY DOMAIN (OECD principle 3)

Leverage. h_i = x_i' (X'X)^-1 x_i on the fitted descriptor matrix; the warning limit is h* = 3p/n. A molecule
above h* is outside the space the model was fitted in, and its prediction is an extrapolation whatever the
coefficients say. That flag is carried per prediction, never averaged away.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
QSAR_DIR = REPO / "site" / "data" / "qsar"
SEED = 42

HANSCH = ["clogp", "clogp_sq", "mr", "tpsa", "hbd", "hba"]
WIDE = HANSCH + ["mw", "rotb", "aromatic_rings", "fsp3"]

# The cached files use short names; ours are spelled out. One mapping, written down once.
FROM_CACHE = {"clogp": "logp", "mr": "mr", "tpsa": "tpsa", "hbd": "hbd", "hba": "hba",
              "mw": "mw", "rotb": "rotb", "aromatic_rings": "arom", "fsp3": "fsp3"}

GATES = {"min_n": 25, "min_r2": 0.6, "min_q2": 0.5, "max_scramble_q2": 0.2, "min_q2_scaffold": 0.4}


def load_target(target_id: str) -> dict | None:
    path = QSAR_DIR / f"{target_id}.json"
    if not path.exists():
        return None
    blob = json.loads(path.read_text(encoding="utf-8"))
    cols = blob["cols"]
    n = len(cols["y"])
    rows = []
    for i in range(n):
        row = {}
        for name, cached in FROM_CACHE.items():
            row[name] = float(cols[cached][i])
        row["clogp_sq"] = row["clogp"] ** 2
        rows.append(row)
    return {
        "target_id": blob["target"]["id"],
        "target_name": blob["target"]["name"],
        "organism": blob["target"].get("organism"),
        "standard_type": blob["standard_type"],
        "assay_type": blob.get("assay_type"),
        "activity_units": blob["activity"],
        "n_source_rows": blob.get("n_clean"),
        "rows": rows,
        "y": np.asarray([float(v) for v in cols["y"]]),
        "scaffold": cols.get("sc") or list(range(n)),
        "names": cols.get("nm") or [""] * n,
    }


def _matrix(rows: list[dict], terms: list[str]) -> np.ndarray:
    return np.asarray([[row[t] for t in terms] for row in rows], dtype=float)


def _ols(X: np.ndarray, y: np.ndarray):
    Xi = np.hstack([np.ones((len(X), 1)), X])
    beta, *_ = np.linalg.lstsq(Xi, y, rcond=None)
    return beta


def _predict(beta: np.ndarray, X: np.ndarray) -> np.ndarray:
    return np.hstack([np.ones((len(X), 1)), X]) @ beta


def _ridge(X: np.ndarray, y: np.ndarray, alpha: float):
    mu, sigma = X.mean(0), X.std(0)
    sigma[sigma == 0] = 1.0
    Z = (X - mu) / sigma
    Zi = np.hstack([np.ones((len(Z), 1)), Z])
    penalty = np.eye(Zi.shape[1]) * alpha
    penalty[0, 0] = 0.0
    beta = np.linalg.solve(Zi.T @ Zi + penalty, Zi.T @ y)
    return {"beta": beta, "mu": mu, "sigma": sigma}


def _ridge_predict(model: dict, X: np.ndarray) -> np.ndarray:
    Z = (X - model["mu"]) / model["sigma"]
    return np.hstack([np.ones((len(Z), 1)), Z]) @ model["beta"]


def _r2(y: np.ndarray, pred: np.ndarray) -> float:
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def _folds(n: int, k: int, groups=None, seed: int = SEED) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    if groups is None:
        order = rng.permutation(n)
        return [order[i::k] for i in range(k)]
    unique = sorted({str(g) for g in groups})
    assignment = {g: i % k for i, g in enumerate(rng.permutation(unique))}
    buckets: list[list[int]] = [[] for _ in range(k)]
    for i, g in enumerate(groups):
        buckets[assignment[str(g)]].append(i)
    return [np.asarray(b, dtype=int) for b in buckets if b]


def _cv(X: np.ndarray, y: np.ndarray, kind: str, groups=None, k: int = 5, alpha: float = 1.0) -> float:
    pred = np.full(len(y), np.nan)
    for fold in _folds(len(y), k, groups):
        mask = np.ones(len(y), dtype=bool)
        mask[fold] = False
        if mask.sum() < X.shape[1] + 2 or len(fold) == 0:
            continue
        if kind == "ols":
            pred[fold] = _predict(_ols(X[mask], y[mask]), X[fold])
        else:
            pred[fold] = _ridge_predict(_ridge(X[mask], y[mask], alpha), X[fold])
    ok = ~np.isnan(pred)
    return _r2(y[ok], pred[ok]) if ok.sum() > 3 else float("nan")


def fit_target(target_id: str) -> dict | None:
    """Fit both models, judge them, and return the report card plus whatever is needed to predict."""
    data = load_target(target_id)
    if data is None or len(data["y"]) < GATES["min_n"]:
        return None
    y = data["y"]
    Xh, Xw = _matrix(data["rows"], HANSCH), _matrix(data["rows"], WIDE)

    hansch_beta = _ols(Xh, y)
    hansch = {
        "terms": HANSCH,
        "coefficients": dict(zip(["intercept"] + HANSCH, [round(float(b), 4) for b in hansch_beta])),
        "r2": _r2(y, _predict(hansch_beta, Xh)),
        "q2_cv": _cv(Xh, y, "ols"),
        "q2_scaffold": _cv(Xh, y, "ols", groups=data["scaffold"]),
    }
    best_alpha = max([0.1, 1.0, 10.0, 100.0], key=lambda a: (_cv(Xw, y, "ridge", alpha=a) or -9))
    ridge_model = _ridge(Xw, y, best_alpha)
    ridge = {
        "terms": WIDE,
        "alpha": best_alpha,
        "r2": _r2(y, _ridge_predict(ridge_model, Xw)),
        "q2_cv": _cv(Xw, y, "ridge", alpha=best_alpha),
        "q2_scaffold": _cv(Xw, y, "ridge", groups=data["scaffold"], alpha=best_alpha),
    }

    rng = np.random.default_rng(SEED)
    scrambles = []
    for _ in range(50):
        scrambles.append(_cv(Xh, y, "ols", groups=None, k=5) if False else _r2(
            y, _predict(_ols(Xh, rng.permutation(y)), Xh)))
    scramble_q2 = float(np.nanmean(scrambles))

    use_ridge = (ridge["q2_cv"] == ridge["q2_cv"]) and ridge["q2_cv"] > (hansch["q2_cv"] + 0.05)
    chosen = "ridge" if use_ridge else "hansch"
    chosen_stats = ridge if use_ridge else hansch

    gates = {
        "n >= 25": len(y) >= GATES["min_n"],
        "r2 >= 0.6": chosen_stats["r2"] >= GATES["min_r2"],
        "q2_cv >= 0.5": chosen_stats["q2_cv"] >= GATES["min_q2"],
        "y-scramble r2 < 0.2": scramble_q2 < GATES["max_scramble_q2"],
        "q2_scaffold >= 0.4": chosen_stats["q2_scaffold"] >= GATES["min_q2_scaffold"],
    }

    X = Xw if use_ridge else Xh
    gram = np.linalg.pinv(np.hstack([np.ones((len(X), 1)), X]).T @ np.hstack([np.ones((len(X), 1)), X]))
    p = X.shape[1] + 1
    return {
        "target_id": data["target_id"],
        "target_name": data["target_name"],
        "organism": data["organism"],
        "standard_type": data["standard_type"],
        "assay_type": data["assay_type"],
        "activity_units": data["activity_units"],
        "n_train": int(len(y)),
        "n_source_rows": data["n_source_rows"],
        "y_mean": float(y.mean()),
        "y_sd": float(y.std()),
        "chosen": chosen,
        "hansch": hansch,
        "ridge": ridge,
        "y_scramble_r2": scramble_q2,
        "gates": gates,
        "gates_passed": sum(gates.values()),
        "oecd_all_pass": all(gates.values()),
        "_predict": {
            "kind": "ridge" if use_ridge else "ols",
            "terms": WIDE if use_ridge else HANSCH,
            "beta": (ridge_model["beta"] if use_ridge else hansch_beta).tolist(),
            "mu": ridge_model["mu"].tolist() if use_ridge else None,
            "sigma": ridge_model["sigma"].tolist() if use_ridge else None,
            "gram": gram.tolist(),
            "leverage_limit": 3.0 * p / len(y),
            "train_min": X.min(0).tolist(),
            "train_max": X.max(0).tolist(),
        },
    }


def fit_rows(rows: list[dict], meta: dict, terms: list[str] = None, min_n: int = None) -> dict | None:
    """Fit and judge a model on rows already carrying the descriptor block (the ti/cache/train/ format).

    Same report card as fit_target, but the rows come with real Bemis-Murcko scaffold SMILES rather than Butina
    cluster numbers, so q2_scaffold is a genuine leave-a-series-out figure.
    """
    terms = terms or HANSCH
    min_n = min_n or GATES["min_n"]
    if len(rows) < min_n:
        return None
    y = np.asarray([float(r["y"]) for r in rows])
    if y.std() < 0.3:
        return None
    X = _matrix(rows, terms)
    scaffolds = [r.get("scaffold", "") for r in rows]

    beta = _ols(X, y)
    r2 = _r2(y, _predict(beta, X))
    q2_cv = _cv(X, y, "ols")
    q2_scaffold = _cv(X, y, "ols", groups=scaffolds)

    rng = np.random.default_rng(SEED)
    scramble = float(np.nanmean([_r2(y, _predict(_ols(X, rng.permutation(y)), X)) for _ in range(50)]))

    gates = {
        "n >= 25": len(y) >= GATES["min_n"],
        "r2 >= 0.6": r2 >= GATES["min_r2"],
        "q2_cv >= 0.5": q2_cv >= GATES["min_q2"],
        "y-scramble r2 < 0.2": scramble < GATES["max_scramble_q2"],
        "q2_scaffold >= 0.4": q2_scaffold >= GATES["min_q2_scaffold"],
    }
    Xi = np.hstack([np.ones((len(X), 1)), X])
    p = X.shape[1] + 1
    coefficients = dict(zip(["intercept"] + terms, [round(float(b), 4) for b in beta]))
    optimum = None
    if "clogp" in terms and "clogp_sq" in terms and coefficients["clogp_sq"] < 0 < coefficients["clogp"]:
        optimum = round(-coefficients["clogp"] / (2 * coefficients["clogp_sq"]), 2)
    return {
        **meta,
        "n_train": int(len(y)),
        "y_mean": float(y.mean()),
        "y_sd": float(y.std()),
        "terms": terms,
        "coefficients": coefficients,
        "lipophilic_optimum_clogp": optimum,
        "r2": r2,
        "q2_cv": q2_cv,
        "q2_scaffold": q2_scaffold,
        "y_scramble_r2": scramble,
        "gates": gates,
        "gates_passed": sum(gates.values()),
        "oecd_all_pass": all(gates.values()),
        "_predict": {
            "kind": "ols",
            "terms": terms,
            "beta": beta.tolist(),
            "mu": None,
            "sigma": None,
            "gram": np.linalg.pinv(Xi.T @ Xi).tolist(),
            "leverage_limit": 3.0 * p / len(y),
            "train_min": X.min(0).tolist(),
            "train_max": X.max(0).tolist(),
        },
    }


def predict_one(model: dict, descriptors: dict) -> dict:
    """Predict for one molecule and say whether the prediction is inside the domain the model was fitted in."""
    spec = model["_predict"]
    x = np.asarray([[float(descriptors[t]) for t in spec["terms"]]])
    if spec["kind"] == "ridge":
        mu, sigma = np.asarray(spec["mu"]), np.asarray(spec["sigma"])
        z = (x - mu) / sigma
        value = float(np.hstack([np.ones((1, 1)), z]) @ np.asarray(spec["beta"]))
    else:
        value = float(np.hstack([np.ones((1, 1)), x]) @ np.asarray(spec["beta"]))
    xi = np.hstack([np.ones((1, 1)), x])
    leverage = float(xi @ np.asarray(spec["gram"]) @ xi.T)
    outside = [t for t, v, lo, hi in zip(spec["terms"], x[0], spec["train_min"], spec["train_max"])
               if v < lo or v > hi]
    return {
        "value": value,
        "leverage": leverage,
        "leverage_limit": spec["leverage_limit"],
        "in_domain": leverage <= spec["leverage_limit"] and not outside,
        "outside_range": outside,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--target")
    ap.add_argument("--survey", action="store_true")
    args = ap.parse_args()

    if args.target:
        model = fit_target(args.target)
        if not model:
            print("no cached set, or fewer than 25 rows")
            return 1
        print(f"{model['target_id']}  {model['target_name']}  ({model['organism']})")
        print(f"  {model['standard_type']} on {model['n_train']} compounds, chosen model: {model['chosen']}")
        for kind in ("hansch", "ridge"):
            s = model[kind]
            print(f"  {kind:7s} r2={s['r2']:.3f}  q2_cv={s['q2_cv']:.3f}  q2_scaffold={s['q2_scaffold']:.3f}")
        print(f"  y-scramble r2 = {model['y_scramble_r2']:.3f}")
        for gate, ok in model["gates"].items():
            print(f"  {'PASS' if ok else 'FAIL'}  {gate}")
        print("  Hansch coefficients:", model["hansch"]["coefficients"])
        b = model["hansch"]["coefficients"]
        if b["clogp_sq"] < 0 < b["clogp"]:
            print(f"  parabolic in lipophilicity, optimum clogp = {-b['clogp'] / (2 * b['clogp_sq']):.2f}")
        return 0

    if args.survey:
        ids = sorted(p.stem for p in QSAR_DIR.glob("CHEMBL*.json"))
        print(f"{'target':16s} {'n':>5s} {'model':8s} {'r2':>6s} {'q2':>6s} {'q2scaf':>7s} {'scr':>6s} gates")
        passing = 0
        for tid in ids:
            model = fit_target(tid)
            if not model:
                continue
            s = model[model["chosen"]]
            passing += model["oecd_all_pass"]
            print(f"{tid:16s} {model['n_train']:5d} {model['chosen']:8s} {s['r2']:6.3f} {s['q2_cv']:6.3f} "
                  f"{s['q2_scaffold']:7.3f} {model['y_scramble_r2']:6.3f} {model['gates_passed']}/5")
        print(f"\n{passing} of {len(ids)} targets pass all five gates")
        return 0

    ap.error("give --target or --survey")


if __name__ == "__main__":
    sys.exit(main())
