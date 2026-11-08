#!/usr/bin/env python3
"""Harvest two independent, mutually consistent PK sources per drug, in Drug Names order.

    uv run --with requests --with openpyxl python tools/pk_harvest/harvest.py --xlsx <input.xlsx> --start 1 --end 50 --workers 4

Per drug the script: resolves identifiers (PubChem / ChEMBL) to get name synonyms, runs the Europe PMC query
ladder (drug name must be in the title), drops animal / in-vitro records, captures the public abstract (and PMC
open-access full text where available), extracts PK sentences, normalises units, tags the study population,
picks the pair of papers with different first authors whose values agree best, and writes
cache/results/<n>.json. Quotes are verified to be exact substrings of the captured block before being written.
"""

from __future__ import annotations

import argparse
import itertools
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import RESULTS, read_drug_names, read_existing  # noqa: E402
from epmc import (block_is_animal, capture, is_animal_or_invitro, population, public_url, query_ladder,  # noqa: E402
                  record_summary, search, title_mentions)
from extract import extract_block  # noqa: E402
import ids as idmod  # noqa: E402

PARAMS = ["CL", "Vss", "fu", "F", "dose_ug", "interval_min", "ther_min", "tox_min"]
CORE = {"CL", "Vss", "fu", "F"}
WEIGHT = {"CL": 3, "Vss": 3, "fu": 2, "F": 2, "dose_ug": 1, "interval_min": 1, "ther_min": 2, "tox_min": 2, "ther_max": 0}
SPECIAL = {"paediatric", "pregnancy", "renal impairment", "hepatic impairment", "critically ill", "obesity",
           "drug interaction", "formulation study", "elderly"}
MAX_CANDIDATES = 30
MAX_FULLTEXT = 3  # Europe PMC full-text XML is the slowest call (1–27 s); abstracts carry most CL/Vss values


def agree(param: str, a: float, b: float) -> bool:
    if a <= 0 or b <= 0:
        return False
    ratio = max(a, b) / min(a, b)
    if param in ("fu", "F"):
        return ratio <= 1.5 or abs(a - b) <= 0.15
    return ratio <= 1.5


def paper_score(rec: dict, names: list[str]) -> float:
    t = rec["title"].lower()
    s = 0.0
    if any(n.lower() in t for n in names):
        s += 2
    if "pharmacokinetic" in t:
        s += 2
    if "clinical pharmacokinetics" in t:
        s += 1
    if "review" in " ".join(rec.get("pub_type", [])).lower():
        s += 0.5
    pops = rec.get("population") or []
    if "healthy volunteers" in pops:
        s += 1.5
    s -= 1.5 * len([p for p in pops if p in SPECIAL])
    return s


def verbatim_ok(quote: str, block_text: str) -> str:
    if quote in block_text:
        return "exact"
    if re.sub(r"\s+", " ", quote) in re.sub(r"\s+", " ", block_text):
        return "exact (whitespace)"
    return "NOT IN SOURCE"


SUBTYPE_PREF = {"systemic CL": 0, "CL": 1, "Vss": 0, "Vd": 1, "Vz": 2, "CL/F (apparent oral)": 3, "V/F (apparent oral)": 3}


def best_value(hits: list[dict], param: str, names: list[str]) -> dict | None:
    """Most trustworthy hit for a parameter inside one paper: right subtype, drug named in the sentence, abstract first."""
    cands = [h for h in hits if h["param"] == param]
    if not cands:
        return None

    def key(h):
        named = any(n.lower() in h["sentence"].lower() for n in names)
        return (SUBTYPE_PREF.get(h["subtype"], 1), 0 if named else 1, -h["confidence"],
                0 if h["locator"].startswith("Abstract") else 1)
    cands.sort(key=key)
    return cands[0]


def independent(a: dict, b: dict) -> bool:
    if a["doi"] and a["doi"] == b["doi"]:
        return False
    if a["pmid"] and a["pmid"] == b["pmid"]:
        return False
    fa, fb = (a["first_author"] or "").lower(), (b["first_author"] or "").lower()
    return not (fa and fa == fb)


def existing_bonus(params: dict, existing: dict | None) -> float:
    """Prefer papers whose CL / Vss / fu sit within 1.5× of the curated value already in the table (the user's
    stated goal is corroboration of the dataset). All values are still written to the evidence sheet."""
    if not existing:
        return 0.0
    b = 0.0
    for p in ("CL", "Vss", "fu"):
        if p in params and p in existing and params[p]["value"] > 0 and "apparent oral" not in params[p]["subtype"]:
            ratio = max(existing[p], params[p]["value"]) / min(existing[p], params[p]["value"])
            b += WEIGHT[p] if ratio <= 1.5 else (-0.5 * WEIGHT[p] if ratio > 3 else 0.0)
    return b


def pair_score(pa: dict, pb: dict, ra: dict, rb: dict, names: list[str], existing: dict | None = None) -> tuple[float, list[str], list[str]]:
    agreed, differ = [], []
    score = 0.0
    for p in PARAMS:
        if p in pa and p in pb:
            oral_a, oral_b = "apparent oral" in pa[p]["subtype"], "apparent oral" in pb[p]["subtype"]
            if oral_a != oral_b:
                score += WEIGHT[p] * 0.4  # CL/F vs CL (or V/F vs Vss) are not comparable: count as one value found
                continue
            if agree(p, pa[p]["value"], pb[p]["value"]):
                agreed.append(p)
                score += WEIGHT[p] * 2
            else:
                differ.append(p)
                score -= WEIGHT[p] * 0.5
        elif p in pa or p in pb:
            score += WEIGHT[p] * 0.4
    score += 0.5 * (paper_score(ra, names) + paper_score(rb, names))
    score += existing_bonus(pa, existing) + existing_bonus(pb, existing)
    if not (set(agreed) & CORE):
        score -= 3
    return score, agreed, differ


def name_variants(drug: str) -> list[str]:
    """Searchable spellings of a Drug Names entry.

    'Acetylcysteine, N-' → ['N-Acetylcysteine', 'Acetylcysteine'];  'Albuterol (salbutamol)' → ['Albuterol', 'salbutamol'];
    'Amphetamine (-d)' → ['Amphetamine', 'd-Amphetamine'];  'Acecainide (N-acetylprocainamide)' → both names.
    """
    out: list[str] = []

    def add(s: str):
        s = s.strip(" -–,")
        if len(s) >= 3 and s.lower() not in [o.lower() for o in out]:
            out.append(s)

    m = re.match(r"^(.*?)\s*\((.*?)\)\s*(.*)$", drug)
    if m:
        head, inner, tail = m.group(1), m.group(2), m.group(3)
        base = (head + " " + tail).strip()
        add(base)
        inner_clean = inner.strip()
        if re.fullmatch(r"[-+±]?\s*[dlDLrsRS]{1,2}", inner_clean):  # '(-d)', '(l)', '(R)' stereo tags
            add(re.sub(r"[-+±\s]", "", inner_clean).lower() + "-" + base)
        elif not re.fullmatch(r"[-+±]", inner_clean):
            add(inner_clean)
    else:
        m2 = re.match(r"^(.*?),\s*([A-Za-z0-9,'\-\s]+-)$", drug)  # 'Aminosalicylic acid, 5-' → '5-Aminosalicylic acid'
        if m2:
            add(m2.group(2).strip() + m2.group(1).strip())
            add(m2.group(1))
        else:
            add(drug)
    if not out:
        add(drug)
    return out


def harvest_one(idx: int, drug: str, fulltext: bool = True, existing: dict | None = None) -> dict:
    t0 = time.time()
    variants = name_variants(drug)
    try:
        ids = idmod.lookup(variants)
    except Exception as e:  # identifiers are best-effort
        ids = {"name": drug, "error": repr(e)}
    names = list(variants)
    for alt in (ids.get("pubchem_title"), ids.get("chembl_pref_name")):
        if alt and alt.lower() not in [n.lower() for n in names] and len(alt) >= 4 and not re.search(r"[\[\](),]", alt):
            names.append(alt)
    log = {"names": names, "queries": [], "candidates": 0, "dropped_animal": 0, "dropped_title": 0, "captured": 0, "fulltext": 0,
           "t_ids": round(time.time() - t0, 1)}
    t1 = time.time()
    recs: dict[str, dict] = {}
    for stage, q, sort in query_ladder(names[0], names[1:]):
        res = search(q, sort=sort)
        log["queries"].append({"stage": stage, "query": q, "sort": sort, "hits": len(res)})
        for r in res:
            s = record_summary(r)
            key = s["doi"] or s["pmid"] or s["id"]
            if not key or key in recs or not s["abstract"]:
                continue
            if not title_mentions(s, names):
                log["dropped_title"] += 1
                continue
            if is_animal_or_invitro(s):
                log["dropped_animal"] += 1
                continue
            s["population"] = population(s)
            recs[key] = s
    cands = sorted(recs.values(), key=lambda r: (-paper_score(r, names), -(r["cited_by"] or 0)))[:MAX_CANDIDATES]
    log["candidates"] = len(cands)
    log["t_search"] = round(time.time() - t1, 1)
    t2 = time.time()
    papers = []
    ft_used = 0

    def capture_paper(rec: dict, strict_name: bool) -> None:
        nonlocal ft_used
        want_ft = fulltext and ft_used < MAX_FULLTEXT and bool(rec.get("pmcid"))
        cap = capture(rec, want_ft)
        if "full text" in cap["access"]:
            ft_used += 1
        hits = []
        paediatric = "paediatric" in (rec.get("population") or [])
        for b in cap["blocks"]:
            b["animal"] = block_is_animal(b)
            for h in extract_block(b, names, allow_assumed_weight=not paediatric):
                if strict_name and not any(n.lower() in h["sentence"].lower() for n in names):
                    continue  # paper not titled after the drug: only sentences that name it count
                h["verified"] = verbatim_ok(h["sentence"], b["text"])
                if h["verified"] != "NOT IN SOURCE":
                    hits.append(h)
        params = {p: best_value(hits, p, names) for p in PARAMS + ["ther_max"] if best_value(hits, p, names)}
        if params:
            papers.append({"rec": rec, "access": cap["access"], "params": params, "n_hits": len(hits),
                           "stage": "fallback (drug named in sentence)" if strict_name else "title match"})
        log["captured"] += 1

    for rec in cands:
        capture_paper(rec, strict_name=False)
    if len(papers) < 2:  # fallback: drug in the abstract rather than the title; sentences must name the drug
        q = "(" + " OR ".join(f"ABSTRACT:\"{n}\"" for n in names) + ") AND (ABSTRACT:clearance OR ABSTRACT:\"volume of distribution\" OR ABSTRACT:\"protein binding\" OR ABSTRACT:bioavailability) AND SRC:MED"
        res = search(q)
        log["queries"].append({"stage": "fallback-abstract", "query": q, "sort": None, "hits": len(res)})
        extra = []
        for r in res:
            s = record_summary(r)
            key = s["doi"] or s["pmid"] or s["id"]
            if not key or key in recs or not s["abstract"] or is_animal_or_invitro(s):
                continue
            s["population"] = population(s)
            recs[key] = s
            extra.append(s)
        for rec in sorted(extra, key=lambda r: -paper_score(r, names))[:MAX_CANDIDATES]:
            capture_paper(rec, strict_name=True)
    log["fulltext"] = ft_used
    log["t_capture"] = round(time.time() - t2, 1)
    best = None
    for a, b in itertools.combinations(papers, 2):
        if not independent(a["rec"], b["rec"]):
            continue
        sc, agreed, differ = pair_score(a["params"], b["params"], a["rec"], b["rec"], names, existing)
        if best is None or sc > best[0]:
            best = (sc, a, b, agreed, differ)
    out = {"index": idx, "drug": drug, "log": log, "seconds": round(time.time() - t0, 1), "sources": [],
           "agreed": [], "differ": [], "status": "none", "ids": ids}
    if best:
        _, a, b, agreed, differ = best
        out["sources"] = [a, b]
        out["agreed"], out["differ"] = agreed, differ
        out["status"] = ("2 sources, agreeing" if agreed else
                         ("2 sources, no overlapping parameter" if not differ else "2 sources, values differ"))
    elif papers:
        papers.sort(key=lambda p: -(len(p["params"]) + paper_score(p["rec"], names) + existing_bonus(p["params"], existing)))
        out["sources"] = [papers[0]]
        out["status"] = "1 source only"
    for s in out["sources"]:
        s["url"] = public_url(s["rec"])
        s["rec"].pop("abstract", None)
    return out


def run_index(i: int, names: list[str], fulltext: bool, force: bool, existing: dict | None = None) -> str:
    drug = names[i - 1]
    p = RESULTS / f"{i:04d}.json"
    if p.exists() and not force:
        return f"{i:4d} {drug[:40]:40s} (cached)"
    try:
        res = harvest_one(i, drug, fulltext=fulltext, existing=(existing or {}).get(i))
    except Exception as e:  # never let one drug kill the batch
        res = {"index": i, "drug": drug, "status": "error", "error": repr(e), "sources": [], "log": {}, "seconds": 0}
    p.write_text(json.dumps(res, ensure_ascii=False, indent=1), "utf-8")
    return f"{i:4d} {drug[:40]:40s} {res['status']:36s} {res.get('seconds', '')}s agreed={res.get('agreed', [])}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--start", type=int, default=1, help="1-based index into Drug Names")
    ap.add_argument("--end", type=int, default=None)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--no-fulltext", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    names = read_drug_names(Path(args.xlsx))
    existing = read_existing(Path(args.xlsx))
    end = min(args.end or len(names), len(names))
    RESULTS.mkdir(parents=True, exist_ok=True)
    idxs = list(range(args.start, end + 1))
    if args.workers <= 1:
        for i in idxs:
            print(run_index(i, names, not args.no_fulltext, args.force, existing), flush=True)
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = {ex.submit(run_index, i, names, not args.no_fulltext, args.force, existing): i for i in idxs}
            for f in as_completed(futs):
                print(f.result(), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
