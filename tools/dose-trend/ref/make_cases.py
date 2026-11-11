"""Random test cases with scipy/statsmodels answers, for checking the website's JavaScript."""
import itertools
import json
import math
import random

import numpy as np
from scipy import stats
from statsmodels.stats.contingency_tables import Table
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import confint_proportions_2indep, proportion_confint

random.seed(7)
np.random.seed(7)
cases = {"normsf": [], "chi2sf": [], "wilson": [], "newcombe": [], "fisher": [], "holm": [], "trend": []}

for z in [0, 0.1, 0.5, 1, 1.5, 1.7663323526904693, 1.96, 2.5, 3, 4, 5, 6, 8, -0.3, -1.2, -2.7, -4.5]:
    cases["normsf"].append([z, float(stats.norm.sf(z))])
for df in [1, 2, 3, 4, 7, 12]:
    for x in [0.01, 0.5, 0.8747847787642371, 2, 3.9947147589252854, 7.5, 15, 40, 90]:
        cases["chi2sf"].append([x, df, float(stats.chi2.sf(x, df))])

for _ in range(150):
    n = random.randint(1, 300)
    r = random.choice([0, n, random.randint(0, n)])
    lo, hi = proportion_confint(r, n, method="wilson")
    cases["wilson"].append([r, n, float(lo), float(hi)])

for _ in range(150):
    n1, n2 = random.randint(2, 200), random.randint(2, 200)
    r1, r2 = random.randint(0, n1), random.randint(0, n2)
    lo, hi = confint_proportions_2indep(r1, n1, r2, n2, method="newcomb", compare="diff")
    cases["newcombe"].append([r1, n1, r2, n2, float(lo), float(hi)])

for _ in range(300):
    big = random.random() < 0.2
    n1, n2 = (random.randint(50, 600), random.randint(50, 600)) if big else (random.randint(1, 40), random.randint(1, 40))
    r1, r2 = random.randint(0, n1), random.randint(0, n2)
    _, p = stats.fisher_exact([[r1, n1 - r1], [r2, n2 - r2]])
    cases["fisher"].append([r1, n1 - r1, r2, n2 - r2, float(p)])

for _ in range(60):
    ps = [random.random() ** random.choice([1, 2, 4]) for _ in range(random.randint(1, 8))]
    cases["holm"].append([ps, [float(v) for v in multipletests(ps, method="holm")[1]]])


def exact(x, r, n):
    R = int(sum(r))
    t_obs = float(np.dot(x, r))
    probs, ts = [], []
    for combo in itertools.product(*[range(v + 1) for v in n]):
        if sum(combo) != R:
            continue
        w = 1.0
        for c, v in zip(combo, n):
            w *= math.comb(v, c)
        probs.append(w)
        ts.append(float(np.dot(combo, x)))
    probs = np.array(probs) / math.comb(int(sum(n)), R)
    ts = np.array(ts)
    e = float(np.sum(probs * ts))
    eps = 1e-9 * max(1.0, abs(t_obs))
    return (float(probs[np.abs(ts - e) >= abs(t_obs - e) - eps].sum()),
            float(probs[ts >= t_obs - eps].sum()), float(probs[ts <= t_obs + eps].sum()))


score_sets = [
    lambda k: [400.0 * i for i in range(k)],
    lambda k: [float(i + 1) for i in range(k)],
    lambda k: sorted(random.sample([0, 1, 2.5, 5, 10, 12.5, 20, 40, 80, 100, 150, 300], k)),
    lambda k: [0.0] + [round(0.1 * 3 ** i, 4) for i in range(k - 1)],
]
made = 0
while made < 120:
    k = random.randint(2, 5)
    n = [random.randint(2, 14 if k >= 4 else 25) for _ in range(k)]
    r = [random.randint(0, v) for v in n]
    R, N = sum(r), sum(n)
    if R == 0 or R == N:
        continue
    x = [float(v) for v in random.choice(score_sets)(k)]
    xa, ra, na = np.array(x), np.array(r, float), np.array(n, float)
    pbar = R / N
    T = float(np.sum(xa * (ra - na * pbar)))
    var = pbar * (1 - pbar) * (np.sum(na * xa**2) - np.sum(na * xa) ** 2 / N)
    z = T / math.sqrt(var)
    # independent check of z through statsmodels (its variance uses N-1)
    sm = Table(np.column_stack([ra, na - ra]) + 0.0, shift_zeros=False).test_ordinal_association(
        row_scores=xa, col_scores=np.array([1.0, 0.0]))
    z_sm = float(sm.zscore * math.sqrt(N / (N - 1)))
    assert abs(z - z_sm) < 1e-8 * max(1, abs(z)), (z, z_sm)
    chi_all = float(stats.chi2_contingency(np.column_stack([ra, na - ra]), correction=False).statistic)
    p2, pinc, pdec = exact(x, r, n)
    cases["trend"].append(dict(x=x, r=r, n=n, z=z, p_two=float(2 * stats.norm.sf(abs(z))),
                               p_inc=float(stats.norm.sf(z)), chi_all=chi_all,
                               ex_two=p2, ex_inc=pinc, ex_dec=pdec))
    made += 1

with open(__import__("os").path.join(__import__("os").path.dirname(__file__), "cases.json"), "w") as fh:
    json.dump(cases, fh)
print({k: len(v) for k, v in cases.items()})
