#!/usr/bin/env python3
"""Per-drug physicochemical property distributions for site/receptor/, QED included.

Reads the SMILES already stored in site/data/drugs.json and computes, with RDKit and nothing else, the quantitative
estimate of drug-likeness (rdkit.Chem.QED.qed), its eight component properties (QED.properties) and the structural
alerts that fired. It then summarises those eight plus the descriptors drugs.json already carries, so the page can
draw a distribution without recomputing anything. Writes site/receptor/data/props.json.

    tools/build_props.py                            # site/data/drugs.json -> site/receptor/data/props.json
    tools/build_props.py --src X.json --out Y.json  # other paths
    tools/build_props.py --check                    # write nothing; exit 1 when the file on disk differs from what a run would write

No network, ever: every number here is computed locally from the stored SMILES, or copied from drugs.json. The output is
deterministic and byte-stable - compact JSON, sorted keys, no wall-clock timestamp (the provenance is the sha256 of the
input plus the RDKit version), and the file is only rewritten when its bytes would change. --check therefore also fails
if RDKit is upgraded under it, which is the point: the numbers belong to a version.

site/receptor/ lazily fetches this file on its own. The main app (site/index.html, site/js/**) must never request it:
its boot request budget and its first-load data budget are both full.

TWO DESCRIPTOR FAMILIES LIVE IN THIS FILE AND THEY ARE NOT INTERCHANGEABLE.
  "qed.*"  the eight properties QED itself scores, exactly as rdkit.Chem.QED.properties() defines them
           (MW, ALOGP, HBA, HBD, PSA, ROTB, AROM, ALERTS). QED's HBA counts matches of its own acceptor SMARTS list,
           HBD is CalcNumHBD, ROTB is the Strict rotatable-bond definition, AROM counts rings left after the aliphatic
           rings are deleted, ALERTS counts the alert SMARTS that match.
  "d.*"    the descriptors site/data/drugs.json already stores, as tools/build_data.py computed them: Crippen.MolLogP,
           Crippen.MolMR, CalcTPSA, Descriptors.MolWt, CalcNumLipinskiHBD / CalcNumLipinskiHBA, CalcNumRotatableBonds
           (default), CalcNumAromaticRings, CalcFractionCSP3, PubChem complexity, and the rule-of-five violation count.
Same name, different definition, in several cases different value: meta.namespacing in the output states the measured
difference per pair, so the page can never silently mix them.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import statistics
import sys

from rdkit import Chem, RDLogger, rdBase
from rdkit.Chem import QED

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SRC = os.path.join(ROOT, "site", "data", "drugs.json")
DEFAULT_OUT = os.path.join(ROOT, "site", "receptor", "data", "props.json")

QED_KEYS = ("MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS")
QED_INT = {"HBA", "HBD", "ROTB", "AROM", "ALERTS"}
D_KEYS = ("logp", "mr", "tpsa", "mw", "hbd", "hba", "rotb", "arom", "fsp3", "cx", "ro5")
D_INT = {"hbd", "hba", "rotb", "arom", "cx", "ro5"}

# How each summarised property is defined, and where it came from. Nothing here is measured: these are computations.
QED_DOC = {
    "MW": ("Molecular weight (QED)", "rdkit.Chem.QED.properties: rdMolDescriptors._CalcMolWt"),
    "ALOGP": ("Crippen log P (QED)", "rdkit.Chem.QED.properties: Crippen.MolLogP"),
    "HBA": ("H-bond acceptors (QED definition)", "rdkit.Chem.QED.properties: matches of QED's own acceptor SMARTS list"),
    "HBD": ("H-bond donors (QED definition)", "rdkit.Chem.QED.properties: rdMolDescriptors.CalcNumHBD"),
    "PSA": ("Polar surface area (QED)", "rdkit.Chem.QED.properties: MolSurf.TPSA"),
    "ROTB": ("Rotatable bonds (strict)", "rdkit.Chem.QED.properties: CalcNumRotatableBonds, NumRotatableBondsOptions.Strict"),
    "AROM": ("Aromatic rings (QED definition)", "rdkit.Chem.QED.properties: GetSSSR after deleting the aliphatic rings"),
    "ALERTS": ("Structural alerts fired", "rdkit.Chem.QED.properties: alert SMARTS of rdkit.Chem.QED.StructuralAlertSmarts that match"),
}
D_DOC = {
    "logp": ("Crippen log P", "site/data/drugs.json d.logp (RDKit Crippen.MolLogP)"),
    "mr": ("Molar refractivity (cm3/mol)", "site/data/drugs.json d.mr (RDKit Crippen.MolMR)"),
    "tpsa": ("TPSA (A^2)", "site/data/drugs.json d.tpsa (RDKit CalcTPSA, Ertl N and O surface)"),
    "mw": ("Molecular weight (Da)", "site/data/drugs.json d.mw (RDKit Descriptors.MolWt)"),
    "hbd": ("H-bond donors (Lipinski)", "site/data/drugs.json d.hbd (RDKit CalcNumLipinskiHBD)"),
    "hba": ("H-bond acceptors (Lipinski)", "site/data/drugs.json d.hba (RDKit CalcNumLipinskiHBA)"),
    "rotb": ("Rotatable bonds", "site/data/drugs.json d.rotb (RDKit CalcNumRotatableBonds, default)"),
    "arom": ("Aromatic rings", "site/data/drugs.json d.arom (RDKit CalcNumAromaticRings)"),
    "fsp3": ("Fraction of sp3 carbons", "site/data/drugs.json d.fsp3 (RDKit CalcFractionCSP3)"),
    "cx": ("Complexity", "site/data/drugs.json d.cx (PubChem Complexity, see meta.source.upstream_sources.pubchem)"),
    "ro5": ("Rule-of-five violations (0-4)", "site/data/drugs.json d.ro5 (counted by tools/build_data.py from mw, logp, hbd, hba)"),
}
# The QED component and the drugs.json descriptor that share a meaning, for the measured comparison in meta.namespacing.
SAME_MEANING = (("MW", "mw"), ("ALOGP", "logp"), ("PSA", "tpsa"), ("HBA", "hba"), ("HBD", "hbd"),
                ("ROTB", "rotb"), ("AROM", "arom"))

KDE_GRID = 64        # samples per curve; the page draws the curve over the histogram, same lo..hi
BIN_CAP = 60         # a Freedman-Diaconis count above this is clipped (heavy tails: the peptides) and said so
INT_BIN_SPAN = 60    # integer-valued property no wider than this gets one bin per integer value instead


def rnd(x, nd=4):
    """Round for output; keeps ints as ints so counts never print as 3.0."""
    if x is None:
        return None
    if isinstance(x, int):
        return x
    return round(float(x), nd)


def sig(x, digits=6):
    """Round to significant digits: a density of 2.3e-4 must not round to 0.0."""
    return None if x is None else float(f"{float(x):.{digits}g}")


def decimals(v):
    """Decimal places a stored value carries, so a QED component can be compared with the rounded value drugs.json
    stores without the rounding itself looking like a difference of definition."""
    t = repr(float(v))
    if "e" in t or "E" in t:
        return 6
    return len(t.split(".")[1].rstrip("0")) if "." in t else 0


def dump(obj):
    """Compact, stable JSON bytes (UTF-8, sorted keys, no ASCII escaping)."""
    return (json.dumps(obj, separators=(",", ":"), ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


# ------------------------------------------------------------------------------------------------------------ summaries
def histogram(vals, q1, q3, integer):
    """Fixed-bin histogram with the bin count from Freedman-Diaconis, h = 2 IQR n^(-1/3). Returns edges and counts.

    Integer-valued properties with a narrow range get one bin per value (edges on the half-integers) instead: a 0.37-wide
    FD bin over the alert counts would alternate full and empty bins. Anything wider than BIN_CAP bins is clipped there
    to keep the file small, and the clip is recorded."""
    n, lo, hi = len(vals), min(vals), max(vals)
    span = hi - lo
    iqr = q3 - q1
    fd_w = 2.0 * iqr * n ** (-1.0 / 3.0) if iqr > 0 else None
    fd_bins = max(1, math.ceil(span / fd_w)) if fd_w and span > 0 else None
    capped = False
    if span == 0:                                       # every drug has the same value
        rule, edges = "single-value", [lo - 0.5, lo + 0.5]
    elif integer and span <= INT_BIN_SPAN:
        rule = "integer"
        edges = [lo - 0.5 + i for i in range(int(round(span)) + 2)]
    else:
        if fd_bins is None:                             # IQR is zero but the tails are not: Sturges instead
            rule, bins = "sturges", int(math.ceil(math.log2(n)) + 1)
        else:
            rule, bins = "freedman-diaconis", fd_bins
        if bins > BIN_CAP:
            bins, capped = BIN_CAP, True
        edges = [lo + span * i / bins for i in range(bins + 1)]
    counts = [0] * (len(edges) - 1)
    for v in vals:
        i = int((v - edges[0]) / (edges[-1] - edges[0]) * len(counts))
        counts[min(max(i, 0), len(counts) - 1)] += 1
    out = {"rule": rule, "bins": len(counts), "edges": [rnd(e) for e in edges], "counts": counts,
           "bin_width": rnd((edges[-1] - edges[0]) / len(counts))}
    if fd_w:
        out["fd_bin_width"], out["fd_bins"] = rnd(fd_w), fd_bins
    if capped:
        out["capped_to"] = BIN_CAP
    return out


def kde(vals, sd, q1, q3, lo, hi):
    """Gaussian kernel density on a fixed grid of KDE_GRID points over lo..hi (the histogram's span, so the two overlay).

    Bandwidth by Silverman's rule, 0.9 min(sd, IQR/1.34) n^(-1/5). `y` is normalised to a peak of 1 so 4 dp is enough
    resolution for every property, however small the density itself is; peak_density carries the real scale (per unit of
    the property, from a curve normalised to integrate to 1 over the real line)."""
    n = len(vals)
    widths = [w for w in (sd, (q3 - q1) / 1.34) if w and w > 0]
    if not widths or hi == lo:
        return None
    bw = 0.9 * min(widths) * n ** (-0.2)
    if bw <= 0:
        return None
    norm = 1.0 / (n * bw * math.sqrt(2.0 * math.pi))
    ys = []
    for i in range(KDE_GRID):
        x = lo + (hi - lo) * i / (KDE_GRID - 1)
        s = 0.0
        for v in vals:
            z = (x - v) / bw
            if z * z < 50.0:                            # beyond 7 bandwidths the term is below 1e-11 of the peak
                s += math.exp(-0.5 * z * z)
        ys.append(s * norm)
    peak = max(ys)
    if peak <= 0:
        return None
    return {"kernel": "gaussian", "bw_rule": "silverman", "bw": sig(bw),
            "grid": {"lo": rnd(lo), "hi": rnd(hi), "n": KDE_GRID},
            "y": [rnd(y / peak) for y in ys], "peak_density": sig(peak)}


def summarise(vals, integer, label, source):
    """n / min / max / mean / median / q1 / q3 / sd / p1 / p99, a histogram and a KDE curve for one property.

    p1 and p99 are there so a page can clip its x-axis: several of these properties have a long peptide tail (molecular
    weight runs to 7177 Da) that pushes the whole distribution into the first few bins."""
    vals = sorted(float(v) for v in vals)
    n = len(vals)
    if n == 0:
        return {"n": 0, "label": label, "source": source, "min": None, "max": None, "mean": None, "median": None,
                "q1": None, "q3": None, "sd": None, "p1": None, "p99": None, "hist": None, "kde": None,
                "integer": integer}
    if n >= 4:
        q1, _med, q3 = statistics.quantiles(vals, n=4, method="inclusive")
    else:
        q1, q3 = vals[0], vals[-1]
    sd = statistics.stdev(vals) if n > 1 else 0.0
    pct = statistics.quantiles(vals, n=100, method="inclusive") if n >= 20 else None
    return {"n": n, "label": label, "source": source, "integer": integer,
            "p1": rnd(pct[0]) if pct else None, "p99": rnd(pct[98]) if pct else None,
            "min": rnd(vals[0]), "max": rnd(vals[-1]), "mean": rnd(statistics.fmean(vals)),
            "median": rnd(statistics.median(vals)), "q1": rnd(q1), "q3": rnd(q3), "sd": rnd(sd),
            "hist": histogram(vals, q1, q3, integer), "kde": kde(vals, sd, q1, q3, vals[0], vals[-1])}


# ----------------------------------------------------------------------------------------------------------------- build
def build(src_bytes):
    """The bytes a run writes, from the bytes of drugs.json. Pure, so --check and the tests need no disk."""
    RDLogger.DisableLog("rdApp.*")
    src = json.loads(src_bytes)
    drugs_in, src_meta = src.get("drugs") or [], src.get("meta") or {}
    if not drugs_in:
        raise ValueError("source has no drugs")
    alerts_smarts = list(QED.StructuralAlertSmarts)
    alert_pats = [Chem.MolFromSmarts(s) for s in alerts_smarts]
    if any(p is None for p in alert_pats):
        raise ValueError("an alert SMARTS from rdkit.Chem.QED did not parse")

    rows, gaps = [], []
    cols = {f"qed.{k}": [] for k in QED_KEYS}
    cols["qed"] = []
    for k in D_KEYS:
        cols[f"d.{k}"] = []
    alert_hits = [0] * len(alert_pats)
    pairs = {q: [] for q, _ in SAME_MEANING}             # measured |QED component - drugs.json descriptor| per drug

    for d in drugs_in:
        cid, name, smiles = d.get("cid"), d.get("name"), d.get("smiles")
        codes = sorted({e["code"] for e in (d.get("atc") or []) if e.get("code")})
        row = {"cid": cid, "name": name, "atc": codes, "atc1": sorted({c[0] for c in codes}),
               "qed": None, "qed_props": None, "alerts": None}
        mol = Chem.MolFromSmiles(smiles) if smiles else None
        if mol is None:
            # Never invent a value: the row keeps nulls and the gap is recorded.
            gaps.append({"cid": cid, "name": name, "field": "qed", "why": "SMILES did not parse with RDKit"})
            rows.append(row)
        else:
            p = QED.properties(mol)
            q = QED.qed(mol, qedProperties=p)
            flat = Chem.RemoveHs(mol)                   # QED.properties matches its alerts on the H-suppressed mol
            fired = [i for i, pat in enumerate(alert_pats) if flat.HasSubstructMatch(pat)]
            if len(fired) != p.ALERTS:                  # the count and the list must be the same thing
                raise ValueError(f"cid {cid}: {len(fired)} alerts matched but QED.properties says {p.ALERTS}")
            for i in fired:
                alert_hits[i] += 1
            row["qed"] = rnd(q, 4)
            row["qed_props"] = {k: (int(getattr(p, k)) if k in QED_INT else rnd(getattr(p, k), 3)) for k in QED_KEYS}
            row["alerts"] = fired
            cols["qed"].append(q)
            for k in QED_KEYS:
                cols[f"qed.{k}"].append(getattr(p, k))
            for qk, dk in SAME_MEANING:
                dv = (d.get("d") or {}).get(dk)
                if dv is not None:
                    qv = float(getattr(p, qk))
                    nd = decimals(dv)
                    pairs[qk].append((abs(qv - float(dv)), round(qv, nd) != round(float(dv), nd)))
            rows.append(row)
        for k in D_KEYS:
            v = (d.get("d") or {}).get(k)
            if v is None:
                gaps.append({"cid": cid, "name": name, "field": f"d.{k}", "why": "absent from site/data/drugs.json"})
            else:
                cols[f"d.{k}"].append(v)

    summary = {}
    for k in QED_KEYS:
        label, source = QED_DOC[k]
        summary[f"qed.{k}"] = summarise(cols[f"qed.{k}"], k in QED_INT, label, source)
    summary["qed"] = summarise(cols["qed"], False, "QED drug-likeness (0-1)", "rdkit.Chem.QED.qed, weights_mean")
    for k in D_KEYS:
        label, source = D_DOC[k]
        summary[f"d.{k}"] = summarise(cols[f"d.{k}"], k in D_INT, label, source)

    atc1 = {c: n for c, n in (src_meta.get("atc_names") or {}).items() if len(c) == 1}
    present = sorted({c[:n] for r in rows for c in r["atc"] for n in (1, 3, 4, 5) if len(c) >= n})
    all_names = src_meta.get("atc_names") or {}
    atc_names = {c: all_names[c] for c in present if c in all_names}
    for c in present:
        if c not in all_names:
            # Not invented here: WHO ATC names come from the data build, and this script is offline by design.
            gaps.append({"field": f"atc_names.{c}", "why": "site/data/drugs.json meta.atc_names has no name for this ATC "
                                                           "class; tools/build_data.py fetches those from the WHO ATC index",
                         "drugs": sorted(r["cid"] for r in rows if any(x.startswith(c) for x in r["atc"]))})
    compared = {}
    for qk, dk in SAME_MEANING:
        diffs = pairs[qk]
        n_diff = sum(1 for _, differs in diffs if differs)
        compared[f"qed.{qk} vs d.{dk}"] = {
            "n": len(diffs), "n_different": n_diff, "same_value_everywhere": n_diff == 0,
            "max_abs_diff": sig(max((x for x, _ in diffs), default=None)) if diffs else None}
    meta = {
        "v": 1,
        "computed": "locally by tools/build_props.py with RDKit, from the SMILES in site/data/drugs.json. No network, no "
                    "experimental measurement, no estimate: every number is a deterministic function of a stored structure.",
        "fetched_by": "site/receptor/ only, lazily. Never requested by site/index.html or site/js/** (their boot budgets are full).",
        "rdkit_version": rdBase.rdkitVersion,
        "source": {"file": "site/data/drugs.json", "sha256": hashlib.sha256(src_bytes).hexdigest(),
                   "n_drugs": len(drugs_in), "generated_utc": src_meta.get("generated_utc"),
                   "upstream_sources": src_meta.get("sources") or {}},
        "namespacing": {
            "note": "Two descriptor families, never to be mixed. 'qed.*' are the eight properties QED itself scores, as "
                    "rdkit.Chem.QED.properties() defines them. 'd.*' are the descriptors site/data/drugs.json already "
                    "stores, as tools/build_data.py computed them (Crippen.MolLogP, Crippen.MolMR, CalcTPSA, "
                    "Descriptors.MolWt, CalcNumLipinskiHBD / CalcNumLipinskiHBA, CalcNumRotatableBonds default, "
                    "CalcNumAromaticRings, CalcFractionCSP3, PubChem complexity, rule-of-five violations). Same name, "
                    "different definition: QED's HBA counts matches of its own acceptor SMARTS, its HBD is CalcNumHBD, "
                    "its ROTB is the Strict definition and its AROM counts the rings left after the aliphatic rings are "
                    "deleted. Each summary key carries its own 'source'.",
            "compared_how": "Per drug, the QED component against the drugs.json descriptor rounded as drugs.json stores "
                            "it, so storage rounding is not mistaken for a difference of definition. max_abs_diff is the "
                            "raw difference and can be a rounding step (5e-4) even where n_different is 0.",
            "per_drug_keys": {"qed": "rdkit.Chem.QED.qed", "qed_props": "the eight QED.properties components",
                              "alerts": "indices into meta.alerts.list of the alert SMARTS that match this drug; "
                                        "len(alerts) == qed_props.ALERTS",
                              "atc": "full ATC codes from drugs.json", "atc1": "ATC level-1 letters"},
            "compared": compared,
        },
        "stats": {"quantiles": "statistics.quantiles(n=4, method='inclusive'); p1 and p99 from n=100, present when n is at "
                  "least 20, there so a page can clip an axis away from the long peptide tail",
                  "mean": "statistics.fmean",
                  "sd": "statistics.stdev (sample)", "hist": "fixed bins, count by Freedman-Diaconis h = 2 IQR n^(-1/3), "
                  f"clipped at {BIN_CAP} bins; integer-valued properties spanning at most {INT_BIN_SPAN} get one bin per "
                  "value, edges on the half-integers", "kde": "gaussian kernel, Silverman bandwidth, "
                  f"{KDE_GRID} samples over the observed range; y is normalised to a peak of 1, peak_density carries the scale",
                  "rounding": "4 dp for summary statistics and the normalised curve, 3 dp for per-drug float properties, "
                              "6 significant digits for bandwidths and densities"},
        "alerts": {
            "catalogue": "rdkit.Chem.QED.StructuralAlertSmarts",
            "note": "The unwanted-substructure alerts of RDKit's QED implementation (the ALERTS component). ALERTS is the "
                    "component that most often explains a surprisingly low QED: it is the most heavily weighted of the "
                    "eight. 'n' is how many of these drugs match each alert.",
            "n": len(alerts_smarts),
            "list": [{"i": i, "smarts": s, "n": alert_hits[i]} for i, s in enumerate(alerts_smarts)],
        },
        "atc": {"note": "atc1 are ATC level-1 letters; atc holds the full codes so any level prefix (A, A02, A02B, A02BA) "
                        "can be overlaid against all drugs.", "level1_names": atc1, "names": atc_names},
        "drug_order": "same order as site/data/drugs.json",
        "n_drugs": len(rows),
        "n_scored": sum(1 for r in rows if r["qed"] is not None),
        "gaps": gaps,
    }
    return dump({"meta": meta, "drugs": rows, "summary": summary})


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=DEFAULT_SRC, help="drug table to read (default: site/data/drugs.json)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="file to write (default: site/receptor/data/props.json)")
    ap.add_argument("--check", action="store_true", help="write nothing; exit 1 when the file on disk differs from what a run would write")
    a = ap.parse_args(argv)
    try:
        with open(a.src, "rb") as f:
            data = build(f.read())
    except (OSError, ValueError) as e:
        print(f"build_props: {e}", file=sys.stderr)
        return 2
    try:
        with open(a.out, "rb") as f:
            same = f.read() == data
    except OSError:
        same = False
    if a.check:
        if not same:
            print(f"build_props: {a.out} is not what a run would write (RDKit {rdBase.rdkitVersion})", file=sys.stderr)
            return 1
        print(f"build_props: ok, {a.out} is byte-identical to a fresh run ({len(data)} bytes)")
        return 0
    if not same:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        write_atomic(a.out, data)
    doc = json.loads(data)
    gz = len(gzip.compress(data, 6)) / 1024
    print(f"build_props: {doc['meta']['n_scored']}/{doc['meta']['n_drugs']} drugs scored, {len(doc['summary'])} property "
          f"summaries, {len(doc['meta']['gaps'])} gaps; {len(data) / 1024:.0f} KB raw, {gz:.1f} KB gzip -6 "
          f"({'unchanged' if same else 'written'}: {a.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
