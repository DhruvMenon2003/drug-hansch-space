#!/usr/bin/env python3
"""Give every molecule a structure and a primary target, by exact name match only.

    ti/resolve.py                     # resolve, using the cache; print a ledger
    ti/resolve.py --offline           # cache only, no network
    ti/resolve.py --limit 50          # first 50 unresolved names (for a quick check)

TWO THINGS ARE RESOLVED HERE AND THEY FAIL INDEPENDENTLY.

  structure   A SMILES, from DrugBank's export first (/mnt/project-files/drugbank_drugs_info.csv, offline) and
              from ChEMBL second. PubChem is not used: this project takes SMILES from DrugBank, RDKit or ChEMBL.

  target      The primary molecular target, from ChEMBL's mechanism-of-action table. This is the routing key.
              A molecule with a structure but no target still gets descriptors and still appears in the output -
              as a row with no prediction, because there is no model it is allowed to use.

MATCHING IS EXACT, ON PURPOSE. A ChEMBL hit counts only when the normalised query equals the normalised preferred
name or one of the normalised synonyms. Fuzzy matching is what puts a molecule in front of the wrong target's
model, and a wrong target silently produces a confident, meaningless number - the exact failure the routing rule
in ti/rank.py exists to prevent. Unmatched is a reported outcome, not a defect to paper over.

The cache (ti/cache/chembl_names.json) makes a rerun deterministic and offline. Delete it to re-query.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inputs import PROJECT_FILES, build, normalise_name  # noqa: E402

CACHE = Path(__file__).resolve().parent / "cache" / "chembl_names.json"
CHEMBL = "https://www.ebi.ac.uk/chembl/api/data"
USER_AGENT = "drug-hansch-space/ti (research use; contact via repository)"


def drugbank_smiles(path: Path) -> dict[str, str]:
    """name -> SMILES from the DrugBank export.

    The export is a wide join of several DrugBank tables with repeated column names, so a single row carries a
    clinical trial as well as a drug: column 'title' is the trial's title and column 'name' is the drug's own
    name. Only the drug's name describes the structure in that row. Reading 'title' as a name is how
    "Haloperidol + Promethazine + Chlorpromazine", a trial on a Zolmitriptan row, once gave haloperidol
    zolmitriptan's structure. So the name column is the drug block's own: the last 'name' before moldb_smiles.
    """
    csv.field_size_limit(10 ** 7)
    out: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8", errors="replace") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        smiles_cols = [i for i, c in enumerate(header) if c == "moldb_smiles"]
        if not smiles_cols:
            return out
        smiles_col = smiles_cols[0]
        drug_name_cols = [i for i, c in enumerate(header) if c == "name" and i < smiles_col]
        if not drug_name_cols:
            return out
        name_col = drug_name_cols[-1]
        for row in reader:
            if len(row) <= smiles_col:
                continue
            smiles = row[smiles_col].strip()
            key = normalise_name(row[name_col]) if name_col < len(row) else ""
            if smiles and key:
                out.setdefault(key, smiles)
    return out


def _get(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def chembl_lookup(name: str) -> dict:
    """Exact-name lookup. Returns {} when nothing matches the name exactly."""
    key = normalise_name(name)
    query = urllib.parse.quote(name)
    payload = _get(f"{CHEMBL}/molecule/search?q={query}&format=json&limit=20")
    if not payload:
        return {}
    for molecule in payload.get("molecules", []):
        names = [molecule.get("pref_name") or ""]
        names += [s.get("molecule_synonym") or "" for s in (molecule.get("molecule_synonyms") or [])]
        if key not in {normalise_name(n) for n in names if n}:
            continue
        structures = molecule.get("molecule_structures") or {}
        return {
            "chembl_id": molecule.get("molecule_chembl_id"),
            "pref_name": molecule.get("pref_name"),
            "smiles_chembl": structures.get("canonical_smiles"),
            "max_phase": molecule.get("max_phase"),
        }
    return {}


def chembl_mechanism(chembl_id: str) -> list[dict]:
    """The mechanism-of-action rows for a molecule: this is where the routing target comes from.

    The filter column matters and the obvious one is wrong. ChEMBL's mechanism table records the *parent*
    molecule - the desalted, de-isomerised form - so a salt, a stereoisomer or a specific formulation carries
    its mechanism under parent_molecule_chembl_id and has nothing under molecule_chembl_id. Filtering on
    molecule_chembl_id alone returned zero rows for acebutolol (CHEMBL642), which is a beta-1 blocker whose
    mechanism ChEMBL records perfectly well against CHEMBL213; 657 of 1,345 drugs were silently left with no
    routing target for exactly this reason. Both columns are queried, parent first, and the rows are merged.
    """
    rows = []
    for column in ("parent_molecule_chembl_id", "molecule_chembl_id"):
        payload = _get(f"{CHEMBL}/mechanism?{column}={chembl_id}&format=json&limit=20")
        if payload:
            rows.extend(payload.get("mechanisms", []))
    seen, out = set(), []
    for row in rows:
        key = (row.get("target_chembl_id"), row.get("mechanism_of_action"))
        if key in seen:
            continue
        seen.add(key)
        if row.get("target_chembl_id"):
            out.append({
                "target_chembl_id": row["target_chembl_id"],
                "action_type": row.get("action_type"),
                "mechanism_of_action": row.get("mechanism_of_action"),
                "max_phase": row.get("max_phase"),
            })
    return out


def structure_skeleton(smiles: str) -> str | None:
    """The InChIKey connectivity block of a SMILES, standardised exactly as the pipeline standardises it.

    Only the first block is compared, so a stereo re-assignment between two databases is not read as a
    different molecule, while a different skeleton is.
    """
    try:
        from descriptors import standardise
        from rdkit import Chem
    except Exception:
        return None
    try:
        standardised = standardise(smiles)
        mol = standardised[0] if isinstance(standardised, tuple) else standardised
        return Chem.MolToInchiKey(mol).split("-")[0] if mol is not None else None
    except Exception:
        return None


def cross_check_structures(molecules: list[dict], book: dict[str, str], cache: dict) -> list[dict]:
    """Where DrugBank and ChEMBL both name a structure for a drug, say whether they are the same molecule.

    This is the check that catches a name joined to the wrong structure, which is how a trial title once gave
    haloperidol zolmitriptan's skeleton. A disagreement is recorded on the molecule and counted in the ledger
    rather than resolved silently, because which source is right is a question about that one drug.
    """
    disagreements = []
    for mol in molecules:
        drugbank = book.get(mol["name_key"])
        chembl = (cache.get(mol["name_key"]) or {}).get("smiles_chembl")
        if not (drugbank and chembl):
            mol["structure_agrees_with_chembl"] = None
            continue
        ours, theirs = structure_skeleton(drugbank), structure_skeleton(chembl)
        if not (ours and theirs):
            mol["structure_agrees_with_chembl"] = None
            continue
        mol["structure_agrees_with_chembl"] = ours == theirs
        if ours != theirs:
            disagreements.append({"name": mol["name"], "chembl_id": mol.get("chembl_id"),
                                  "drugbank_smiles": drugbank, "chembl_smiles": chembl})
    return disagreements


def resolve(offline: bool = False, limit: int | None = None, workers: int = 6) -> dict:
    data = build()
    molecules = data["molecules"]

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    book = drugbank_smiles(PROJECT_FILES / "drugbank_drugs_info.csv")

    todo = [m["name"] for m in molecules if m["name_key"] not in cache]
    if limit is not None:
        todo = todo[:limit]
    if todo and not offline:
        print(f"querying ChEMBL for {len(todo)} names ...", file=sys.stderr)

        def work(name: str):
            hit = chembl_lookup(name)
            if hit.get("chembl_id"):
                hit["mechanisms"] = chembl_mechanism(hit["chembl_id"])
            return normalise_name(name), hit

        with ThreadPoolExecutor(max_workers=workers) as pool:
            for i, (key, hit) in enumerate(pool.map(work, todo), 1):
                cache[key] = hit
                if i % 100 == 0:
                    print(f"  {i}/{len(todo)}", file=sys.stderr)
                    CACHE.parent.mkdir(parents=True, exist_ok=True)
                    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")

    for mol in molecules:
        hit = cache.get(mol["name_key"]) or {}
        mol["chembl_id"] = hit.get("chembl_id")
        mol["chembl_pref_name"] = hit.get("pref_name")
        mol["max_phase"] = hit.get("max_phase")
        mechanisms = hit.get("mechanisms") or []
        mol["mechanisms"] = mechanisms
        mol["target_chembl_id"] = mechanisms[0]["target_chembl_id"] if mechanisms else None
        mol["target_action"] = mechanisms[0].get("action_type") if mechanisms else None
        mol["mechanism_of_action"] = mechanisms[0].get("mechanism_of_action") if mechanisms else None

        smiles = (mol.get("smiles_dataset2") or book.get(mol["name_key"])
                  or hit.get("smiles_chembl") or mol.get("smiles_dataset1"))
        mol["smiles"] = smiles
        mol["smiles_source"] = (
            "dataset2" if mol.get("smiles_dataset2") else
            "drugbank_drugs_info.csv" if book.get(mol["name_key"]) else
            "ChEMBL" if hit.get("smiles_chembl") else
            "dataset1" if mol.get("smiles_dataset1") else None
        )

    disagreements = cross_check_structures(molecules, book, cache)
    checked = sum(1 for m in molecules if m.get("structure_agrees_with_chembl") is not None)
    data["structure_disagreements"] = disagreements

    data["ledger"].update({
        "with a structure": sum(1 for m in molecules if m.get("smiles")),
        "  from DrugBank export": sum(1 for m in molecules if m.get("smiles_source") == "drugbank_drugs_info.csv"),
        "  from ChEMBL": sum(1 for m in molecules if m.get("smiles_source") == "ChEMBL"),
        "  from the datasets": sum(1 for m in molecules if m.get("smiles_source") in ("dataset1", "dataset2")),
        "matched in ChEMBL by exact name": sum(1 for m in molecules if m.get("chembl_id")),
        "with a primary target": sum(1 for m in molecules if m.get("target_chembl_id")),
        "distinct primary targets": len({m["target_chembl_id"] for m in molecules if m.get("target_chembl_id")}),
        "structures checked against ChEMBL's own": checked,
        "  same molecule": checked - len(disagreements),
        "  different (recorded per row, not silently merged)": len(disagreements),
    })
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    data = resolve(offline=args.offline, limit=args.limit)
    for key, value in data["ledger"].items():
        print(f"{key:48s} {value}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
