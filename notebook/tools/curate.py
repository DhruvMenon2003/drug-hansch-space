"""Build the curated dataset and its provenance table from ChEMBL, filter by filter.

Two papers, chosen because each measures BOTH endpoints on the same compounds with one
assay per endpoint, so a therapeutic index can be formed without mixing assays:

  training  CHEMBL1821550  Bioorg Med Chem Lett 2011, doi:10.1016/j.bmcl.2011.07.006
            "Novel and highly potent histamine H3 receptor ligands. Part 1: withdrawing
            of hERG activity" - H3 Ki by [125I]iodoproxyfan displacement (CHEMBL1827363),
            hERG IC50 by [3H]dofetilide displacement (CHEMBL1827362).
  external  CHEMBL1155513  Bioorg Med Chem Lett 2010, doi:10.1016/j.bmcl.2010.04.045
            "In vitro studies on a class of quinoline containing histamine H3 antagonists"
            - H3 Ki by [3H]N-alpha-methylhistamine displacement (CHEMBL1120717), hERG Ki
            by [3H]dofetilide displacement in HEK293 cells (CHEMBL1120719).

Every value written here is a measurement reported in one of those papers and recorded by
ChEMBL. Nothing is predicted, imputed or read across, and the endpoint standard type is
never mixed within a set. Each filter reports rows in, rows out and its reason, and the
ChEMBL release the pull ran against is recorded alongside the row hash.
"""
from __future__ import annotations

import collections
import hashlib
import json
import math
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field

BASE = "https://www.ebi.ac.uk/chembl/api/data"

# The four documents in ChEMBL that measure histamine H3 affinity and hERG affinity on the
# same molecules. Found, not assumed: `document_scan()` below reproduces the search, and no
# other document in the release pairs the two endpoints on ten compounds or more.
#
# CHEMBL1821550 is the training paper. The other three are external, and they are kept
# SEPARATE rather than pooled into one bag, because each uses a different readout:
#   CHEMBL1155513  H3 [3H]N-alpha-methylhistamine   hERG [3H]dofetilide displacement
#   CHEMBL2029265  H3 [3H]-(R)-alpha-methylhistamine hERG IonWorks patch clamp (FUNCTIONAL)
#   CHEMBL2375287  H3 [3H]histamine                 hERG [3H]astemizole displacement
# against the training paper's own H3 [125I]iodoproxyfan and hERG [3H]dofetilide. Metrics are
# reported per document and pooled, so the spread between laboratories is visible.
SETS = {
    "training": {
        "role": "training",
        "document": "CHEMBL1821550",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "IC50", "label": "hERG"},
    },
    "external_quinoline": {
        "role": "external",
        "document": "CHEMBL1155513",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "Ki", "label": "hERG"},
    },
    "external_ionworks": {
        "role": "external",
        "document": "CHEMBL2029265",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "IC50", "label": "hERG"},
    },
    "external_astemizole": {
        "role": "external",
        "document": "CHEMBL2375287",
        "activity": {"target": "CHEMBL264", "standard_type": "Ki", "label": "H3"},
        "toxicity": {"target": "CHEMBL240", "standard_type": "Ki", "label": "hERG"},
    },
}

H3_TARGET = "CHEMBL264"
HERG_TARGET = "CHEMBL240"

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


def chembl_release() -> dict:
    """The release the pull ran against. Without this a row hash pins nothing."""
    s = _get(f"{BASE}/status.json")
    return {"release": s.get("chembl_db_version"), "release_date": s.get("chembl_release_date"),
            "activities": s.get("activities"), "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                                          time.gmtime())}


def document_citation(doc_id: str) -> dict:
    d = _get(f"{BASE}/document/{doc_id}.json")
    return {"document_chembl_id": doc_id, "doi": d.get("doi"), "pubmed_id": d.get("pubmed_id"),
            "journal": d.get("journal"), "year": d.get("year"), "title": d.get("title")}


# ---------------------------------------------------------------------------------------
# The filter ledger. Each entry is (label, reason, predicate); `apply_filters` runs them in
# order and returns the surviving rows plus a row-by-row account of what each one removed.
# ---------------------------------------------------------------------------------------

def _positive_value(r: dict) -> bool:
    v = r.get("standard_value")
    if v in (None, ""):
        return False
    try:
        return float(v) > 0
    except (TypeError, ValueError):
        return False


FILTERS: list[tuple[str, str, object]] = [
    ("assay_type == B", "a binding assay, so the number is an affinity and not a phenotype",
     lambda r: r.get("assay_type") == "B"),
    ("standard_relation == '='", "an exact value, not a censored '>' or '<' bound",
     lambda r: r.get("standard_relation") == "="),
    ("standard_units == 'nM'", "one concentration unit, so no unit conversion is needed",
     lambda r: r.get("standard_units") == "nM"),
    ("standard_value > 0", "a positive concentration, since the response is -log10 of it",
     _positive_value),
    ("data_validity_comment empty", "ChEMBL has not flagged the value as suspect",
     lambda r: not r.get("data_validity_comment")),
    ("pchembl_value present", "ChEMBL derived a p-value, which it declines to do for a "
                              "value it distrusts",
     lambda r: r.get("pchembl_value") not in (None, "")),
    ("canonical_smiles present", "there is a structure to compute descriptors from",
     lambda r: bool(r.get("canonical_smiles"))),
]


def apply_filters(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    ledger = []
    kept = list(rows)
    for label, reason, keep in FILTERS:
        before = len(kept)
        kept = [r for r in kept if keep(r)]
        ledger.append({"filter": label, "reason": reason, "rows_in": before,
                       "rows_out": len(kept), "dropped": before - len(kept)})
    return kept, ledger


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
    potential_duplicate: int = 0


@dataclass
class SetReport:
    name: str
    document: str
    rows_in_document: int
    ledger: list[dict] = field(default_factory=list)
    surviving_pairs: dict = field(default_factory=dict)
    endpoints: dict = field(default_factory=dict)
    duplicate_groups_collapsed: int = 0
    duplicate_flag_rows: dict = field(default_factory=dict)
    counts: dict = field(default_factory=dict)


def p_from_nM(value_nM: float) -> float:
    """-log10 of the molar concentration. The only arithmetic applied to a measurement."""
    return -math.log10(value_nM * 1e-9)


def collect(set_name: str, spec: dict) -> tuple[list[Record], dict, SetReport]:
    doc = spec["document"]
    cite = document_citation(doc)
    citation = f"doi:{cite['doi']}" if cite["doi"] else f"pmid:{cite['pubmed_id']}"
    raw = paged("activity", {"document_chembl_id": doc})
    kept, ledger = apply_filters(raw)
    report = SetReport(name=set_name, document=doc, rows_in_document=len(raw), ledger=ledger)
    report.surviving_pairs = {f"{t}/{st}": c for (t, st), c in sorted(
        collections.Counter((r["target_chembl_id"], r["standard_type"]) for r in kept).items())}

    records: list[Record] = []
    for role in ("activity", "toxicity"):
        want = spec[role]
        hits = [r for r in kept if r["target_chembl_id"] == want["target"]
                and r["standard_type"] == want["standard_type"]]
        assays = sorted({r["assay_chembl_id"] for r in hits})
        if len(assays) != 1:
            raise SystemExit(
                f"{set_name}/{role}: expected one assay, found {len(assays)}: {assays}")

        # potential_duplicate is ChEMBL's note that the same measurement appears elsewhere in
        # the database. It is recorded, not acted on: the key that matters for this dataset is
        # (compound, target, standard_type) inside one document, and that is deduplicated
        # explicitly below. Dropping every flagged row would delete measurements that are the
        # only row for their compound.
        flagged = sum(1 for r in hits if r.get("potential_duplicate"))
        groups: dict[str, list[dict]] = collections.defaultdict(list)
        for r in hits:
            groups[r["molecule_chembl_id"]].append(r)
        collapsed, disagreeing = 0, []
        chosen = []
        for mol, rs in groups.items():
            if len(rs) > 1:
                collapsed += 1
                vals = sorted({round(float(x["standard_value"]), 6) for x in rs})
                if len(vals) > 1:
                    disagreeing.append({"compound_id": mol, "values_nM": vals})
                rs = sorted(rs, key=lambda x: float(x["standard_value"]))
                rs = [rs[len(rs) // 2]]          # median row, so no value is invented
            chosen.append(rs[0])
        report.duplicate_groups_collapsed += collapsed
        report.duplicate_flag_rows[role] = flagged
        report.endpoints[role] = {
            "target": want["target"], "standard_type": want["standard_type"],
            "label": want["label"], "assay_chembl_id": assays[0],
            "assay_description": (hits[0].get("assay_description") or "") if hits else "",
            "rows": len(hits), "compounds": len(chosen),
            "rows_carrying_potential_duplicate": flagged,
            "compounds_with_several_rows": collapsed,
            "disagreeing_duplicates": disagreeing,
        }
        for r in chosen:
            v = float(r["standard_value"])
            records.append(Record(
                set_name=set_name, compound_id=r["molecule_chembl_id"],
                smiles=r["canonical_smiles"], endpoint=want["label"],
                target_chembl_id=want["target"], standard_type=want["standard_type"],
                value_nM=v, p_value=p_from_nM(v), unit="nM",
                source_type="experimental", citation=citation,
                assay_chembl_id=r["assay_chembl_id"],
                assay_description=r["assay_description"] or "",
                potential_duplicate=int(bool(r.get("potential_duplicate")))))

    by_cmpd: dict[str, dict] = {}
    for r in records:
        by_cmpd.setdefault(r.compound_id, {})[r.endpoint] = r
    labels = {spec[role]["label"] for role in ("activity", "toxicity")}
    report.counts = {
        "activity_measurements": sum(1 for r in records
                                     if r.endpoint == spec["activity"]["label"]),
        "toxicity_measurements": sum(1 for r in records
                                     if r.endpoint == spec["toxicity"]["label"]),
        "compounds_with_both": sum(1 for v in by_cmpd.values() if len(v) == len(labels)),
        "compounds_with_activity_only": sum(
            1 for v in by_cmpd.values() if set(v) == {spec["activity"]["label"]}),
        "compounds_with_toxicity_only": sum(
            1 for v in by_cmpd.values() if set(v) == {spec["toxicity"]["label"]}),
    }
    return records, cite, report


def document_scan(min_paired: int = 10) -> list[dict]:
    """Every ChEMBL document measuring BOTH H3 and hERG affinity on the same molecules.

    This is the search that chose the sets above, written so it can be re-run rather than
    taken on trust. It pages every binding activity for the two targets - about 5k rows for
    H3 and 12k for hERG in ChEMBL_37 - and intersects the molecule sets per document.
    """
    def by_document(target: str) -> dict[str, set[str]]:
        rows = paged("activity", {
            "target_chembl_id": target, "assay_type": "B", "standard_units": "nM",
            "standard_relation": "=",
            "only": "document_chembl_id,molecule_chembl_id,standard_type,pchembl_value"})
        out: dict[str, set[str]] = collections.defaultdict(set)
        for r in rows:
            if r.get("standard_type") in ("Ki", "IC50") and r.get("pchembl_value"):
                out[r["document_chembl_id"]].add(r["molecule_chembl_id"])
        return out

    h3, herg = by_document(H3_TARGET), by_document(HERG_TARGET)
    found = []
    for doc in set(h3) & set(herg):
        both = h3[doc] & herg[doc]
        if len(both) >= min_paired:
            found.append({"document": doc, "paired": len(both),
                          "h3_compounds": len(h3[doc]), "herg_compounds": len(herg[doc])})
    found.sort(key=lambda d: -d["paired"])
    return found


def build() -> dict:
    out = {"chembl": chembl_release(), "sets": {}, "citations": {}, "records": [],
           "reports": {}}
    for name, spec in SETS.items():
        recs, cite, report = collect(name, spec)
        out["citations"][name] = cite
        out["records"].extend(asdict(r) for r in recs)
        out["reports"][name] = asdict(report)
        out["sets"][name] = dict(report.counts, document=spec["document"],
                                 role=spec["role"])
    return out


def table(data: dict) -> list[dict]:
    """One row per compound: both measurements, the index, and where each came from."""
    rows = []
    for name, spec in SETS.items():
        act_label, tox_label = spec["activity"]["label"], spec["toxicity"]["label"]
        recs = [r for r in data["records"] if r["set_name"] == name]
        by: dict[str, dict] = {}
        for r in recs:
            by.setdefault(r["compound_id"], {})[r["endpoint"]] = r
        for cmpd, pair in sorted(by.items()):
            act, tox = pair.get(act_label), pair.get(tox_label)
            rows.append({
                "set": name,
                "role": spec["role"],
                "document": spec["document"],
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
    json.dump({"chembl": data["chembl"], "citations": data["citations"],
               "reports": data["reports"]},
              open(dest.replace(".csv", "_provenance.json"), "w"), indent=1)
    print("ChEMBL", data["chembl"]["release"], "released", data["chembl"]["release_date"])
    for name, s in data["sets"].items():
        print(f"{name}: {s}")
    print(f"rows {len(rows)} -> {dest}")
    print("sha256", sha256_of_rows(rows, cols))
