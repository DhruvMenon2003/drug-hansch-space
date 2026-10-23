"""Per-target QSAR datasets for the explorer's QSAR builder (site/js/builder.js).

For every human single-protein target that an explorer drug acts on (ChEMBL mechanism of action), fetch measured
binding data from the ChEMBL REST API and clean it the same way for every target:

  1. one assay type and one unit per target: binding assays (B), exact values (relation '='), no ChEMBL validity
     comment, and a single standard type (Ki if it has enough compounds, otherwise IC50). Values are ChEMBL's pChEMBL,
     i.e. -log10 of the molar value after ChEMBL converted the reported unit to nM, so every target is in one unit.
  2. RDKit standardisation: cleanup, largest organic fragment, uncharger, canonical tautomer. Molecules that still
     contain a metal or other non-organic element after the fragment choice are dropped (e.g. Ra, Tc, Pt, As).
  3. duplicates (same standardized InChIKey) are merged to the median; a compound whose measurements spread more
     than 1 log unit is dropped as unreliable.
  4. descriptors, rule flags (Ro5, Ro3, Pfizer 3/75), Butina clusters on Morgan fingerprints, and activity-cliff pairs
     (Tanimoto >= 0.8 with a >= 1.5 log-unit gap; a fingerprint stand-in for mmpdb matched pairs).

Targets with fewer than MIN_N clean compounds are listed but not exported. Large targets are capped at CAP compounds
by a seeded random draw so each file stays small. Output: site/data/qsar/index.json and site/data/qsar/<target>.json.

Run:  python3 tools/build_qsar_targets.py            (network; responses cached under tools/data/cache_qsar/)
"""
from __future__ import annotations

import hashlib
import json
import random
import statistics
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
import urllib.parse
import urllib.request
from pathlib import Path

from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdFingerprintGenerator, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize
from rdkit.ML.Cluster import Butina

RDLogger.DisableLog("rdApp.*")
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools/data/cache_qsar"
OUT = ROOT / "site/data/qsar"
API = "https://www.ebi.ac.uk/chembl/api/data/"
MIN_N, CAP, SEED, MAX_ROWS = 15, 250, 42, 4000
ORGANIC = {1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 34, 35, 53}
DESCRIPTORS = ["logp", "mr", "tpsa", "mw", "hbd", "hba", "rotb", "arom", "fsp3", "heavy"]


def get(path: str, params: dict) -> dict:
    """GET a ChEMBL JSON endpoint, cached on disk by URL."""
    url = API + path + "?" + urllib.parse.urlencode(params)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.load(r)
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data))
    return data


def paged(path: str, params: dict, cap: int = 10**9) -> list:
    rows, offset = [], 0
    while len(rows) < cap:
        page = get(path, {**params, "limit": 1000, "offset": offset})
        key = next(k for k in page if k != "page_meta")
        rows += page[key]
        if not page["page_meta"]["next"]:
            break
        offset += 1000
    return rows[:cap]


# ---------------------------------------------------------------- standardisation
_clean = rdMolStandardize.CleanupParameters()
_frag = rdMolStandardize.LargestFragmentChooser(preferOrganic=True)
_unch = rdMolStandardize.Uncharger()
_taut = rdMolStandardize.TautomerEnumerator()


@lru_cache(maxsize=None)
def standardize(smiles: str):
    """Return (mol, reason). mol is None when the structure is unusable for QSAR."""
    m = Chem.MolFromSmiles(smiles or "")
    if m is None:
        return None, "unparseable"
    m = rdMolStandardize.Cleanup(m, _clean)
    m = _unch.uncharge(_frag.choose(m))
    elements = {a.GetAtomicNum() for a in m.GetAtoms()}
    if elements - ORGANIC or 6 not in elements:
        return None, "inorganic or metal"
    try:
        m = _taut.Canonicalize(m)
    except Exception:
        pass
    return m, ""


def descriptors(m) -> dict:
    return {"logp": round(Crippen.MolLogP(m), 3), "mr": round(Crippen.MolMR(m), 2),
            "tpsa": round(rdMolDescriptors.CalcTPSA(m), 2), "mw": round(Descriptors.MolWt(m), 2),
            "hbd": Lipinski.NumHDonors(m), "hba": Lipinski.NumHAcceptors(m),
            "rotb": rdMolDescriptors.CalcNumRotatableBonds(m), "arom": rdMolDescriptors.CalcNumAromaticRings(m),
            "fsp3": round(rdMolDescriptors.CalcFractionCSP3(m), 3), "heavy": m.GetNumHeavyAtoms()}


def rule_flags(d: dict) -> list:
    """Rules violated: Ro5 (more than one violation), Ro3 (fragment rule), Pfizer 3/75 (toxicity risk)."""
    ro5 = sum([d["mw"] > 500, d["logp"] > 5, d["hbd"] > 5, d["hba"] > 10])
    out = []
    if ro5 > 1:
        out.append("Ro5")
    if not (d["mw"] <= 300 and d["logp"] <= 3 and d["hbd"] <= 3 and d["hba"] <= 3 and d["rotb"] <= 3):
        out.append("Ro3")
    if d["logp"] > 3 and d["tpsa"] < 75:
        out.append("Pfizer")
    return out


# ---------------------------------------------------------------- targets
def explorer_targets() -> dict:
    drugs = json.loads((ROOT / "site/data/drugs.json").read_text())["drugs"]
    chembl = sorted({d["chembl"] for d in drugs if d.get("chembl")})
    mech = []
    for i in range(0, len(chembl), 50):
        mech += paged("mechanism.json", {"molecule_chembl_id__in": ",".join(chembl[i:i + 50])})
    by_target: dict = {}
    for m in mech:
        if m.get("target_chembl_id"):
            by_target.setdefault(m["target_chembl_id"], set()).add(m["molecule_chembl_id"])
    ids = sorted(by_target)
    info = {}
    for i in range(0, len(ids), 50):
        for t in paged("target.json", {"target_chembl_id__in": ",".join(ids[i:i + 50])}):
            if t["target_type"] == "SINGLE PROTEIN" and t["organism"] == "Homo sapiens":
                info[t["target_chembl_id"]] = {"name": t["pref_name"], "drugs": sorted(by_target[t["target_chembl_id"]])}
    return info


def fetch(target: str, standard_type: str) -> list:
    return paged("activity.json", {
        "target_chembl_id": target, "standard_type": standard_type, "assay_type": "B",
        "standard_relation": "=", "pchembl_value__isnull": "false",
        "only": "molecule_chembl_id,canonical_smiles,pchembl_value,standard_units,assay_chembl_id,"
                "document_chembl_id,data_validity_comment"}, MAX_ROWS)


def build(target: str, meta: dict) -> dict:
    ledger = {"rows": 0, "validity comment": 0, "unparseable": 0, "inorganic or metal": 0,
              "duplicates merged": 0, "spread > 1 log unit": 0}
    chosen = None
    for st in ("Ki", "IC50"):
        rows = fetch(target, st)
        if len({r["molecule_chembl_id"] for r in rows}) >= MIN_N:
            chosen = (st, rows)
            break
    if not chosen:
        return {"n": 0}
    st, rows = chosen
    ledger["rows"] = len(rows)
    groups: dict = {}
    for r in rows:
        if r.get("data_validity_comment"):
            ledger["validity comment"] += 1
            continue
        m, why = standardize(r["canonical_smiles"])
        if m is None:
            ledger[why] += 1
            continue
        ik = Chem.MolToInchiKey(m)
        g = groups.setdefault(ik, {"mol": m, "ids": set(), "vals": [], "docs": set()})
        g["ids"].add(r["molecule_chembl_id"])
        g["vals"].append(float(r["pchembl_value"]))
        g["docs"].add(r["document_chembl_id"])
    comps = []
    for ik, g in groups.items():
        ledger["duplicates merged"] += len(g["vals"]) - 1
        if max(g["vals"]) - min(g["vals"]) > 1:
            ledger["spread > 1 log unit"] += 1
            continue
        d = descriptors(g["mol"])
        comps.append({"id": sorted(g["ids"])[0], "ik": ik, "smiles": Chem.MolToSmiles(g["mol"]),
                      "y": round(statistics.median(g["vals"]), 2), "nm": len(g["vals"]), **d,
                      "rules": rule_flags(d)})
    n_clean = len(comps)
    if n_clean < MIN_N:
        return {"n": n_clean, "type": st}
    comps.sort(key=lambda c: c["ik"])
    if len(comps) > CAP:
        comps = sorted(random.Random(SEED).sample(comps, CAP), key=lambda c: c["ik"])
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    fps = [gen.GetFingerprint(Chem.MolFromSmiles(c["smiles"])) for c in comps]
    dist = []
    for i in range(1, len(fps)):
        sims = DataStructs.BulkTanimotoSimilarity(fps[i], fps[:i])
        dist += [1 - s for s in sims]
    for k, cluster in enumerate(sorted(Butina.ClusterData(dist, len(fps), 0.6, isDistData=True), key=len, reverse=True)):
        for i in cluster:
            comps[i]["cl"] = k
    cliffs = []
    for i in range(1, len(fps)):
        for j, s in enumerate(DataStructs.BulkTanimotoSimilarity(fps[i], fps[:i])):
            gap = abs(comps[i]["y"] - comps[j]["y"])
            if s >= 0.8 and gap >= 1.5:
                cliffs.append([j, i, round(s, 2), round(gap, 2)])
    return {"schema_version": 1, "target": {"id": target, "name": meta["name"], "organism": "Homo sapiens"},
            "explorer_drugs": meta["drugs"], "standard_type": st, "assay_type": "B",
            "activity": f"p{st} (-log10 mol/L, ChEMBL pChEMBL)", "n_clean": n_clean, "n": len(comps),
            "capped": n_clean > CAP, "seed": SEED, "descriptors": DESCRIPTORS, "ledger": ledger,
            "cliff_rule": "Morgan r2 Tanimoto >= 0.8 and |delta p| >= 1.5", "butina_cutoff": 0.6,
            "compounds": comps, "cliffs": cliffs}


def main() -> None:
    targets = explorer_targets()
    print(f"{len(targets)} human single-protein targets", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    items = sorted(targets.items())
    with ProcessPoolExecutor() as pool:                      # RDKit standardisation is CPU-bound; the API calls are cached
        results = list(pool.map(build, *zip(*items)))
    for (tid, meta), res in zip(items, results):
        row = {"id": tid, "name": meta["name"], "n_drugs": len(meta["drugs"]), "n": res.get("n", 0),
               "type": res.get("standard_type") or res.get("type")}
        if res.get("compounds"):
            (OUT / f"{tid}.json").write_text(json.dumps(res, separators=(",", ":")))
            row["file"] = f"data/qsar/{tid}.json"
            row["n_clean"] = res["n_clean"]
        index.append(row)
        print(tid, row["n"], row["type"], file=sys.stderr)
    index.sort(key=lambda r: (-r["n"], r["name"]))
    (OUT / "index.json").write_text(json.dumps({"schema_version": 1, "min_n": MIN_N, "cap": CAP,
                                                "source": "ChEMBL REST API", "targets": index}, separators=(",", ":")))


if __name__ == "__main__":
    main()
