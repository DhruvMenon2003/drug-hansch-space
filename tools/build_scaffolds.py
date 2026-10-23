"""Bemis–Murcko scaffold families for the explorer's drugs (site/data/scaffolds.json).

The explorer plots one point per drug; this file says which chemical series each point belongs to, so the scaffold
cluster overlay (site/js/clusters.js) can colour the 3D plot by family, list the families and draw each framework.
Structures come from site/data/drugs.json and are standardised exactly as the QSAR sets are, so a drug and its ChEMBL
measurements land in the same family.

Run:  python3 tools/build_scaffolds.py          (no network)
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from build_qsar_targets import standardize
from scaffolds import ACYCLIC, families, murcko

ROOT = Path(__file__).resolve().parent.parent
DRUGS = ROOT / "site/data/drugs.json"
OUT = ROOT / "site/data/scaffolds.json"
#: Families with at least this many drugs carry their SMILES and example names; smaller ones are counted only.
NAMED_MIN = 2
#: How many example drug names each named family carries.
EXAMPLES = 3


def main() -> None:
    drugs = json.loads(DRUGS.read_text())["drugs"]
    scaf, generic, dropped = [], [], []
    for d in drugs:
        mol, why = standardize(d.get("smiles") or "")
        if mol is None:
            dropped.append([d["cid"], why])
            scaf.append(ACYCLIC)
            generic.append(ACYCLIC)
            continue
        a, b = murcko(mol)
        scaf.append(a)
        generic.append(b)
    index, fams = families(scaf, generic)
    members: dict[int, list[int]] = {}
    for i, k in enumerate(index):
        members.setdefault(k, []).append(i)
    out = []
    for f in fams:
        row = {"i": f["i"], "n": f["n"]}
        if f["n"] >= NAMED_MIN and f["smiles"] != ACYCLIC:
            row["smiles"] = f["smiles"]
            row["generic"] = f["generic"]
            row["drugs"] = [drugs[i]["name"] for i in members[f["i"]][:EXAMPLES]]
        elif f["smiles"] == ACYCLIC:
            row["acyclic"] = True
        out.append(row)
    named = sum(1 for f in out if "smiles" in f)
    payload = {"schema_version": 1, "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "method": "RDKit MurckoScaffold.GetScaffoldForMol on the standardised structure "
                         "(Bemis and Murcko, J. Med. Chem. 1996, 39, 2887)",
               "n_drugs": len(drugs), "n_families": len(out), "n_named": named,
               "unparsed": dropped, "families": out,
               "by_cid": {str(d["cid"]): index[i] for i, d in enumerate(drugs)}}
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"{len(drugs)} drugs, {len(out)} scaffold families, {named} shared by {NAMED_MIN}+ drugs, "
          f"{len(dropped)} structures unusable; {OUT.stat().st_size // 1024} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
