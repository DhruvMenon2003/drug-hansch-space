"""Add Bemis–Murcko scaffold families to the per-target QSAR sets that already ship in site/data/qsar/.

tools/build_qsar_targets.py writes those sets from the ChEMBL REST API; this script leaves every measured value it
wrote untouched and only adds the scaffold columns, so the shipped data and the cleaning ledger stay exactly as they
were. It re-reads each target's activity rows from the same on-disk cache to recover the structures (the compound
files are column-wise and carry no SMILES), standardises them the same way, and writes:

  cols.sc    scaffold family index per compound (0 is the largest family; acyclic compounds come last)
  scaffolds  [{i, smiles, n}] for the SCAFFOLD_SHOWN largest families, for the builder's scaffold cluster view

Run:  python3 tools/add_scaffolds.py           (uses tools/data/cache_qsar; only uncached pages hit the network)
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from build_qsar_targets import fetch, standardize
from scaffolds import families, murcko

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site/data/qsar"
#: How many scaffold families carry their SMILES in a target file (every family size is countable from cols.sc).
SCAFFOLD_SHOWN = 24


def patch(path: Path) -> str:
    data = json.loads(path.read_text())
    cols = data["cols"]
    if "sc" in cols and data.get("scaffolds"):
        return f"{path.stem}: already has scaffolds"
    smiles = {}
    for row in fetch(data["target"]["id"], data["standard_type"]):
        smiles.setdefault(row["molecule_chembl_id"], row["canonical_smiles"])
    scaf, missing = [], 0
    for cid in cols["id"]:
        mol, _ = standardize(smiles.get(f"CHEMBL{cid}") or "")
        if mol is None:
            missing += 1
            scaf.append("")
            continue
        a, _generic = murcko(mol)
        scaf.append(a)
    index, fams = families(scaf)
    cols["sc"] = index
    data["scaffolds"] = fams[:SCAFFOLD_SHOWN]
    data["scaffold_method"] = "RDKit MurckoScaffold.GetScaffoldForMol on the standardised structure"
    path.write_text(json.dumps(data, separators=(",", ":")))
    note = f", {missing} structures could not be recovered" if missing else ""
    return f"{path.stem}: {len(fams)} scaffold families over {len(scaf)} compounds{note}"


def main() -> None:
    index = json.loads((OUT / "index.json").read_text())
    files = [OUT / Path(t["file"]).name for t in index["targets"] if t.get("file")]
    print(f"{len(files)} target files", file=sys.stderr)
    with ProcessPoolExecutor() as pool:                      # RDKit standardisation is CPU-bound
        for line in pool.map(patch, files):
            print(line, file=sys.stderr)
    smiles_in_files = sum(len(json.loads(f.read_text()).get("scaffolds", [])) for f in files)
    print(f"done; {smiles_in_files} scaffold SMILES shipped", file=sys.stderr)


if __name__ == "__main__":
    main()
