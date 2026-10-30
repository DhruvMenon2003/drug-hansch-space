"""Published substituent constants for the Hansch (Tier 1) and Free-Wilson (Tier 2) models.

These are NOT measurements made here and NOT predictions. They are reference values
transcribed from the standard compilations:

  Hansch, C.; Leo, A.; Taft, R. W. "A Survey of Hammett Substituent Constants and
  Resonance and Field Parameters." Chem. Rev. 1991, 91 (2), 165-195.
  doi:10.1021/cr00002a004
  Hansch, C.; Leo, A.; Hoekman, D. "Exploring QSAR: Hydrophobic, Electronic, and Steric
  Constants"; ACS Professional Reference Book; American Chemical Society, 1995.

Transcription is the weak link in any table like this, so the notebook does not take it on
trust. `validate_pi_against_experiment` re-derives pi from experimental log P by its own
definition, pi(X) = logP(C6H5-X) - logP(C6H6), using only measured log P values pulled from
ChEMBL, and reports the agreement. A substituent whose tabulated pi disagrees with the
experimental derivation is named in the output rather than used silently.

Columns:
  pi      Hansch hydrophobic substituent constant, from the benzene system
  sigma_m Hammett constant, meta
  sigma_p Hammett constant, para
  Es      Taft steric parameter (None where the compilation gives no standard value)
  MR      molar refractivity, scaled by 0.1 as is conventional in QSAR tables
"""
from __future__ import annotations

from dataclasses import dataclass

# SMARTS/SMILES of the substituent as it attaches, used to match R-groups by structure
# rather than by name. The attachment point is written as [*].
CONSTANTS: dict[str, dict[str, float | None | str]] = {
    "H":        {"smiles": "[*][H]",            "pi":  0.00, "sigma_m":  0.00, "sigma_p":  0.00, "Es":  0.00, "MR": 0.103},
    "CH3":      {"smiles": "[*]C",              "pi":  0.56, "sigma_m": -0.07, "sigma_p": -0.17, "Es": -1.24, "MR": 0.565},
    "C2H5":     {"smiles": "[*]CC",             "pi":  1.02, "sigma_m": -0.07, "sigma_p": -0.15, "Es": -1.31, "MR": 1.030},
    "n-C3H7":   {"smiles": "[*]CCC",            "pi":  1.55, "sigma_m": -0.07, "sigma_p": -0.13, "Es": -1.60, "MR": 1.496},
    "i-C3H7":   {"smiles": "[*]C(C)C",          "pi":  1.53, "sigma_m": -0.07, "sigma_p": -0.15, "Es": -1.71, "MR": 1.496},
    "t-C4H9":   {"smiles": "[*]C(C)(C)C",       "pi":  1.98, "sigma_m": -0.10, "sigma_p": -0.20, "Es": -2.78, "MR": 1.962},
    "C6H5":     {"smiles": "[*]c1ccccc1",       "pi":  1.96, "sigma_m":  0.06, "sigma_p": -0.01, "Es": -2.55, "MR": 2.536},
    "F":        {"smiles": "[*]F",              "pi":  0.14, "sigma_m":  0.34, "sigma_p":  0.06, "Es": -0.46, "MR": 0.092},
    "Cl":       {"smiles": "[*]Cl",             "pi":  0.71, "sigma_m":  0.37, "sigma_p":  0.23, "Es": -0.97, "MR": 0.603},
    "Br":       {"smiles": "[*]Br",             "pi":  0.86, "sigma_m":  0.39, "sigma_p":  0.23, "Es": -1.16, "MR": 0.888},
    "I":        {"smiles": "[*]I",              "pi":  1.12, "sigma_m":  0.35, "sigma_p":  0.18, "Es": -1.40, "MR": 1.839},
    "OH":       {"smiles": "[*]O",              "pi": -0.67, "sigma_m":  0.12, "sigma_p": -0.37, "Es": -0.55, "MR": 0.285},
    "OCH3":     {"smiles": "[*]OC",             "pi": -0.02, "sigma_m":  0.12, "sigma_p": -0.27, "Es": -0.55, "MR": 0.787},
    "OC2H5":    {"smiles": "[*]OCC",            "pi":  0.38, "sigma_m":  0.10, "sigma_p": -0.24, "Es": None,  "MR": 1.247},
    "OCF3":     {"smiles": "[*]OC(F)(F)F",      "pi":  1.04, "sigma_m":  0.38, "sigma_p":  0.35, "Es": None,  "MR": 0.786},
    "NH2":      {"smiles": "[*]N",              "pi": -1.23, "sigma_m": -0.16, "sigma_p": -0.66, "Es": -0.61, "MR": 0.542},
    "N(CH3)2":  {"smiles": "[*]N(C)C",          "pi":  0.18, "sigma_m": -0.15, "sigma_p": -0.83, "Es": None,  "MR": 1.555},
    "NO2":      {"smiles": "[*][N+](=O)[O-]",   "pi": -0.28, "sigma_m":  0.71, "sigma_p":  0.78, "Es": -2.52, "MR": 0.736},
    "CN":       {"smiles": "[*]C#N",            "pi": -0.57, "sigma_m":  0.56, "sigma_p":  0.66, "Es": -0.51, "MR": 0.633},
    "CF3":      {"smiles": "[*]C(F)(F)F",       "pi":  0.88, "sigma_m":  0.43, "sigma_p":  0.54, "Es": -2.40, "MR": 0.502},
    "CHO":      {"smiles": "[*]C=O",            "pi": -0.65, "sigma_m":  0.35, "sigma_p":  0.42, "Es": None,  "MR": 0.688},
    "COCH3":    {"smiles": "[*]C(C)=O",         "pi": -0.55, "sigma_m":  0.38, "sigma_p":  0.50, "Es": -1.24, "MR": 1.118},
    "COOH":     {"smiles": "[*]C(O)=O",         "pi": -0.32, "sigma_m":  0.37, "sigma_p":  0.45, "Es": None,  "MR": 0.693},
    "CONH2":    {"smiles": "[*]C(N)=O",         "pi": -1.49, "sigma_m":  0.28, "sigma_p":  0.36, "Es": None,  "MR": 0.981},
    "SCH3":     {"smiles": "[*]SC",             "pi":  0.61, "sigma_m":  0.15, "sigma_p":  0.00, "Es": None,  "MR": 1.382},
    "SO2NH2":   {"smiles": "[*]S(N)(=O)=O",     "pi": -1.82, "sigma_m":  0.53, "sigma_p":  0.57, "Es": None,  "MR": 1.228},
}

CITATION = (
    "Hansch, Leo & Taft, Chem. Rev. 1991, 91, 165-195 (doi:10.1021/cr00002a004); "
    "Hansch, Leo & Hoekman, Exploring QSAR, ACS, 1995."
)

SOURCE_TYPE = "literature_compilation"


@dataclass(frozen=True)
class Anchor:
    """A pair whose experimental log P difference defines pi for one substituent."""
    substituent: str
    parent_smiles: str = "c1ccccc1"
    probe_smiles: str = ""


def self_consistency_failures() -> list[str]:
    """Checks that hold by the definition of each scale, independent of any measurement."""
    bad = []
    h = CONSTANTS["H"]
    for name, field in (("pi", "pi"), ("sigma_m", "sigma_m"), ("sigma_p", "sigma_p"), ("Es", "Es")):
        if h[field] != 0.0:
            bad.append(f"H must have {name} = 0 by definition, table says {h[field]}")
    for key, row in CONSTANTS.items():
        if row["MR"] is None or float(row["MR"]) <= 0:
            bad.append(f"{key}: molar refractivity must be positive")
        es = row["Es"]
        if es is not None and float(es) > 0:
            bad.append(f"{key}: Taft Es is defined as <= 0 (H = 0), table says {es}")
    # Halogen ordering is a textbook consequence of size: F < Cl < Br < I in both pi and -Es.
    halogens = ["F", "Cl", "Br", "I"]
    pis = [float(CONSTANTS[h]["pi"]) for h in halogens]
    if pis != sorted(pis):
        bad.append(f"halogen pi should increase F<Cl<Br<I, table gives {pis}")
    eses = [-float(CONSTANTS[h]["Es"]) for h in halogens]
    if eses != sorted(eses):
        bad.append(f"halogen -Es should increase F<Cl<Br<I, table gives {eses}")
    return bad


def probe_smiles(substituent: str) -> str | None:
    """The monosubstituted benzene whose experimental log P gives pi for this substituent."""
    frag = CONSTANTS[substituent]["smiles"]
    if not isinstance(frag, str):
        return None
    tail = frag.replace("[*]", "", 1)
    if tail == "[H]":
        return "c1ccccc1"
    return "c1ccccc1" + tail if tail.startswith(("C", "O", "N", "S", "F", "I", "B", "[", "c")) else None
