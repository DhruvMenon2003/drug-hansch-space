#!/usr/bin/env python3
"""Read the three source datasets into one table of molecules, with every exclusion written down.

    ti/inputs.py                 # parse the three files, print a ledger
    ti/inputs.py --out X.json    # also write the parsed records

The three files are Markdown exports of spreadsheets and each one is damaged in its own way, so the parsing is
deliberately literal and every row that cannot be read is counted rather than dropped in silence. OECD principle 1
(a defined endpoint) starts here: if we cannot say which rows went in, no downstream statistic means anything.

WHAT EACH FILE IS

  dataset1.md   One table, 731 rows, PubChem descriptor export keyed by CID. Carries CanonicalSmiles and
                precomputed XLogP/TPSA/HBD/HBA/RotatableBondCount. We take the identity columns and the SMILES;
                we do NOT take its descriptors into the model, because they come from a different implementation
                than the ones we compute (see ti/descriptors.py - XLogP is not Crippen logP and the two disagree
                by up to a log unit on the same molecule).

  dataset2.md   Three tables. The first (760 rows) is the flat DrugBank-style list: CID, generic name, ATC code.
                The second (1296 rows) is the wide worksheet whose first two rows are a two-level header; it is
                the schema this project is aiming at (Which Drug? / Physicochemical / Drug Design /
                Pharmacodynamics / Pharmacokinetics / Predicted by Model) and it is almost entirely empty - 1 to 2
                rows filled out of 1296. We read it for the ATC levels and the generic name, and we treat its
                Activity / Toxicity / Therapeutic Index columns as EMPTY, because they are. The third table
                (112 rows) is the FDA route-of-administration legend, which is ground truth for the route column.

  dataset3.md   32 tables of human pharmacokinetics: Name, VDss (L/kg), CL (mL/min/kg), fu, MRT (h), t1/2 (h).
                1308 named rows. These are the molecules to be ranked. One table (the first) lost its header row
                to the exporter: the header cells hold three molecules' values run together, so that one row is
                recorded as an exclusion rather than guessed at.

'N.F.' means not found in the source and becomes a missing value, never a zero.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

PROJECT_FILES = Path("/mnt/project-files")

# dataset2's wide worksheet, by column index. Kept here so the schema this project is aiming at is written down in
# one place even while most of its columns are empty in the source.
WIDE_COLUMNS = [
    "pubchem_cid", "generic_name", "atc_level1_anatomical", "atc_level2_therapeutic",
    "atc_level3_mechanism", "atc_level4_chemical_group", "atc_code",
    "molecular_weight", "log_d", "hbd", "hba", "tpsa", "rotatable_bonds", "aromatic_rings",
    "hammett_sigma", "molar_refractivity_or_taft_es", "qed",
    "mode_of_administration", "smiles", "molecular_target",
    "activity", "toxicity", "therapeutic_index",
    "oral_bioavailability", "half_life", "dosage", "dose_interval", "free_drug_concentration",
    "primary_toxicity_endpoint",
]


def normalise_name(raw: str) -> str:
    """Fold a drug name to a comparison key: accents off, case off, punctuation to single spaces.

    Also undoes the index-style inversion the PK source uses ('Acetylcysteine, N-' is N-acetylcysteine,
    'Aminosalicylic Acid, 5-' is 5-aminosalicylic acid), because leaving it inverted costs ~100 structure matches.
    """
    s = unicodedata.normalize("NFKD", raw or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.strip()
    # 'Name, prefix-' -> 'prefix-Name'
    m = re.match(r"^(.*),\s*([A-Za-z0-9'(),\[\]\-]{1,12}-)$", s)
    if m:
        s = m.group(2) + m.group(1)
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def markdown_tables(path: Path):
    """Yield (header_cells, data_rows) for each Markdown pipe table in the file.

    Escaped pipes inside a cell ('\\|', used by the ATC column for multi-code drugs) are protected before the split
    and restored after it, so 'A02BA01|G02AD06' survives as one cell.
    """
    lines = path.read_text(encoding="utf-8").splitlines()

    def cells(line: str) -> list[str]:
        line = line.strip().replace("\\|", "\x00")
        return [c.strip().replace("\x00", "|") for c in line.strip("|").split("|")]

    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|\s*-{3}", lines[i + 1]):
            header = cells(lines[i])
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                rows.append(cells(lines[j]))
                j += 1
            yield header, rows
            i = j
        else:
            i += 1


def _number(raw: str):
    """A PK cell to a float. 'N.F.' and blanks are missing; '>3000' keeps its bound flag for the caller."""
    s = (raw or "").strip()
    if not s or s.upper().rstrip(".") in {"N.F", "NF", "NA", "ND"}:
        return None
    s = s.replace(",", "")
    m = re.match(r"^[<>~]?\s*([0-9]*\.?[0-9]+)(?:[eE]([+-]?\d+))?$", s)
    if not m:
        return None
    try:
        return float(m.group(0).lstrip("<>~ "))
    except ValueError:
        return None


def _assay_hit_rate(active_raw: str, tried_raw: str):
    """Fraction of PubChem bioassays a compound was active in, with its two counts.

    This is a measurement, not a calculated descriptor, which is why it travels with a measured_ prefix and is
    never fitted against. It says something the Hansch terms cannot: etoposide comes back active in 34% of the
    5,992 assays it has been put in front of, theophylline in 1.8% of 2,364. A compound that hits a third of
    everything it meets is a different safety proposition from one that hits almost nothing, whatever its logP.

    Below twenty assays tried the ratio is noise - one hit in three is 33% and means nothing - so it is withheld
    rather than reported thin. Returns None in that case, and None when either count is missing.
    """
    try:
        active, tried = int(active_raw.strip()), int(tried_raw.strip())
    except (AttributeError, ValueError):
        return None
    if tried < 20 or active < 0 or active > tried:
        return None
    return round(active / tried, 4), active, tried


def read_pk(path: Path) -> tuple[list[dict], list[dict]]:
    """dataset3: the molecules to rank, with measured human PK. Returns (records, exclusions)."""
    records, exclusions, seen = [], [], set()
    for header, rows in markdown_tables(path):
        header_is_data = header[0].strip().lower() != "name"
        if header_is_data and len(header) >= 6:
            exclusions.append({
                "stage": "dataset3 parse",
                "row": " | ".join(header[:6]),
                "reason": "table exported without its header row; the cells hold several molecules' values run "
                          "together and cannot be split without guessing which value belongs to which molecule",
            })
        for row in rows:
            if len(row) < 6 or not row[0].strip():
                continue
            name = row[0].strip()
            key = normalise_name(name)
            if not key or key in seen:
                continue
            seen.add(key)
            records.append({
                "name": name,
                "name_key": key,
                "measured_vdss_l_per_kg": _number(row[1]),
                "measured_cl_ml_per_min_per_kg": _number(row[2]),
                "measured_fu": _number(row[3]),
                "measured_mrt_h": _number(row[4]),
                "measured_t_half_h": _number(row[5]),
            })
    return records, exclusions


def read_identity(ds1: Path, ds2: Path) -> tuple[dict, dict, list[dict]]:
    """dataset1 + dataset2: name -> {cid, atc, smiles, target, route}. Returns (by_name, route_legend, exclusions)."""
    by_name: dict[str, dict] = {}
    legend: dict[str, dict] = {}
    exclusions: list[dict] = []

    for header, rows in markdown_tables(ds1):
        if header and header[0] == "CID":
            col = {c: i for i, c in enumerate(header)}
            for row in rows:
                if len(row) < len(header):
                    continue
                smiles = row[col["CanonicalSmiles"]].strip()
                mesh = row[col["MeSHHeadingList"]].strip()
                hits = _assay_hit_rate(row[col["ActiveAidCount"]], row[col["TotalAidCount"]])
                # The MeSH list is the only name column here; its first entry is the usable synonym.
                for nm in [p for p in mesh.split(";") if p.strip()][:4]:
                    key = normalise_name(nm)
                    if key and smiles:
                        by_name.setdefault(key, {})["smiles_dataset1"] = smiles
                        by_name[key].setdefault("pubchem_cid", row[col["CID"]].strip())
                        if hits:
                            rate, active, tried = hits
                            by_name[key].setdefault("measured_assay_hit_rate", rate)
                            by_name[key].setdefault("measured_assays_active", active)
                            by_name[key].setdefault("measured_assays_tried", tried)

    for header, rows in markdown_tables(ds2):
        if header and header[0] == "Compound Identifier":
            col = {c: i for i, c in enumerate(header)}
            for row in rows:
                if len(row) < len(header):
                    continue
                key = normalise_name(row[col["Generic Name"]])
                if not key:
                    continue
                rec = by_name.setdefault(key, {})
                rec["pubchem_cid"] = row[col["Compound Identifier"]].strip() or rec.get("pubchem_cid")
                rec["atc_code"] = row[col["Anatomical Therapeutic Chemical Code"]].strip()
                if row[col["2D Chemical Structure"]].strip():
                    rec["smiles_dataset2"] = row[col["2D Chemical Structure"]].strip()
                if row[col["Biological Target"]].strip():
                    rec["target_text"] = row[col["Biological Target"]].strip()
        elif header and header[0] == "NAME" and "FDA CODE" in header:
            col = {c: i for i, c in enumerate(header)}
            for row in rows:
                if len(row) < len(header):
                    continue
                legend[row[col["NAME"]].strip().upper()] = {
                    "short_name": row[col["SHORT NAME"]].strip(),
                    "fda_code": row[col["FDA CODE"]].strip(),
                    "nci_concept_id": row[col["NCI CONCEPT ID"]].strip(),
                }
        elif header and len(header) >= 20 and not header[0]:
            # The wide worksheet: its own first two rows are the two-level header.
            if len(rows) < 3:
                continue
            filled = 0
            for row in rows[2:]:
                if len(row) < len(WIDE_COLUMNS):
                    continue
                key = normalise_name(row[1])
                if not key:
                    continue
                rec = by_name.setdefault(key, {})
                for name, value in zip(WIDE_COLUMNS, row):
                    value = value.strip()
                    if value and value != "#Div0":
                        rec.setdefault("wide_" + name, value)
                        filled += 1
            exclusions.append({
                "stage": "dataset2 wide worksheet",
                "row": f"{len(rows) - 2} rows",
                "reason": f"the target schema's measurement columns are blank in the source "
                          f"({filled} non-empty cells across all rows and columns, mostly identity and ATC); "
                          f"no Activity, Toxicity or Therapeutic Index value can be read from it",
            })
    return by_name, legend, exclusions


def build(root: Path = PROJECT_FILES) -> dict:
    """Join the three files on the normalised name. Everything unmatched is reported, not hidden."""
    molecules, exclusions = read_pk(root / "dataset3.md")
    identity, legend, id_exclusions = read_identity(root / "dataset1.md", root / "dataset2.md")
    exclusions.extend(id_exclusions)

    matched = 0
    for mol in molecules:
        extra = identity.get(mol["name_key"])
        if extra:
            matched += 1
            mol.update(extra)
    return {
        "molecules": molecules,
        "route_legend": legend,
        "exclusions": exclusions,
        "ledger": {
            "dataset3 named rows": len(molecules),
            "matched to dataset1/dataset2 identity": matched,
            "with a measured fu": sum(1 for m in molecules if m.get("measured_fu") is not None),
            "with a measured VDss": sum(1 for m in molecules if m.get("measured_vdss_l_per_kg") is not None),
            "with a measured half-life": sum(1 for m in molecules if m.get("measured_t_half_h") is not None),
            "with a measured assay hit rate": sum(1 for m in molecules if m.get("measured_assay_hit_rate") is not None),
            "FDA route legend entries": len(legend),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=PROJECT_FILES)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    data = build(args.root)
    for key, value in data["ledger"].items():
        print(f"{key:48s} {value}")
    print()
    for exclusion in data["exclusions"]:
        print(f"excluded [{exclusion['stage']}] {exclusion['row'][:60]}\n    {exclusion['reason']}")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
