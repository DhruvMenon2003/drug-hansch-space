"""Reference statistics for the apricitabine headache row.

Ground truth for the website's JavaScript. Cochran-Armitage is coded from the
textbook formula and cross-checked against statsmodels / a logistic score test.
"""
import itertools
import json
import math

import numpy as np
from scipy import stats
from statsmodels.stats.contingency_tables import Table
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint

labels = ["Placebo", "400 mg", "800 mg", "1200 mg", "1600 mg"]
dose = np.array([0, 400, 800, 1200, 1600], float)
r = np.array([4, 3, 4, 6, 8], float)       # patients with headache
n = np.array([13, 11, 12, 14, 13], float)  # patients per group


def cochran_armitage(x, r, n):
    N, R = n.sum(), r.sum()
    pbar = R / N
    T = np.sum(x * (r - n * pbar))
    var = pbar * (1 - pbar) * (np.sum(n * x**2) - np.sum(n * x) ** 2 / N)
    z = T / math.sqrt(var)
    return dict(T=T, var=var, z=z, chi2=z * z,
                p_two=2 * stats.norm.sf(abs(z)),
                p_greater=stats.norm.sf(z), p_less=stats.norm.cdf(z))


def exact_trend(x, r, n):
    """Exact conditional (permutation) distribution of sum(x_i * r_i) given total events."""
    R = int(r.sum())
    ni = [int(v) for v in n]
    t_obs = float(np.sum(x * r))
    probs, ts = [], []
    for combo in itertools.product(*[range(v + 1) for v in ni]):
        if sum(combo) != R:
            continue
        w = 1.0
        for c, v in zip(combo, ni):
            w *= math.comb(v, c)
        probs.append(w)
        ts.append(sum(c * xv for c, xv in zip(combo, x)))
    probs = np.array(probs) / math.comb(int(n.sum()), R)
    ts = np.array(ts)
    e = np.sum(probs * ts)
    eps = 1e-9
    return dict(
        tables=len(ts), total_prob=float(probs.sum()), expected=float(e),
        p_greater=float(probs[ts >= t_obs - eps].sum()),
        p_less=float(probs[ts <= t_obs + eps].sum()),
        p_two=float(probs[np.abs(ts - e) >= abs(t_obs - e) - eps].sum()),
    )


out = {}
ca = cochran_armitage(dose, r, n)
out["ca_actual_doses"] = ca
out["ca_equal_scores"] = cochran_armitage(np.arange(5.0), r, n)
out["ca_active_only"] = cochran_armitage(dose[1:], r[1:], n[1:])
out["exact_actual_doses"] = exact_trend(dose, r, n)
out["exact_active_only"] = exact_trend(dose[1:], r[1:], n[1:])

# Cross-check 1: statsmodels linear-by-linear (uses N-1 variance) -> z_CA = z_sm * sqrt(N/(N-1))
tab = Table(np.column_stack([r, n - r]))
sm = tab.test_ordinal_association(row_scores=dose, col_scores=np.array([1.0, 0.0]))
N = n.sum()
out["crosscheck_statsmodels_z_rescaled"] = float(sm.zscore * math.sqrt(N / (N - 1)))

# Cross-check 2: chi-square for linear trend the way R's prop.trend.test does it
p = r / n
pbar = r.sum() / n.sum()
w = n / (pbar * (1 - pbar))
xm = np.sum(w * dose) / np.sum(w)
b = np.sum(w * (dose - xm) * p) / np.sum(w * (dose - xm) ** 2)
out["crosscheck_prop_trend_chi2"] = float(b**2 * np.sum(w * (dose - xm) ** 2))

# Departure from linearity = overall Pearson chi-square minus trend chi-square
chi2_all = stats.chi2_contingency(np.column_stack([r, n - r]), correction=False)
out["overall_chi2"] = dict(chi2=float(chi2_all.statistic), df=int(chi2_all.dof), p=float(chi2_all.pvalue))
dep = chi2_all.statistic - ca["chi2"]
out["departure_from_linearity"] = dict(chi2=float(dep), df=int(chi2_all.dof - 1),
                                       p=float(stats.chi2.sf(dep, chi2_all.dof - 1)))

# Per-group incidence with Wilson 95% CI
out["groups"] = []
for lab, ri, ni in zip(labels, r, n):
    lo, hi = proportion_confint(ri, ni, method="wilson")
    out["groups"].append(dict(group=lab, r=int(ri), n=int(ni), pct=100 * ri / ni,
                              wilson_lo=100 * lo, wilson_hi=100 * hi))

# Each dose vs placebo: Fisher's exact, risk difference with Newcombe hybrid-score CI
pair = []
for i in range(1, 5):
    table = [[int(r[i]), int(n[i] - r[i])], [int(r[0]), int(n[0] - r[0])]]
    odds, pf = stats.fisher_exact(table, alternative="two-sided")
    lo, hi = confint_proportions_2indep(r[i], n[i], r[0], n[0], method="newcomb", compare="diff")
    pair.append(dict(comparison=f"{labels[i]} vs Placebo", rd=100 * (r[i] / n[i] - r[0] / n[0]),
                     rd_lo=100 * lo, rd_hi=100 * hi, sample_or=float(odds), p_fisher=float(pf)))
holm = multipletests([d["p_fisher"] for d in pair], method="holm")[1]
for d, ph in zip(pair, holm):
    d["p_holm"] = float(ph)
out["pairwise_vs_placebo"] = pair

# Pooled apricitabine vs placebo (the table's Total column)
table = [[21, 29], [4, 9]]
odds, pf = stats.fisher_exact(table)
lo, hi = confint_proportions_2indep(21, 50, 4, 13, method="newcomb", compare="diff")
out["pooled_vs_placebo"] = dict(rd=100 * (21 / 50 - 4 / 13), rd_lo=100 * lo, rd_hi=100 * hi,
                                sample_or=float(odds), p_fisher=float(pf))

print(json.dumps(out, indent=2, default=float))
with open(__import__("os").path.join(__import__("os").path.dirname(__file__), "reference.json"), "w") as fh:
    json.dump(out, fh, indent=2, default=float)
