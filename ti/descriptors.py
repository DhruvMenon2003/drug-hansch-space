#!/usr/bin/env python3
"""The declared descriptor block: sixteen whole-molecule numbers, computed one way, from one standardiser.

    ti/descriptors.py --smiles "CC(=O)Oc1ccccc1C(=O)O"     # one molecule, printed
    ti/descriptors.py --selftest                           # the standardiser's behaviour, asserted

WHY THESE SIXTEEN

The set is declared before any model is fitted (OECD principle 2) and it is small on purpose. Every entry is
interpretable on its own and is defined for a whole molecule, so the same number means the same thing for a
beta-blocker and for a macrolide.

  hydrophobic   clogp, clogp_sq        Crippen logP and its square. The square is the whole point of a Hansch
                                       model: it lets the fit find an optimum in lipophilicity instead of
                                       assuming more is always better. Without it you cannot see the parabola.
  steric/bulk   mr, mw, fsp3           Crippen molar refractivity is the classical Hansch steric-and-polarisability
                                       term; fsp3 separates flat aromatics from three-dimensional molecules.
  polar         tpsa, hbd, hba         Desolvation cost and the hydrogen-bond pattern.
  flexibility   rotb                   Rotatable bonds: the entropy a molecule pays to bind.
  shape         aromatic_rings
  electronic    max_partial_charge,    Gasteiger extremes. See the note on Hammett sigma below.
                min_partial_charge
  ionisation    formal_charge,         Charge state drives both membrane crossing and hERG binding.
                n_basic_centres,
                n_acidic_centres
  drug-likeness qed

HAMMETT SIGMA AND TAFT Es ARE NOT IN THIS BLOCK, AND THAT IS A DELIBERATE DECISION.

Both are *substituent* constants. Sigma is defined for a substituent on a shared aromatic core relative to
hydrogen; Taft Es is defined for a substituent next to a shared reaction centre. Neither has a value for a whole
molecule, and neither is comparable across molecules that do not share a core. Assigning a single sigma to
amphotericin B and to atenolol would be inventing a number. So the whole-library run uses the Gasteiger partial
charge extremes as its electronic term, which is defined everywhere, and sigma/Es stay available for the place
they are valid: a congeneric series inside one scaffold cluster, where the core is constant and the substituent
is the only thing that changes.

MEASURED VALUES NEVER ENTER THIS BLOCK. The human fu, VDss, clearance and half-life that dataset3 supplies are
measurements, not descriptors; they travel through the pipeline with a measured_ prefix and are never fitted
against as if they were calculated. Mixing the two is how a model ends up learning from its own answer.
"""

from __future__ import annotations

import argparse
import sys

from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize

RDLogger.DisableLog("rdApp.*")

DESCRIPTORS = [
    "mw", "clogp", "clogp_sq", "mr", "tpsa", "hbd", "hba", "rotb",
    "aromatic_rings", "fsp3", "formal_charge", "n_basic_centres", "n_acidic_centres",
    "max_partial_charge", "min_partial_charge", "qed",
]

# The six the Hansch-style interpretable model is allowed to use. A deliberately short list: with the training
# sets available here (tens to a couple of hundred compounds), more terms buys fitted noise, not insight.
HANSCH_TERMS = ["clogp", "clogp_sq", "mr", "tpsa", "hbd", "hba"]

MEASURED = [
    "measured_fu", "measured_vdss_l_per_kg", "measured_cl_ml_per_min_per_kg",
    "measured_mrt_h", "measured_t_half_h",
    # Promiscuity, from dataset1's PubChem bioassay counts: see ti/inputs._assay_hit_rate for why the two
    # counts travel with the ratio and why a ratio over fewer than twenty assays is withheld.
    "measured_assay_hit_rate", "measured_assays_active", "measured_assays_tried",
]

_BASIC = Chem.MolFromSmarts("[$([NX3;H2,H1,H0;!$(N[!#6]);!$(N=*);!$(N#*);!$(N[a]);!$(NC=[O,N,S])])]")
_ACIDIC = Chem.MolFromSmarts("[$([CX3](=O)[OX2H1]),$([SX4](=O)(=O)[OX2H1]),$([PX4](=O)[OX2H1]),$([nH1]1nnnc1)]")

_uncharger = rdMolStandardize.Uncharger()
_chooser = rdMolStandardize.LargestFragmentChooser()


def standardise(smiles: str):
    """SMILES -> (mol, note). Largest organic fragment, sanitised, neutralised. Returns (None, reason) on refusal.

    The salt is dropped, not the drug: LargestFragmentChooser keeps the heaviest fragment, so sodium diclofenac
    becomes diclofenac. A molecule whose largest fragment carries a metal is refused rather than described, because
    Crippen logP and molar refractivity have no parameters for metals and would return a number anyway.
    """
    if not smiles or not smiles.strip():
        return None, "no SMILES"
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        return None, "RDKit could not parse the SMILES"
    try:
        mol = _chooser.choose(mol)
        mol = _uncharger.uncharge(mol)
        Chem.SanitizeMol(mol)
    except Exception as exc:
        return None, f"standardisation failed: {type(exc).__name__}"
    if mol.GetNumHeavyAtoms() < 3:
        return None, "fewer than three heavy atoms after the salt was removed"
    for atom in mol.GetAtoms():
        if atom.GetAtomicNum() not in (1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 34, 35, 53):
            return None, f"contains {atom.GetSymbol()}, which the Crippen parameters do not cover"
    if not any(atom.GetAtomicNum() == 6 for atom in mol.GetAtoms()):
        return None, "no carbon: not an organic molecule"
    return mol, None


def compute(smiles: str) -> tuple[dict | None, str | None]:
    """The declared block for one SMILES, or (None, reason)."""
    mol, note = standardise(smiles)
    if mol is None:
        return None, note
    try:
        charges = Chem.Mol(mol)
        Chem.rdPartialCharges.ComputeGasteigerCharges(charges)
        values = [a.GetDoubleProp("_GasteigerCharge") for a in charges.GetAtoms()]
        values = [v for v in values if v == v and abs(v) != float("inf")]
        clogp = Crippen.MolLogP(mol)
        out = {
            "mw": Descriptors.MolWt(mol),
            "clogp": clogp,
            "clogp_sq": clogp * clogp,
            "mr": Crippen.MolMR(mol),
            "tpsa": rdMolDescriptors.CalcTPSA(mol),
            "hbd": rdMolDescriptors.CalcNumHBD(mol),
            "hba": rdMolDescriptors.CalcNumHBA(mol),
            "rotb": rdMolDescriptors.CalcNumRotatableBonds(mol),
            "aromatic_rings": rdMolDescriptors.CalcNumAromaticRings(mol),
            "fsp3": rdMolDescriptors.CalcFractionCSP3(mol),
            "formal_charge": Chem.GetFormalCharge(mol),
            "n_basic_centres": len(mol.GetSubstructMatches(_BASIC)),
            "n_acidic_centres": len(mol.GetSubstructMatches(_ACIDIC)),
            "max_partial_charge": max(values) if values else None,
            "min_partial_charge": min(values) if values else None,
            "qed": QED.qed(mol),
        }
    except Exception as exc:
        return None, f"descriptor calculation failed: {type(exc).__name__}"
    if any(v is None or v != v for v in out.values()):
        return None, "a descriptor came back undefined"
    out["canonical_smiles"] = Chem.MolToSmiles(mol)
    out["inchikey"] = Chem.MolToInchiKey(mol)
    return out, None


def selftest() -> int:
    """Assert the three standardiser behaviours the pipeline depends on."""
    checks = [
        ("[Na+].[O-]C(=O)c1ccccc1", "salt stripped and neutralised", lambda d, n: d and d["canonical_smiles"] == "O=C(O)c1ccccc1"),
        ("[Pt](Cl)(Cl)(N)N", "metal refused", lambda d, n: d is None and "Crippen" in (n or "")),
        ("not a molecule at all", "unparseable refused", lambda d, n: d is None and "parse" in (n or "")),
        ("CC(=O)Oc1ccccc1C(=O)O", "aspirin described", lambda d, n: d and 1.0 < d["clogp"] < 1.5 and abs(d["clogp_sq"] - d["clogp"] ** 2) < 1e-9),
    ]
    failed = 0
    for smiles, label, predicate in checks:
        data, note = compute(smiles)
        ok = bool(predicate(data, note))
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}{'' if ok else f'  -> {note or data}'}")
        failed += 0 if ok else 1
    print(f"{len(checks) - failed}/{len(checks)} passed")
    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--smiles")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    if not args.smiles:
        ap.error("give --smiles or --selftest")
    data, note = compute(args.smiles)
    if data is None:
        print(f"refused: {note}")
        return 1
    width = max(len(k) for k in data)
    for key, value in data.items():
        print(f"{key:{width}s}  {value if isinstance(value, str) else round(value, 4)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
