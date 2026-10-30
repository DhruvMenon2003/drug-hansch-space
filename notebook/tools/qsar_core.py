"""The statistics a QSAR model has to report, written out rather than imported.

Every quantity here is computed from the data it is given. Nothing is cached, defaulted or
filled in. The functions are deliberately small so each reported number can be traced to the
lines that produced it, which is what the OECD principles and the Gramatica validation papers
ask for.

References for the external-validation metrics:
  Chirico, N.; Gramatica, P. "Real External Predictivity of QSAR Models: How To Evaluate It?
  Comparison of Different Validation Criteria and Proposal of Using the Concordance
  Correlation Coefficient." J. Chem. Inf. Model. 2011, 51 (9), 2320-2335.
  Consonni, V.; Ballabio, D.; Todeschini, R. "Comments on the Definition of the Q2
  Parameter for QSAR Validation." J. Chem. Inf. Model. 2009, 49 (7), 1669-1678.
  Roy, K. et al. r2m metrics, Chemom. Intell. Lab. Syst. 2012, 118, 200-210.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

import numpy as np


def _design(X: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(len(X)), X])


@dataclass
class OLSFit:
    names: list[str]
    coef: np.ndarray            # intercept first
    se: np.ndarray
    t: np.ndarray
    p: np.ndarray
    n: int
    k: int                      # fitted terms, excluding the intercept
    r2: float
    r2_adj: float
    rmse: float
    s: float                    # standard error of the estimate
    f_stat: float
    f_p: float
    vif: np.ndarray             # one per term, excluding the intercept
    aicc: float
    fitted: np.ndarray
    residuals: np.ndarray
    leverage: np.ndarray
    h_star: float
    std_residuals: np.ndarray

    def equation(self, response: str = "log(1/C)", dp: int = 3) -> str:
        parts = [f"{self.coef[0]:+.{dp}f}"]
        for name, c in zip(self.names, self.coef[1:]):
            parts.append(f"{c:+.{dp}f}·{name}")
        return f"{response} = " + " ".join(parts)


def _t_sf(t: float, df: int) -> float:
    """Two-sided p-value for Student's t, via the regularised incomplete beta function."""
    from scipy import stats
    return float(2.0 * stats.t.sf(abs(t), df))


def ols(X: np.ndarray, y: np.ndarray, names: list[str]) -> OLSFit:
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float).ravel()
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    n, k = X.shape
    if n <= k + 1:
        raise ValueError(f"{n} compounds cannot support {k} fitted terms plus an intercept")
    A = _design(X)
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    fitted = A @ coef
    resid = y - fitted
    df_res = n - k - 1
    sse = float(resid @ resid)
    sst = float(((y - y.mean()) ** 2).sum())
    mse = sse / df_res
    s = math.sqrt(mse)
    xtx_inv = np.linalg.pinv(A.T @ A)
    se = np.sqrt(np.clip(np.diag(xtx_inv) * mse, 0, None))
    with np.errstate(divide="ignore", invalid="ignore"):
        t = np.where(se > 0, coef / se, np.nan)
    p = np.array([_t_sf(ti, df_res) if np.isfinite(ti) else np.nan for ti in t])
    r2 = 1.0 - sse / sst if sst > 0 else float("nan")
    r2_adj = 1.0 - (1.0 - r2) * (n - 1) / df_res if df_res > 0 else float("nan")
    if k > 0 and sst > sse:
        f_stat = ((sst - sse) / k) / mse
        from scipy import stats
        f_p = float(stats.f.sf(f_stat, k, df_res))
    else:
        f_stat, f_p = float("nan"), float("nan")

    vif = np.full(k, np.nan)
    for j in range(k):
        others = np.delete(X, j, axis=1)
        if others.shape[1] == 0:
            vif[j] = 1.0
            continue
        Aj = _design(others)
        cj, *_ = np.linalg.lstsq(Aj, X[:, j], rcond=None)
        rj = X[:, j] - Aj @ cj
        ss_tot = float(((X[:, j] - X[:, j].mean()) ** 2).sum())
        r2j = 1.0 - float(rj @ rj) / ss_tot if ss_tot > 0 else 0.0
        vif[j] = 1.0 / (1.0 - r2j) if r2j < 1.0 else float("inf")

    params = k + 2  # terms + intercept + variance
    aic = n * math.log(sse / n) + 2 * params
    aicc = aic + (2 * params * (params + 1)) / (n - params - 1) if n - params - 1 > 0 else float("inf")

    hat = A @ xtx_inv @ A.T
    lev = np.clip(np.diag(hat), 0, None)
    h_star = 3.0 * (k + 1) / n
    std_resid = resid / s if s > 0 else resid * 0.0

    return OLSFit(names=list(names), coef=coef, se=se, t=t, p=p, n=n, k=k, r2=r2,
                  r2_adj=r2_adj, rmse=math.sqrt(sse / n), s=s, f_stat=f_stat, f_p=f_p,
                  vif=vif, aicc=aicc, fitted=fitted, residuals=resid, leverage=lev,
                  h_star=h_star, std_residuals=std_resid)


def q2_loo(X: np.ndarray, y: np.ndarray) -> tuple[float, np.ndarray]:
    """Leave-one-out Q2 against the mean of the full response, with the LOO predictions."""
    X = np.asarray(X, dtype=float)
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    preds = np.empty(n)
    for i in range(n):
        mask = np.ones(n, dtype=bool)
        mask[i] = False
        A = _design(X[mask])
        coef, *_ = np.linalg.lstsq(A, y[mask], rcond=None)
        preds[i] = float(np.concatenate(([1.0], X[i])) @ coef)
    press = float(((y - preds) ** 2).sum())
    sst = float(((y - y.mean()) ** 2).sum())
    return (1.0 - press / sst if sst > 0 else float("nan")), preds


def q2_lmo(X: np.ndarray, y: np.ndarray, fraction: float = 0.2, repeats: int = 100,
           seed: int = 0) -> dict:
    """Leave-many-out Q2: repeated random hold-out of a fraction of the training set."""
    X = np.asarray(X, dtype=float)
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    out = n if (m := max(1, int(round(fraction * n)))) >= n else m
    rng = np.random.default_rng(seed)
    scores = []
    sst = float(((y - y.mean()) ** 2).sum())
    for _ in range(repeats):
        idx = rng.permutation(n)[:out]
        mask = np.ones(n, dtype=bool)
        mask[idx] = False
        if mask.sum() <= X.shape[1] + 1:
            continue
        A = _design(X[mask])
        coef, *_ = np.linalg.lstsq(A, y[mask], rcond=None)
        pred = _design(X[~mask]) @ coef
        press = float(((y[~mask] - pred) ** 2).sum()) * n / out
        scores.append(1.0 - press / sst if sst > 0 else float("nan"))
    arr = np.array(scores, dtype=float)
    return {"mean": float(np.nanmean(arr)), "sd": float(np.nanstd(arr)),
            "min": float(np.nanmin(arr)), "max": float(np.nanmax(arr)),
            "repeats": int(len(arr)), "left_out_per_repeat": int(out)}


def y_randomisation(X: np.ndarray, y: np.ndarray, repeats: int = 100, seed: int = 0) -> dict:
    """Refit on shuffled responses. A real model's r2 and Q2 must sit above this cloud."""
    X = np.asarray(X, dtype=float)
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    y = np.asarray(y, dtype=float).ravel()
    rng = np.random.default_rng(seed)
    r2s, q2s = [], []
    for _ in range(repeats):
        ys = rng.permutation(y)
        r2s.append(ols(X, ys, [f"x{i}" for i in range(X.shape[1])]).r2)
        q2s.append(q2_loo(X, ys)[0])
    return {"r2_mean": float(np.mean(r2s)), "r2_max": float(np.max(r2s)),
            "q2_mean": float(np.mean(q2s)), "q2_max": float(np.max(q2s)),
            "repeats": repeats}


def ccc(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Lin's concordance correlation coefficient, the criterion Chirico & Gramatica propose."""
    a = np.asarray(y_true, dtype=float).ravel()
    b = np.asarray(y_pred, dtype=float).ravel()
    n = len(a)
    if n < 2:
        return float("nan")
    va = float(((a - a.mean()) ** 2).sum()) / n
    vb = float(((b - b.mean()) ** 2).sum()) / n
    cov = float(((a - a.mean()) * (b - b.mean())).sum()) / n
    denom = va + vb + (a.mean() - b.mean()) ** 2
    return 2.0 * cov / denom if denom > 0 else float("nan")


def external_metrics(y_train: np.ndarray, y_ext: np.ndarray, pred_ext: np.ndarray) -> dict:
    """Q2F1, Q2F2, Q2F3, CCC and r2m, which disagree on purpose: report all of them."""
    y_train = np.asarray(y_train, dtype=float).ravel()
    y_ext = np.asarray(y_ext, dtype=float).ravel()
    pred = np.asarray(pred_ext, dtype=float).ravel()
    n_ext, n_tr = len(y_ext), len(y_train)
    press = float(((y_ext - pred) ** 2).sum())
    q2f1 = 1.0 - press / float(((y_ext - y_train.mean()) ** 2).sum())
    q2f2 = 1.0 - press / float(((y_ext - y_ext.mean()) ** 2).sum())
    sst_tr = float(((y_train - y_train.mean()) ** 2).sum())
    q2f3 = 1.0 - (press / n_ext) / (sst_tr / n_tr)
    r = float(np.corrcoef(y_ext, pred)[0, 1]) if n_ext > 1 else float("nan")
    r2 = r * r
    k = float((y_ext @ pred) / (pred @ pred)) if float(pred @ pred) > 0 else float("nan")
    r2_0 = 1.0 - float(((y_ext - k * pred) ** 2).sum()) / float(((y_ext - y_ext.mean()) ** 2).sum())
    r2m = r2 * (1.0 - math.sqrt(abs(r2 - r2_0))) if np.isfinite(r2_0) else float("nan")
    return {"n_external": n_ext, "q2_f1": q2f1, "q2_f2": q2f2, "q2_f3": q2f3,
            "ccc": ccc(y_ext, pred), "r2_ext": r2, "r2m": r2m,
            "rmse_ext": math.sqrt(press / n_ext),
            "mae_ext": float(np.abs(y_ext - pred).mean())}


@dataclass
class Subset:
    terms: tuple[int, ...]
    names: list[str]
    aicc: float
    fit: OLSFit = field(repr=False)


def best_subset_aicc(X: np.ndarray, y: np.ndarray, names: list[str],
                     max_terms: int | None = None,
                     compounds_per_term: int = 5) -> tuple[Subset, list[Subset]]:
    """Exhaustive subsets up to the Topliss-Costello cap, ranked on AICc.

    Selecting on AICc and reporting Q2 keeps the criterion that chose the model separate
    from the criterion that judges it. The cap is Topliss & Costello's rule of at least
    `compounds_per_term` compounds for every fitted variable.
    """
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float).ravel()
    n, p = X.shape
    cap = max(1, n // compounds_per_term)
    if max_terms is not None:
        cap = min(cap, max_terms)
    cap = min(cap, p)
    ranked: list[Subset] = []
    for size in range(1, cap + 1):
        for combo in itertools.combinations(range(p), size):
            sub = X[:, list(combo)]
            try:
                fit = ols(sub, y, [names[i] for i in combo])
            except (ValueError, np.linalg.LinAlgError):
                continue
            ranked.append(Subset(combo, [names[i] for i in combo], fit.aicc, fit))
    if not ranked:
        raise ValueError("no subset could be fitted")
    ranked.sort(key=lambda s: s.aicc)
    return ranked[0], ranked


def leverage_of(X_train: np.ndarray, X_query: np.ndarray) -> np.ndarray:
    """Hat leverage of query rows against a training design, for the applicability domain."""
    A = _design(np.asarray(X_train, dtype=float))
    inv = np.linalg.pinv(A.T @ A)
    Q = _design(np.asarray(X_query, dtype=float))
    return np.einsum("ij,jk,ik->i", Q, inv, Q)
