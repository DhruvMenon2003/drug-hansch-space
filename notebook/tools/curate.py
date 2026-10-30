"""Build the curated dataset and its provenance table from ChEMBL.

Two papers, chosen because each measures BOTH endpoints on the same compounds with one
assay per endpoint, so a therapeutic index can be formed without mixing assays:

  training  CHEMBL1821550  Bioorg Med Chem Lett 2011, doi:10.1016/j.bmcl.2011.07.006
            "Novel and highly potent histamine H3 receptor ligands. Part 1: withdrawing
            of hERG activity" - H3 Ki by [125I]iodoproxyfan displacement, hERG IC50.
  external  CHEMBL1155513  Bioorg Med Chem Lett 2010, doi:10.1016/j.bmcl.2010.04.045
            "In vitro studies on a class of quinoline containing histamine H3 antagonists"
            - H3 Ki by [3H]N-alpha-methylhistamine displacement, hERG Ki by [3H]dofetilide.

Every value written here is a measurement reported in one of those papers and recorded by
ChEMBL. Nothing is predicted, imputed or read across, and the endpoint standard type is
never mixed within a set.
"""
from __future__ import annotations

import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass

BASE = "https://www.ebi.ac.uk/chembl/api/data"

SETS = {
    "training": {
        "document": "CHEMBL1821550",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "IC50", "label": "hERG"},
    },
    "external": {
        "document": "CHEMBL1155513",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "Ki", "label": "hERG"},
    },
}


USER_AGENT = "drug-hansch-space-qsar-notebook (ChEMBL REST client)"


def _get(url: str, tries: int = 5) -> dict:
    """ChEMBL answers 500 to a request with no User-Agent, so always send one."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                                       "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def paged(path: str, params: dict, limit: int = 1000) -> list[dict]:
    out: list[dict] = []
    offset = 0
    while True:
        q = dict(params, limit=limit, offset=offset, format="json")
        d = _get(f"{BASE}/{path}.json?" + urllib.parse.urlencode(q))
        key = next(k for k in d if k != "page_meta")
        batch = d[key]
        out.extend(batch)
        if len(batch) < limit:
            return out
        offset += limit


def document_citation(doc_id: str) -> dict:
    d = _get(f"{BASE}/document/{doc_id}.json")
    return {"document_chembl_id": doc_id, "doi": d.get("doi"), "pubmed_id": d.get("pubmed_id"),
            "journal": d.get("journal"), "year": d.get("year"), "title": d.get("title")}


@dataclass
class Record:
    set_name: str
    compound_id: str
    smiles: str
    endpoint: str
    target_chembl_id: str
    standard_type: str
    value_nM: float
    p_value: float
    unit: str
    source_type: str
    citation: str
    assay_chembl_id: str
    assay_description: str


def p_from_nM(value_nM: float) -> float:
    """-log10 of the molar concentration. The only arithmetic applied to a measurement."""
    return -math.log10(value_nM * 1e-9)


def collect(set_name: str, spec: dict) -> tuple[list[Record], dict]:
    doc = spec["document"]
    cite = document_citation(doc)
    citation = f"doi:{cite['doi']}" if cite["doi"] else f"pmid:{cite['pubmed_id']}"
    rows = paged("activity", {"document_chembl_id": doc, "assay_type": "B",
                              "standard_relation": "=", "standard_units": "nM"})
    records: list[Record] = []
    for role in ("activity", "toxicity"):
        want = spec[role]
        hits = [r for r in rows
                if r["target_chembl_id"] == want["target"]
                and r["standard_type"] == want["standard_type"]
                and r.get("standard_value") is not None
                and not r.get("data_validity_comment")]
        assays = {r["assay_chembl_id"] for r in hits}
        if len(assays) != 1:
            raise SystemExit(
                f"{set_name}/{role}: expected one assay, found {len(assays)}: {sorted(assays)}")
        for r in hits:
            v = float(r["standard_value"])
            if v <= 0:
                continue
            records.append(Record(
                set_name=set_name, compound_id=r["molecule_chembl_id"],
                smiles=r["canonical_smiles"], endpoint=want["label"],
                target_chembl_id=want["target"], standard_type=want["standard_type"],
                value_nM=v, p_value=p_from_nM(v), unit="nM",
                source_type="experimental", citation=citation,
                assay_chembl_id=r["assay_chembl_id"],
                assay_description=r["assay_description"] or ""))
    return records, cite


def build() -> dict:
    out = {"sets": {}, "citations": {}, "records": []}
    for name, spec in SETS.items():
        recs, cite = collect(name, spec)
        out["citations"][name] = cite
        out["records"].extend(asdict(r) for r in recs)
        by_cmpd: dict[str, dict] = {}
        for r in recs:
            by_cmpd.setdefault(r.compound_id, {})[r.endpoint] = r
        paired = {c: v for c, v in by_cmpd.items() if len(v) == 2}
        out["sets"][name] = {
            "document": spec["document"],
            "activity_measurements": sum(1 for r in recs if r.endpoint == "H3"),
            "toxicity_measurements": sum(1 for r in recs if r.endpoint == "hERG"),
            "compounds_with_both": len(paired),
            "compounds_with_activity_only": sum(
                1 for v in by_cmpd.values() if set(v) == {"H3"}),
            "compounds_with_toxicity_only": sum(
                1 for v in by_cmpd.values() if set(v) == {"hERG"}),
        }
    return out


def table(data: dict) -> list[dict]:
    """One row per compound: both measurements, the index, and where each came from."""
    rows = []
    for name in SETS:
        recs = [r for r in data["records"] if r["set_name"] == name]
        by: dict[str, dict] = {}
        for r in recs:
            by.setdefault(r["compound_id"], {})[r["endpoint"]] = r
        for cmpd, pair in sorted(by.items()):
            act, tox = pair.get("H3"), pair.get("hERG")
            rows.append({
                "set": name,
                "compound_id": cmpd,
                "smiles": (act or tox)["smiles"],
                "p_activity_H3": act["p_value"] if act else None,
                "activity_standard_type": act["standard_type"] if act else None,
                "activity_value_nM": act["value_nM"] if act else None,
                "p_toxicity_hERG": tox["p_value"] if tox else None,
                "toxicity_standard_type": tox["standard_type"] if tox else None,
                "toxicity_value_nM": tox["value_nM"] if tox else None,
                "therapeutic_index": (act["p_value"] - tox["p_value"]) if (act and tox) else None,
                "endpoint_source_type": "experimental",
                "citation": (act or tox)["citation"],
                "activity_assay": act["assay_chembl_id"] if act else None,
                "toxicity_assay": tox["assay_chembl_id"] if tox else None,
                "missing": ",".join(
                    e for e, present in (("p_activity_H3", act), ("p_toxicity_hERG", tox))
                    if not present) or None,
            })
    return rows


def sha256_of_rows(rows: list[dict], columns: list[str]) -> str:
    h = hashlib.sha256()
    for r in rows:
        h.update(("|".join("" if r.get(c) is None else str(r[c]) for c in columns) + "\n").encode())
    return h.hexdigest()


if __name__ == "__main__":
    import csv
    import sys

    dest = sys.argv[1]
    data = build()
    rows = table(data)
    cols = list(rows[0])
    with open(dest, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    json.dump(data["citations"], open(dest.replace(".csv", "_citations.json"), "w"), indent=1)
    for name, s in data["sets"].items():
        print(f"{name}: {s}")
    print(f"rows {len(rows)} -> {dest}")
    print("sha256", sha256_of_rows(rows, cols))
