#!/usr/bin/env python3
"""The adverse-reaction column dataset2 asks for, read out of openFDA's FAERS report counts.

    ti/adverse.py --limit 50          # fill the cache for 50 more molecules
    ti/adverse.py --report            # what is cached

WHAT THIS COLUMN IS, AND WHAT IT IS NOT

dataset2's last empty column is "Highest Frequency Adverse Drug Reaction". FAERS can answer it, but only in a
particular sense that has to travel with the number or the number misleads.

A FAERS count is a count of *spontaneous reports*, not a rate. There is no denominator: nobody knows how many
people took the drug, so a drug given to millions outranks a drug given to thousands whatever their relative
safety. The counts are also confounded by indication and by notoriety - a drug under litigation is reported
more. So this is a descriptive column, carried with a faers_ prefix, and it is never fitted against. Treating
it as a toxicity endpoint would be fitting a model to prescription volume and press coverage.

Worse, the top term is frequently the indication rather than an adverse effect. Theophylline's two commonest
FAERS terms are DYSPNOEA and ASTHMA, which is what it is given for. Warfarin's is INTERNATIONAL NORMALISED
RATIO INCREASED and etoposide's is FEBRILE NEUTROPENIA, both of which really are the signature toxicity. There
is no way to tell these apart without knowing each drug's indication, so no attempt is made to: three terms are
reported rather than one, with their counts and the report total, and the reader is told in the report that a
top term can be the indication. A column with its limitation stated beats a column that looks cleaner than it is.

The administrative terms below are dropped because they describe the report, not the patient.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "faers.json"
ENDPOINT = "https://api.fda.gov/drug/event.json"

# Report bookkeeping, not patient events. "DRUG INEFFECTIVE" is a complaint about efficacy; the rest describe
# how the report came to be filed.
ADMINISTRATIVE = {
    "OFF LABEL USE", "DRUG INEFFECTIVE", "PRODUCT USE ISSUE", "PRODUCT USE IN UNAPPROVED INDICATION",
    "THERAPY CESSATION", "DRUG USE FOR UNAPPROVED INDICATION", "NO ADVERSE EVENT", "DEATH",
    "INAPPROPRIATE SCHEDULE OF PRODUCT ADMINISTRATION", "PRODUCT DOSE OMISSION ISSUE",
    "DRUG DOSE OMISSION", "INCORRECT DOSE ADMINISTERED", "WRONG TECHNIQUE IN PRODUCT USAGE PROCESS",
    "TREATMENT NONCOMPLIANCE", "PRODUCT QUALITY ISSUE", "EXPIRED PRODUCT ADMINISTERED",
    "DRUG ADMINISTERED TO PATIENT OF INAPPROPRIATE AGE", "UNEVALUABLE EVENT",
}

TERMS = 3


def load() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save(cache: dict) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")


def fetch(name: str) -> dict:
    """Reaction counts for one generic name. {} when FAERS has nothing under that name."""
    query = urllib.parse.urlencode({
        "search": f'patient.drug.openfda.generic_name:"{name}"',
        "count": "patient.reaction.reactionmeddrapt.exact",
    })
    try:
        with urllib.request.urlopen(f"{ENDPOINT}?{query}", timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # 404 is openFDA's "no matching reports", which is an answer, not a failure.
        return {} if exc.code == 404 else {"_error": f"HTTP {exc.code}"}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {"_error": str(exc)[:120]}

    results = payload.get("results") or []
    if not results:
        return {}
    total = sum(row["count"] for row in results)
    kept = [row for row in results if row["term"].upper() not in ADMINISTRATIVE][:TERMS]
    if not kept:
        return {}
    return {
        "faers_top_reactions": "; ".join(f"{r['term'].lower()} ({r['count']})" for r in kept),
        "faers_top_reaction_reports": kept[0]["count"],
        "faers_reports_total": total,
    }


def fill(names: list[str], limit: int) -> dict:
    cache = load()
    todo = [n for n in names if n not in cache][:limit]
    print(f"{len(names)} names, {len(cache)} cached, fetching {len(todo)}", file=sys.stderr)
    for i, name in enumerate(todo, 1):
        cache[name] = fetch(name)
        if cache[name].get("_error"):
            print(f"  {name}: {cache[name]['_error']}", file=sys.stderr)
        if i % 25 == 0:
            save(cache)
            print(f"  {i}/{len(todo)}", file=sys.stderr)
        time.sleep(0.3)  # well inside openFDA's unkeyed 240/min
    save(cache)
    return cache


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    cache = load()
    if args.report:
        with_terms = [k for k, v in cache.items() if v.get("faers_top_reactions")]
        print(f"{len(cache)} names cached, {len(with_terms)} with reaction terms")
        for name in sorted(with_terms)[:12]:
            print(f"  {name[:24]:26s} {cache[name]['faers_top_reactions'][:86]}")
        return 0

    resolved = json.loads((HERE / "cache" / "resolved.json").read_text(encoding="utf-8"))
    # Only molecules that can actually be ranked are worth a request; FAERS is keyed on the generic name, so a
    # molecule ChEMBL could not even name is not going to be found here either.
    names = [m["name"] for m in resolved["molecules"] if m.get("chembl_id")]
    cache = fill(names, args.limit)
    got = sum(1 for n in names if cache.get(n, {}).get("faers_top_reactions"))
    print(f"\n{got}/{len(names)} molecules have FAERS reaction terms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
