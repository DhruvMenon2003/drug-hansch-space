#!/usr/bin/env python3
"""Build site/data/props.json: the per-drug properties the distribution panel adds to the explorer.

Everything here is computed by RDKit from the curated SMILES already in site/data/drugs.json, so the file can be
rebuilt without any network access and without the curated table:

    python3 tools/build_props.py

The headline property is QED (Bickerton et al. 2012), the RDKit implementation with the paper's mean weights. QED is
the weighted geometric mean of eight desirability functions, one per property, so the file also carries each of those
eight desirabilities and names the one that limits each drug. That is what makes a "distribution of each
physicochemical property individually" readable: a drug's QED is low because of a particular property, and the panel
can say which.

Output:
    props.json   {meta, defs:[{key,label,long,dec,...}], cids:[...], cols:{key:[value per cid]}}
                 columns, not records: the file gzips to a fraction of a record-per-drug layout.
"""
import argparse, datetime as dt, json, math, os, sys

from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, QED, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")

# The eight QED properties, in the order RDKit's QEDproperties uses (the order WEIGHT_MEAN is written in).
QED_PROPS = ("MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS")
QED_LABEL = {"MW": "weight", "ALOGP": "log P", "HBA": "acceptors", "HBD": "donors", "PSA": "TPSA",
             "ROTB": "rotatable bonds", "AROM": "aromatic rings", "ALERTS": "structural alerts"}

DEFS = [
    {"key": "qed", "label": "QED", "dec": 2,
     "long": "Quantitative estimate of drug-likeness (RDKit, mean weights): 0 to 1, higher is more drug-like"},
    {"key": "qedmax", "label": "QED (max weights)", "dec": 2,
     "long": "QED with the paper's maximal weights instead of the mean ones"},
    {"key": "alerts", "label": "Structural alerts", "dec": 0,
     "long": "Brenk/QED structural alerts matched (the ALERTS term of QED)"},
    {"key": "rotbs", "label": "Rotatable bonds (strict)", "dec": 0,
     "long": "Rotatable bonds under RDKit's strict definition, as QED counts them"},
    {"key": "hbaq", "label": "Acceptors (QED)", "dec": 0,
     "long": "Hydrogen-bond acceptors under QED's own SMARTS set, not the Lipinski N+O count"},
    {"key": "aromq", "label": "Aromatic rings (QED)", "dec": 0,
     "long": "Aromatic rings as QED counts them (ring perception after deleting aliphatic rings)"},
]
DEFS += [{"key": "d" + p, "label": f"QED desirability: {QED_LABEL[p]}", "dec": 2,
          "long": f"The desirability function QED applies to {QED_LABEL[p]}: 0 (bad) to 1 (ideal)"} for p in QED_PROPS]


def main(argv=None):
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.path.join(here, "site"))
    ap.add_argument("--out", default=None, help="default: <site>/data/props.json")
    a = ap.parse_args(argv)
    src = os.path.join(a.site, "data", "drugs.json")
    out = a.out or os.path.join(a.site, "data", "props.json")

    dj = json.load(open(src, encoding="utf-8"))
    drugs = dj["drugs"]
    cids, cols = [], {d["key"]: [] for d in DEFS}
    cols["qlim"] = []                      # which of the eight terms has the lowest desirability
    failed = []
    for d in drugs:
        smi = d.get("smiles")
        mol = Chem.MolFromSmiles(smi) if smi else None
        cids.append(d["cid"])
        if mol is None:
            failed.append(d["name"])
            for k in cols:
                cols[k].append(None)
            continue
        p = QED.properties(mol)
        des = {name: QED.ads(float(v), QED.adsParameters[name]) for name, v in p._asdict().items()}
        vals = {
            "qed": QED.qed(mol, qedProperties=p),
            "qedmax": QED.qed(mol, w=QED.WEIGHT_MAX, qedProperties=p),
            "alerts": p.ALERTS, "rotbs": p.ROTB, "hbaq": p.HBA, "aromq": p.AROM,
        }
        for name in QED_PROPS:
            vals["d" + name] = des[name]
        for k, v in vals.items():
            cols[k].append(None if v is None else (round(float(v), 4) if isinstance(v, float) else int(v)))
        cols["qlim"].append(min(QED_PROPS, key=lambda n: des[n]))

    meta = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "n_drugs": len(cids),
        "from": "site/data/drugs.json (curated SMILES)",
        "rdkit_qed": "rdkit.Chem.QED, weights WEIGHT_MEAN; desirabilities from QED.ads with QED.adsParameters",
        "citation": "Bickerton GR, Paolini GV, Besnard J, Muresan S, Hopkins AL. Quantifying the chemical beauty of "
                    "drugs. Nat Chem. 2012;4(2):90-98. doi:10.1038/nchem.1243",
        "qed_terms": list(QED_PROPS),
        "failed": failed,
    }
    json.dump({"meta": meta, "defs": DEFS, "cids": cids, "cols": cols},
              open(out, "w", encoding="utf-8"), separators=(",", ":"))
    ok = sum(1 for v in cols["qed"] if v is not None)
    qs = sorted(v for v in cols["qed"] if v is not None)
    print(f"props.json: {len(cids)} drugs, QED for {ok}"
          + (f", median {qs[len(qs) // 2]:.2f}, range {qs[0]:.2f} to {qs[-1]:.2f}" if qs else "")
          + (f"; {len(failed)} SMILES would not parse" if failed else ""))
    lim = {}
    for v in cols["qlim"]:
        if v:
            lim[v] = lim.get(v, 0) + 1
    print("limiting QED term: " + ", ".join(f"{k} {n}" for k, n in sorted(lim.items(), key=lambda kv: -kv[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
