"""Congeneric series, R-group decomposition, and the Hansch descriptor block.

A Hansch equation is only meaningful inside a congeneric series: one parent structure with
substituents varied at defined positions. This finds those series in a set of molecules by
Bemis-Murcko scaffold, decomposes each series against its own scaffold, matches every
R-group to a published substituent constant by structure (not by name), and refuses the
compound if any of its R-groups has no tabulated constant - rather than estimating one.

For a series with several varying positions the descriptors are the sums over positions,
which is Hansch's own treatment of a polysubstituted series: sum(pi), sum(sigma), sum(Es),
sum(MR), plus sum(pi) squared for the parabolic lipophilicity term.
"""
from __future__ import annotations

import collections
from dataclasses import dataclass, field

from rdkit import Chem, RDLogger
from rdkit.Chem import rdRGroupDecomposition as rgd
from rdkit.Chem.Scaffolds import MurckoScaffold

RDLogger.DisableLog("rdApp.*")

HANSCH_TERMS = ["sum_pi", "sum_pi_sq", "sum_sigma", "sum_Es", "sum_MR"]


def canonical_fragment(smiles_with_star: str) -> str | None:
    """Canonical SMILES of an R-group with its attachment point stripped to [*]."""
    s = smiles_with_star
    for i in range(1, 10):
        s = s.replace(f"[*:{i}]", "[*]")
    mol = Chem.MolFromSmiles(s)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol)


def constant_lookup(constants: dict) -> dict[str, str]:
    """Canonical fragment SMILES -> substituent name, so matching is structural."""
    out: dict[str, str] = {}
    for name, row in constants.items():
        key = canonical_fragment(str(row["smiles"]))
        if key is not None:
            out[key] = name
    return out


@dataclass
class Series:
    scaffold: str
    members: list[str] = field(default_factory=list)          # compound ids, in order
    r_groups: dict[str, dict[str, str]] = field(default_factory=dict)  # cmpd -> {R1: name}
    positions: list[str] = field(default_factory=list)
    unmatched_fragments: collections.Counter = field(default_factory=collections.Counter)
    dropped: dict[str, str] = field(default_factory=dict)      # cmpd -> reason

    @property
    def n(self) -> int:
        return len(self.members)

    def varying_positions(self) -> list[str]:
        return [p for p in self.positions
                if len({self.r_groups[c].get(p) for c in self.members}) > 1]


def find_series(records: list[dict], constants: dict, min_size: int = 8,
                smiles_key: str = "smiles", id_key: str = "compound_id") -> list[Series]:
    """Group by Murcko scaffold, decompose, and keep series with enough covered members."""
    lookup = constant_lookup(constants)
    by_scaffold: dict[str, list[tuple[str, Chem.Mol]]] = collections.defaultdict(list)
    for rec in records:
        mol = Chem.MolFromSmiles(rec[smiles_key])
        if mol is None:
            continue
        by_scaffold[MurckoScaffold.MurckoScaffoldSmiles(mol=mol)].append((rec[id_key], mol))

    series: list[Series] = []
    for scaffold, members in by_scaffold.items():
        if len(members) < min_size:
            continue
        core = Chem.MolFromSmiles(scaffold)
        if core is None:
            continue
        ids = [i for i, _ in members]
        mols = [m for _, m in members]
        try:
            rows, unmatched = rgd.RGroupDecompose([core], mols, asSmiles=True, asRows=True)
        except Exception:
            continue
        if unmatched:
            matched_ids = [i for k, i in enumerate(ids) if k not in set(unmatched)]
        else:
            matched_ids = ids
        if len(rows) != len(matched_ids):
            continue
        s = Series(scaffold=scaffold)
        positions = sorted({k for row in rows for k in row if k.startswith("R")})
        s.positions = positions
        for cmpd, row in zip(matched_ids, rows):
            named: dict[str, str] = {}
            missing = []
            for pos in positions:
                frag = row.get(pos)
                if frag is None:
                    named[pos] = "H"
                    continue
                key = canonical_fragment(frag)
                name = lookup.get(key or "")
                if name is None:
                    s.unmatched_fragments[key or frag] += 1
                    missing.append(f"{pos}={key or frag}")
                else:
                    named[pos] = name
            if missing:
                s.dropped[cmpd] = "no tabulated constant for " + "; ".join(missing)
                continue
            s.members.append(cmpd)
            s.r_groups[cmpd] = named
        if s.n >= min_size:
            series.append(s)
    series.sort(key=lambda s: -s.n)
    return series


def hansch_block(series: Series, constants: dict,
                 sigma_position: str = "sigma_p") -> tuple[list[str], list[list[float]], list[str]]:
    """Summed substituent constants for each member. Returns (compound ids, X, term names).

    Es is summed only over substituents for which the compilation gives a standard value; a
    series where any member's substituent has no Es is reported and the Es term is dropped
    rather than filled with a zero, because zero means hydrogen on that scale.
    """
    positions = series.varying_positions() or series.positions
    es_available = all(
        constants[series.r_groups[c][p]]["Es"] is not None
        for c in series.members for p in positions)
    terms = ["sum_pi", "sum_pi_sq", "sum_sigma", "sum_MR"]
    if es_available:
        terms.insert(3, "sum_Es")
    X: list[list[float]] = []
    for c in series.members:
        pi = sum(float(constants[series.r_groups[c][p]]["pi"]) for p in positions)
        sigma = sum(float(constants[series.r_groups[c][p]][sigma_position]) for p in positions)
        mr = sum(float(constants[series.r_groups[c][p]]["MR"]) for p in positions)
        row = [pi, pi * pi, sigma]
        if es_available:
            row.append(sum(float(constants[series.r_groups[c][p]]["Es"]) for p in positions))
        row.append(mr)
        X.append(row)
    return list(series.members), X, terms


def free_wilson_block(series: Series) -> tuple[list[str], list[list[float]], list[str]]:
    """Indicator variables, one per (position, substituent), hydrogen held as the reference."""
    positions = series.varying_positions()
    columns: list[tuple[str, str]] = []
    for p in positions:
        subs = sorted({series.r_groups[c][p] for c in series.members})
        for s in subs:
            if s == "H":
                continue
            columns.append((p, s))
    X = [[1.0 if series.r_groups[c][p] == s else 0.0 for p, s in columns]
         for c in series.members]
    names = [f"{p}:{s}" for p, s in columns]
    return list(series.members), X, names
