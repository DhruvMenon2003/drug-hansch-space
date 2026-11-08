#!/usr/bin/env python3
"""Print a compact human review of harvest results: uv run python tools/pk_harvest/review.py 1 6"""
import json
import sys
from pathlib import Path

RES = Path(__file__).resolve().parent / "cache" / "results"
start, end = int(sys.argv[1]), int(sys.argv[2])
full = "--full" in sys.argv
for i in range(start, end + 1):
    p = RES / f"{i:04d}.json"
    if not p.exists():
        continue
    d = json.loads(p.read_text("utf-8"))
    log = d.get("log", {})
    print(f"=== {i} {d['drug']} | {d['status']} | {d.get('seconds')}s | cands={log.get('candidates')} animal={log.get('dropped_animal')} title={log.get('dropped_title')} ft={log.get('fulltext')} names={log.get('names')}")
    for s in d["sources"]:
        r = s["rec"]
        print(f"  -- {r['first_author']} {r['year']} {r['journal']} doi={r['doi']} pmid={r['pmid']} pop={r.get('population')} | {r['title'][:80]}")
        print(f"     {s['access']}")
        for pn, h in s["params"].items():
            print(f"     {pn:12s} {h['value']:>10} {h['unit']:10s} rep={h['reported']!r:28s} {h['subtype']:22s} {h['normalisation'][:40]:40s} {h['verified']}")
            if full:
                print(f"        Q: {h['sentence'][:220]}")
                print(f"        L: {h['locator'][:100]}")
    print(f"  agreed={d.get('agreed')} differ={d.get('differ')}")
    ids = d.get("ids", {})
    print(f"  ids: DB={ids.get('drugbank')} cid={ids.get('cid')} chembl={ids.get('chembl_id')} targets={ids.get('targets')} uniprot={ids.get('uniprot')}")
