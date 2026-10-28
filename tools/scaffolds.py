"""Bemis–Murcko scaffolds and scaffold families.

Bemis and Murcko (J. Med. Chem. 1996, 39, 2887) strip a molecule to its ring systems and the linkers between them.
Two compounds that share that framework are in the same chemical series, which is what the explorer calls a scaffold
family: the grouping behind the scaffold cluster view and the scaffold split in the QSAR builder.

Used by tools/add_scaffolds.py (per-target sets), tools/build_scaffolds.py (explorer drugs) and
tools/build_qsar_targets.py (a full rebuild), so every scaffold in the site comes from one definition.
"""
from __future__ import annotations

from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

#: What an acyclic molecule gets instead of a scaffold SMILES (it has no ring system to share).
ACYCLIC = ""


def murcko(mol) -> tuple[str, str]:
    """Return (Bemis–Murcko scaffold SMILES, generic framework SMILES) for `mol`.

    The scaffold keeps elements and bond orders; the generic framework replaces every atom with carbon and every bond
    with a single bond, so e.g. pyridine and benzene share a framework but not a scaffold. Acyclic molecules give
    (ACYCLIC, ACYCLIC).
    """
    try:
        sc = MurckoScaffold.GetScaffoldForMol(mol)
    except Exception:
        return ACYCLIC, ACYCLIC
    if sc is None or not sc.GetNumAtoms():
        return ACYCLIC, ACYCLIC
    smiles = Chem.MolToSmiles(sc)
    try:
        generic = Chem.MolToSmiles(MurckoScaffold.MakeScaffoldGeneric(sc))
    except Exception:
        generic = ACYCLIC
    return smiles, generic


def families(scaffolds: list[str], generics: list[str] | None = None) -> tuple[list[int], list[dict]]:
    """Group compounds by scaffold SMILES.

    Families are numbered by size, largest first, with ties broken by the scaffold SMILES so the numbering is the same
    on every run; acyclic compounds always come last. Returns (family index per compound, family records).
    """
    order: dict[str, list[int]] = {}
    for i, smiles in enumerate(scaffolds):
        order.setdefault(smiles, []).append(i)
    ranked = sorted(order.items(), key=lambda kv: (kv[0] == ACYCLIC, -len(kv[1]), kv[0]))
    index = [0] * len(scaffolds)
    out = []
    for k, (smiles, members) in enumerate(ranked):
        for i in members:
            index[i] = k
        row = {"i": k, "smiles": smiles, "n": len(members)}
        if generics:
            row["generic"] = generics[members[0]]
        out.append(row)
    return index, out
