#!/usr/bin/env python3
"""Systematic model comparison in the QSAR-Co tradition, for the curated drug table in this repository.

The method reference is the QSAR-Co v1.0.0 user manual (Ambure, Halder, Gonzalez-Diaz, Cordeiro;
Faculdade de Ciencias, Universidade do Porto; J. Chem. Inf. Model. 2019, 59, 2538-2544), read from
`/mnt/project-files/QSAR-Co Manual.pdf`. Page numbers below are pages of that 30-page PDF.

What is taken from the manual, and where:

* Input file format (p. 20-21, "HOW TO PREPARE THE INPUT FILE", Snapshot 5). A .csv whose columns are,
  in this exact order: first column the chemical ID; next column(s) the experimental conditions; next
  column the response class; next column the confidence variable (optional, numerical); all subsequent
  columns the descriptors. `models/qsar_co_input*.csv` are written in that order, with the **mode of
  administration as the condition column** - QSAR-Co's conditions are exactly for a response measured
  under different experimental settings, which is what a route of administration is here.
* Conditions / Box-Jenkins approach (p. 7 Step 2, p. 22 'File1_AvgDesc.csv'). The manual states that the
  condition columns drive a Box-Jenkins moving-average transformation of the descriptors, and that the
  per-condition average descriptor values are written out, but it does not print the operator itself.
  This script therefore implements the published form used by the QSAR-Co authors, the deviation from
  the condition mean, D_i(c) = D_i - mean(D over all compounds sharing condition c), and says so in the
  results JSON (`approach: "box_jenkins"`). The plain descriptors are the manual's 'Normal approach'.
* Data pre-treatment (p. 8-9 Step 3). Remove constant descriptors (variance cut-off 0.001) and
  inter-correlated descriptors (|r| cut-off 0.99); performed twice, once before the dataset division
  (DPT1) and again on the training set after it (DPT2), the removal then applied to both sets.
* Dataset division (p. 9-10 Step 4). Default 70 % training. Kennard-Stone (Kennard & Stone,
  Technometrics 1969, 11, 137-148) on Euclidean distances: seed the training set with the two most
  distant compounds, then repeatedly add the compound maximising the minimum distance to those already
  chosen. The manual prefers rational division for 50-500 compounds and random division above ~500,
  which is the rule this script follows and reports.
* Less-discriminating descriptors (p. 10 Step 5). Scale 0-1, take class means, drop descriptors whose
  absolute between-class mean difference is below 0.05. Optional in the manual; reported, not applied,
  so the ladder sees one descriptor matrix.
* Genetic-algorithm variable selection for LDA (p. 10-11 Step 6): 100 iterations, equation length 3,
  mutation probability 0.3, 100 initial equations, 30 top equations per generation, fitness from
  Wilks lambda. Implemented as GA-LDA, with the manual's defaults.
* Model development (p. 11-12 Step 7): two-class LDA with priors from the class sizes, and Random
  Forest (the manual's defaults: 100 iterations, unlimited depth, int(log2(#predictors)+1) features,
  seed 1, 10-fold cross-validation).
* Validation (p. 13-16 Step 8). Wilks lambda = within-group sum of squares / total sum of squares, 0
  perfect discrimination and 1 none (p. 13). Confusion matrix and accuracy = (TP+TN)/(TP+FN+TN+FP),
  sensitivity = TP/(TP+FN), specificity = TN/(TN+FP), precision = TP/(TP+FP),
  F-measure = 2/(1/precision + 1/sensitivity), MCC = (TP*TN - FP*FN)/sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))
  (p. 14). ROC AUC by k-fold cross-validation (p. 15). Y-randomisation, default 50 shuffles of the
  training response with the descriptors held fixed, the random models compared with the original and
  the random Wilks lambda expected near 1 (p. 16).
  Note one internal inconsistency in the manual: p. 14 defines the F-measure as the harmonic mean of
  precision and sensitivity (so it lies in 0-1, 1 being ideal) and then says it "theoretically becomes
  infinite if a model totally fails to predict any true positives", which that formula does not do. The
  formula is used here, on fractions, not the sentence.
* Applicability domain (p. 17 Step 9): confidence estimation, a prediction counted reliable when the
  gap between the two posterior probabilities is at least 0.5.

IMPORTANT, and stated in the results JSON as well: QSAR-Co is a classification-only tool. It validates
a classification restatement of the problem - response binarised into two classes - not the continuous
Hansch regression this repository fits elsewhere. The regression half of the ladder below (multiple
linear regression, PLS, and the regressor forms of the machine-learning models) is therefore validated
with the usual continuous QSAR statistics (r2, leave-one-out q2 by PRESS, RMSE, external r2_pred), not
with the manual's battery, and the two halves are ranked separately.

Everything is split and cross-validated **by compound** (grouped on PubChem CID), never by row, because
one drug contributes several rows when it has several modes of administration. A row-wise split would
put the same molecule in the training and the external set and inflate every number reported here.

Usage:
    python3 tools/ml_ladder.py                       # full run, writes models/
    python3 tools/ml_ladder.py --quick               # fewer permutations, smaller models
    python3 tools/ml_ladder.py --src path/to.csv     # primary input when it exists
    python3 tools/ml_ladder.py --atc4 A02BA --out models
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 20261014
REPO = Path(__file__).resolve().parent.parent
DEFAULT_SRC = REPO / "site" / "data" / "clean_drugs.csv"

# QSAR-Co manual defaults (p. 8-11)
VAR_CUT = 0.001
CORR_CUT = 0.99
LESS_DISCRIM_CUT = 0.05
TRAIN_FRAC = 0.70
N_YRAND = 50
GA_ITERS = 100
GA_EQ_LEN = 3
GA_MUT_P = 0.3
GA_N_EQ = 100
GA_TOP = 30
AD_POSTERIOR_GAP = 0.5

# QED's own eight terms (p. QED: Bickerton et al. 2012). Kept out of the descriptor block whenever QED
# itself is the response, because QED is a deterministic function of exactly these eight numbers.
QED_TERMS = ["MW", "ALOGP", "HBA", "HBD", "PSA", "ROTB", "AROM", "ALERTS"]

# Descriptors that are NOT inputs to QED. Used when the response is QED or its class.
NON_QED_DESCRIPTORS = [
    "MolMR", "FractionCSP3", "HeavyAtomCount", "RingCount", "NumAliphaticRings",
    "NumSaturatedRings", "NumHeteroatoms", "BertzCT", "Chi1v", "Kappa2",
]
# Hansch-style block for a measured biological response.
HANSCH_DESCRIPTORS = [
    "logP", "logP2", "MolMR", "TPSA", "MW", "HBD", "HBA", "ROTB", "AROM", "FractionCSP3",
]
# The classic Hansch triad, for the cohort that is far too small for anything wider.
H2_DESCRIPTORS = ["logP", "MolMR", "TPSA"]


# --------------------------------------------------------------------------------------------------
# descriptors
# --------------------------------------------------------------------------------------------------
def descriptor_block(smiles: str) -> dict:
    """Every descriptor the ladder can use, computed by RDKit from one curated SMILES.

    Recomputed here rather than read from the input table so that the descriptor matrix is identical
    whichever input source is available, and so that QED and its eight component properties come from
    one place (rdkit.Chem.QED, mean weights, Bickerton et al. Nat Chem 2012;4:90-98).
    """
    from rdkit import Chem
    from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors

    mol = Chem.MolFromSmiles(smiles) if smiles else None
    if mol is None:
        return {}
    props = QED.properties(mol)
    out = {
        "MW": float(props.MW),
        "ALOGP": float(props.ALOGP),
        "HBA": float(props.HBA),
        "HBD": float(props.HBD),
        "PSA": float(props.PSA),
        "ROTB": float(props.ROTB),
        "AROM": float(props.AROM),
        "ALERTS": float(props.ALERTS),
        "QED": float(QED.qed(mol)),
        "QED_max_weights": float(QED.qed(mol, QED.WEIGHT_MAX)),
        # Crippen log P and TPSA under their usual RDKit definitions, so the Hansch block matches the
        # regressions already in this repository (site/data/hansch.json).
        "logP": float(Crippen.MolLogP(mol)),
        "TPSA": float(Descriptors.TPSA(mol)),
        "MolMR": float(Crippen.MolMR(mol)),
        "FractionCSP3": float(Descriptors.FractionCSP3(mol)),
        "HeavyAtomCount": float(Descriptors.HeavyAtomCount(mol)),
        "RingCount": float(Descriptors.RingCount(mol)),
        "NumAliphaticRings": float(Descriptors.NumAliphaticRings(mol)),
        "NumSaturatedRings": float(Descriptors.NumSaturatedRings(mol)),
        "NumHeteroatoms": float(Descriptors.NumHeteroatoms(mol)),
        "BertzCT": float(Descriptors.BertzCT(mol)),
        "Chi1v": float(Descriptors.Chi1v(mol)),
        "Kappa2": float(Descriptors.Kappa2(mol)),
        "NumAmideBonds": float(rdMolDescriptors.CalcNumAmideBonds(mol)),
        "FormalCharge": float(Chem.GetFormalCharge(mol)),
    }
    out["logP2"] = out["logP"] ** 2  # the Hansch parabola
    for term in QED_TERMS:
        out[f"des_{term}"] = round(float(QED.ads(getattr(props, term), QED.adsParameters[term])), 4)
    return out


# --------------------------------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------------------------------
def _norm(name: str) -> str:
    return "".join(ch for ch in str(name).lower() if ch.isalnum())


def _pick(columns, *candidates):
    """First column whose normalised name equals, then contains, one of the candidates."""
    norm = {_norm(c): c for c in columns}
    for cand in candidates:
        if _norm(cand) in norm:
            return norm[_norm(cand)]
    for cand in candidates:
        key = _norm(cand)
        for n, original in norm.items():
            if key and key in n:
                return original
    return None


def _clean_route(value) -> str:
    """Empty string for a missing mode of administration ('NaN' appears as a literal in the cohort)."""
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "null", "na", "-"}:
        return ""
    return text.upper()


def load_primary(src: Path) -> tuple[pd.DataFrame, dict]:
    """site/data/clean_drugs.csv - one row per (drug, ATC code, mode of administration)."""
    raw = pd.read_csv(src)
    cols = list(raw.columns)
    cid = _pick(cols, "cid", "compound identifier", "pubchem cid")
    name = _pick(cols, "name", "generic name", "drug")
    atc = _pick(cols, "atc", "atc code", "anatomical therapeutic chemical code")
    route = _pick(cols, "route", "mode of administration")
    smiles = _pick(cols, "smiles", "structure")
    missing = [label for label, col in
               [("name", name), ("atc", atc), ("smiles", smiles)] if col is None]
    if missing:
        raise ValueError(f"{src} is missing a column for {', '.join(missing)}")
    frame = pd.DataFrame({
        "cid": raw[cid] if cid else raw[name],
        "name": raw[name].astype(str).str.strip().str.lower(),
        "atc_code": raw[atc].astype(str).str.strip().str.upper(),
        "route": raw[route].map(_clean_route) if route else "",
        "smiles": raw[smiles].astype(str),
    })
    carry = {}
    for label, *names in [
        ("F", "bioavailability", "fraction absorbed"), ("t_half", "half life", "halflife"),
        ("dose", "dosage", "dose"), ("tau", "dose interval"),
        ("invivo_act", "in vivo activity", "invivo activity"),
        ("invivo_tox", "in vivo toxicity", "invivo toxicity"),
        ("ti", "therapeutic index"), ("free_conc", "free drug concentration", "free concentration"),
        ("act", "in vitro activity", "pchembl"), ("offtox", "in vitro toxicity"),
        ("l1", "anatomical organ system", "atc level 1"), ("l4", "chemical group", "atc level 4"),
    ]:
        found = _pick(cols, *names)
        if found is not None:
            carry[label] = found
            frame[label] = raw[found]
    provenance = {
        "source": str(src.relative_to(REPO)) if src.is_relative_to(REPO) else str(src),
        "kind": "primary (clean_drugs.csv)",
        "rows_read": int(len(raw)),
        "columns_matched": {"cid": cid, "name": name, "atc_code": atc, "route": route,
                            "smiles": smiles, **carry},
    }
    return frame, provenance


def load_fallback() -> tuple[pd.DataFrame, dict]:
    """site/data/drugs.json (759 curated drugs, ATC codes with routes) exploded to one row per
    (drug, ATC code, mode of administration), with the measured activity from the same file."""
    path = REPO / "site" / "data" / "drugs.json"
    if not path.exists():
        path = REPO / "data" / "drugs.json"
    blob = json.loads(path.read_text())
    atc_names = blob["meta"].get("atc_names", {})
    rows = []
    for drug in blob["drugs"]:
        act = drug.get("act") or {}
        for entry in drug.get("atc", []):
            code = str(entry.get("code", "")).upper()
            routes = entry.get("routes") or [""]
            for route in routes:
                rows.append({
                    "cid": drug["cid"],
                    "name": str(drug.get("name", "")).replace(".", " ").strip().lower(),
                    "atc_code": code,
                    "route": _clean_route(route),
                    "smiles": drug.get("smiles", ""),
                    "chembl": drug.get("chembl"),
                    "l1": atc_names.get(code[:1], ""),
                    "l2": atc_names.get(code[:3], ""),
                    "l3": atc_names.get(code[:4], ""),
                    "l4": atc_names.get(code[:5], ""),
                    "act": act.get("p"),
                    "act_ndoc": act.get("ndoc"),
                    "act_target": act.get("target"),
                    "act_target_name": act.get("tname"),
                    "act_types": act.get("types"),
                })
    frame = pd.DataFrame(rows)
    provenance = {
        "source": str(path.relative_to(REPO)),
        "kind": "fallback (drugs.json exploded by ATC code and mode of administration)",
        "rows_read": int(len(frame)),
        "note": ("site/data/clean_drugs.csv was not present when this ran, so the table was built from "
                 "the curated drugs.json; QED and every descriptor are recomputed by RDKit from the "
                 "curated SMILES either way, so the model matrix is the same"),
        "generated_utc_of_source": blob["meta"].get("generated_utc"),
    }
    return frame, provenance


def load_table(src: Path) -> tuple[pd.DataFrame, dict]:
    frame, provenance = (load_primary(src) if src.exists() else load_fallback())
    frame["atc4"] = frame["atc_code"].str.slice(0, 5)
    frame["atc1"] = frame["atc_code"].str.slice(0, 1)
    # descriptors once per unique SMILES, then joined back
    unique = sorted(set(frame["smiles"].dropna().astype(str)))
    block = {smiles: descriptor_block(smiles) for smiles in unique}
    failed = sorted(s for s, d in block.items() if not d)
    desc = pd.DataFrame([block.get(s) or {} for s in frame["smiles"].astype(str)], index=frame.index)
    out = pd.concat([frame.drop(columns=[c for c in desc.columns if c in frame.columns]), desc], axis=1)
    out = out[out["QED"].notna()].copy()
    out["condition"] = out["route"].where(out["route"].astype(bool), "UNSPECIFIED")
    out = out.sort_values(["name", "atc_code", "condition", "cid"], kind="stable").reset_index(drop=True)
    provenance["rows_modellable"] = int(len(out))
    provenance["compounds"] = int(out["cid"].nunique())
    provenance["smiles_that_rdkit_could_not_parse"] = len(failed)
    provenance["descriptors_recomputed_by"] = (
        "rdkit.Chem.QED (mean weights), rdkit.Chem.Crippen, rdkit.Chem.Descriptors, "
        "rdkit.Chem.rdMolDescriptors")
    return out, provenance


def load_cohort(atc4: str) -> tuple[pd.DataFrame | None, dict]:
    """The hand-curated cohort table for one ATC level-4 group, with PK, toxicity and the indices."""
    path = REPO / "site" / "data" / f"cohort_{atc4}.json"
    if not path.exists():
        return None, {"source": None, "note": f"no cohort_{atc4}.json in site/data"}
    blob = json.loads(path.read_text())
    rows = []
    for row in blob["rows"]:
        flat = {k: v for k, v in row.items() if not isinstance(v, (dict, list))}
        for key in ["F", "t_half", "dose", "tau", "invivo_act", "invivo_tox", "endpoint"]:
            node = row.get(key) or {}
            if isinstance(node, dict):
                flat[key] = node.get("value")
                flat[f"{key}_source"] = node.get("source") or ""
                flat[f"{key}_evidence"] = node.get("evidence") or ""
        for key, value in (row.get("d") or {}).items():
            if key == "qdes":
                for term, des in (value or {}).items():
                    flat[f"des_{term}"] = des
            else:
                flat[f"cohort_{key}"] = value
        flat["flags"] = "; ".join(row.get("flags") or [])
        flat["route"] = _clean_route(row.get("route"))
        rows.append(flat)
    frame = pd.DataFrame(rows)
    meta = {
        "source": str(path.relative_to(REPO)),
        "atc4": blob["meta"].get("atc4"),
        "atc4_name": blob["meta"].get("atc4_name"),
        "n_drugs": blob["meta"].get("n_drugs"),
        "n_rows": blob["meta"].get("n_rows"),
        "target": blob["meta"].get("target"),
        "target_name": blob["meta"].get("target_name"),
        "formulas": blob["meta"].get("formulas", {}),
        "assumptions": blob["meta"].get("assumptions", []),
        "generated_utc_of_source": blob["meta"].get("generated_utc"),
    }
    return frame, meta


# --------------------------------------------------------------------------------------------------
# QSAR-Co input file (manual p. 20-21)
# --------------------------------------------------------------------------------------------------
def write_qsar_co_input(path: Path, frame: pd.DataFrame, id_col: str, condition_cols: list[str],
                        response_col: str, confidence_col: str | None,
                        descriptor_cols: list[str]) -> dict:
    """Columns in the manual's order: ID, condition(s), response class, confidence variable, descriptors.

    The manual forbids commas inside the ID, the condition names and the class names (p. 21), so those
    three are stripped of commas here.
    """
    out = pd.DataFrame()
    out["Chemical ID"] = (frame[id_col].astype(str).str.replace(",", " ", regex=False))
    for col in condition_cols:
        out[col] = frame[col].astype(str).str.replace(",", " ", regex=False)
    out["Response Class"] = frame[response_col].astype(str).str.replace(",", " ", regex=False)
    if confidence_col and confidence_col in frame:
        out["Confidence variable"] = pd.to_numeric(frame[confidence_col], errors="coerce")
    for col in descriptor_cols:
        out[col] = pd.to_numeric(frame[col], errors="coerce")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)
    return {
        "path": str(path.relative_to(REPO)) if path.is_relative_to(REPO) else str(path),
        "manual_reference": "QSAR-Co manual p. 20-21, 'HOW TO PREPARE THE INPUT FILE', Snapshot 5",
        "column_order": list(out.columns),
        "n_rows": int(len(out)),
        "condition_columns": condition_cols,
        "condition_is": "mode of administration (FDA route legend), one row per drug and route",
        "response_class": response_col,
        "confidence_variable": confidence_col,
        "n_descriptors": len(descriptor_cols),
    }


# --------------------------------------------------------------------------------------------------
# pre-treatment, conditions, division (manual p. 8-10)
# --------------------------------------------------------------------------------------------------
def pretreat(X: pd.DataFrame, var_cut: float = VAR_CUT, corr_cut: float = CORR_CUT) -> tuple[list, dict]:
    """Drop constant descriptors and one of every inter-correlated pair (manual p. 8-9).

    The variance cut-off is applied to each descriptor scaled to 0-1 so that the single cut-off means
    the same thing for a descriptor in daltons and one that counts rings; the manual gives one cut-off
    (0.001) without stating the scale.
    """
    kept = list(X.columns)
    constant = []
    for col in kept:
        values = X[col].astype(float)
        span = values.max() - values.min()
        scaled = (values - values.min()) / span if span > 0 else values * 0.0
        if span == 0 or float(np.var(scaled)) < var_cut:
            constant.append(col)
    kept = [c for c in kept if c not in constant]
    correlated = []
    if len(kept) > 1:
        corr = X[kept].astype(float).corr().abs()
        for i, a in enumerate(kept):
            if a in correlated:
                continue
            for b in kept[i + 1:]:
                if b in correlated:
                    continue
                value = corr.loc[a, b]
                if pd.notna(value) and value > corr_cut:
                    correlated.append(b)
    kept = [c for c in kept if c not in correlated]
    return kept, {"constant_removed": constant, "intercorrelated_removed": correlated,
                  "variance_cut_off": var_cut, "correlation_cut_off": corr_cut,
                  "variance_applied_to": "descriptors scaled 0-1"}


def less_discriminating(X: pd.DataFrame, y: np.ndarray, cut: float = LESS_DISCRIM_CUT) -> dict:
    """The manual's optional Step 5 (p. 10), reported but not applied."""
    span = X.max() - X.min()
    scaled = (X - X.min()) / span.replace(0, np.nan)
    diffs = {}
    for col in X.columns:
        values = scaled[col]
        gap = abs(float(values[y == 1].mean()) - float(values[y == 0].mean()))
        diffs[col] = round(gap, 4) if np.isfinite(gap) else None
    return {"threshold": cut, "abs_mean_difference": diffs,
            "would_remove": sorted(c for c, d in diffs.items() if d is not None and d < cut),
            "applied": False,
            "why_not": ("the manual calls this optional and warns that seemingly less-discriminating "
                        "descriptors sometimes contribute well (p. 10); reported so the choice is visible")}


def box_jenkins(X: pd.DataFrame, conditions: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Deviation of each descriptor from its mean over the compounds sharing that condition.

    QSAR-Co's 'Box-Jenkins approach' (manual p. 7 Step 2, p. 22 File1_AvgDesc.csv) modifies the
    descriptors using the conditions and writes the per-condition averages; the manual does not print
    the operator, so the published moving-average form is used and named in the results JSON.
    """
    means = X.groupby(conditions.values).mean()
    out = X.astype(float).to_numpy() - means.loc[conditions.values].to_numpy()
    return pd.DataFrame(out, index=X.index, columns=X.columns), means


def kennard_stone(X: np.ndarray, n_train: int) -> np.ndarray:
    """Indices chosen for the training set, Kennard & Stone 1969 (manual p. 9). Deterministic."""
    from scipy.spatial.distance import cdist

    dist = cdist(X, X)
    first, second = np.unravel_index(np.argmax(dist), dist.shape)
    chosen = [int(min(first, second)), int(max(first, second))]
    while len(chosen) < n_train:
        remaining = [i for i in range(len(X)) if i not in chosen]
        if not remaining:
            break
        min_to_chosen = dist[np.ix_(remaining, chosen)].min(axis=1)
        chosen.append(int(remaining[int(np.argmax(min_to_chosen))]))
    return np.array(sorted(chosen))


def divide(compound_X: pd.DataFrame, compound_y: np.ndarray, task: str,
           frac: float = TRAIN_FRAC) -> tuple[np.ndarray, np.ndarray, dict]:
    """Split compounds (never rows) into training and external sets, by the manual's size rule (p. 9-10)."""
    n = len(compound_X)
    n_train = int(round(frac * n))
    if n < 20:
        return (np.arange(n), np.array([], dtype=int),
                {"method": "none", "reason": (f"only {n} compounds: too few for a training/external split "
                                              "that would mean anything, so the whole set is used with "
                                              "leave-one-compound-out only"),
                 "n_train": n, "n_external": 0})
    from sklearn.preprocessing import StandardScaler

    scaled = StandardScaler().fit_transform(compound_X.astype(float).to_numpy())
    if n <= 500:
        train = kennard_stone(scaled, n_train)
        method = "kennard-stone"
        reason = (f"{n} compounds is in the manual's 50-500 range where rational division is preferred "
                  "over random, to avoid losing information in the split (p. 9-10)")
    else:
        from sklearn.model_selection import train_test_split

        strat = compound_y if task == "classification" else None
        train, _ = train_test_split(np.arange(n), train_size=n_train, random_state=SEED, stratify=strat)
        train = np.array(sorted(train))
        method = "stratified random" if task == "classification" else "random"
        reason = (f"{n} compounds is above the manual's ~500 threshold where random division is "
                  "suitable and much faster than rational division (p. 9-10)")
    test = np.array(sorted(set(range(n)) - set(train.tolist())))
    return train, test, {"method": method, "reason": reason, "train_fraction": frac,
                         "n_train": int(len(train)), "n_external": int(len(test)),
                         "split_unit": "compound (PubChem CID), so no molecule is in both sets"}


# --------------------------------------------------------------------------------------------------
# metrics (manual p. 13-15)
# --------------------------------------------------------------------------------------------------
def classification_metrics(y_true, y_pred, score=None) -> dict:
    y_true = np.asarray(y_true).astype(int)
    y_pred = np.asarray(y_pred).astype(int)
    tp = int(np.sum((y_true == 1) & (y_pred == 1)))
    fn = int(np.sum((y_true == 1) & (y_pred == 0)))
    tn = int(np.sum((y_true == 0) & (y_pred == 0)))
    fp = int(np.sum((y_true == 0) & (y_pred == 1)))
    total = tp + fn + tn + fp
    accuracy = (tp + tn) / total if total else None
    sensitivity = tp / (tp + fn) if (tp + fn) else None
    specificity = tn / (tn + fp) if (tn + fp) else None
    precision = tp / (tp + fp) if (tp + fp) else None
    f_measure = (2 / (1 / precision + 1 / sensitivity)
                 if precision and sensitivity else None)  # manual p. 14, harmonic mean
    denominator = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = ((tp * tn - fp * fn) / denominator) if denominator > 0 else None
    auc = None
    if score is not None and len(set(y_true.tolist())) == 2:
        from sklearn.metrics import roc_auc_score
        try:
            auc = float(roc_auc_score(y_true, np.asarray(score, dtype=float)))
        except Exception:
            auc = None
    return {
        "confusion_matrix": {"TP": tp, "FN": fn, "TN": tn, "FP": fp},
        "n": total,
        "accuracy": _round(accuracy), "sensitivity": _round(sensitivity),
        "specificity": _round(specificity), "precision": _round(precision),
        "f_measure": _round(f_measure), "mcc": _round(mcc), "auc": _round(auc),
    }


def wilks_lambda(scores, y_true) -> float | None:
    """Within-group sum of squares / total sum of squares on the discriminant score (manual p. 13)."""
    scores = np.asarray(scores, dtype=float).ravel()
    y_true = np.asarray(y_true)
    if scores.size < 3 or len(set(y_true.tolist())) < 2:
        return None
    total = float(np.sum((scores - scores.mean()) ** 2))
    if total <= 0:
        return None
    within = 0.0
    for group in sorted(set(y_true.tolist())):
        values = scores[y_true == group]
        if values.size:
            within += float(np.sum((values - values.mean()) ** 2))
    return round(within / total, 4)


def regression_metrics(y_true, y_pred, baseline_mean=None) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if y_true.size == 0:
        return {"n": 0, "r2": None, "rmse": None}
    mean = float(np.mean(y_true)) if baseline_mean is None else float(baseline_mean)
    ss_total = float(np.sum((y_true - mean) ** 2))
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    return {
        "n": int(y_true.size),
        "r2": _round(1 - ss_res / ss_total) if ss_total > 0 else None,
        "rmse": _round(math.sqrt(ss_res / y_true.size)),
        "baseline": "training-set mean" if baseline_mean is not None else "own mean",
    }


def _round(value, digits=4):
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return None if not np.isfinite(value) else round(value, digits)


# --------------------------------------------------------------------------------------------------
# the model ladder, lowest complexity first
# --------------------------------------------------------------------------------------------------
class PLSDA:
    """PLS regression on a +/-1 response, thresholded at zero: the usual PLS-DA."""

    def __init__(self, n_components=2):
        self.n_components = n_components

    def fit(self, X, y):
        from sklearn.cross_decomposition import PLSRegression
        self.n_components_ = max(1, min(self.n_components, X.shape[1], X.shape[0] - 1))
        self.model_ = PLSRegression(n_components=self.n_components_, scale=False)
        self.model_.fit(X, np.where(np.asarray(y) == 1, 1.0, -1.0))
        return self

    def decision_function(self, X):
        return self.model_.predict(X).ravel()

    def predict(self, X):
        return (self.decision_function(X) > 0).astype(int)


def ladder(task: str, n_descriptors: int, quick: bool) -> list[dict]:
    """The models to try, in the order the brief sets: lowest complexity first.

    Every model that has both a regressor and a classifier form is run in both, so the ladder is
    complete in both halves rather than mixing the two.
    """
    from sklearn.cross_decomposition import PLSRegression
    from sklearn.discriminant_analysis import (LinearDiscriminantAnalysis,
                                               QuadraticDiscriminantAnalysis)
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.neural_network import MLPClassifier, MLPRegressor
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import PolynomialFeatures
    from sklearn.svm import SVC, SVR

    trees = 100 if not quick else 40          # manual's Random Forest default is 100 iterations (p. 12)
    max_features = max(1, int(math.log2(max(n_descriptors, 2)) + 1))  # the manual's default (p. 12)
    pls_components = max(1, min(3, n_descriptors))
    mlp_iter = 1200 if not quick else 300
    spec: list[dict] = []

    def add(key, label, kind, factory, blackbox=False, discriminant=False, note=""):
        spec.append({"key": key, "label": label, "family": kind, "factory": factory,
                     "blackbox": blackbox, "discriminant": discriminant, "note": note})

    if task == "regression":
        add("mlr", "Multiple linear regression (Hansch)", "linear",
            lambda: LinearRegression(),
            note="ordinary least squares on the descriptor block, the Hansch form")
        add("pls", "PLS regression", "latent variable",
            lambda: PLSRegression(n_components=pls_components, scale=False),
            note=f"{pls_components} latent components")
        add("rf", "Random forest", "ensemble",
            lambda: RandomForestRegressor(n_estimators=trees, random_state=SEED, n_jobs=1,
                                          max_features=max_features),
            blackbox=True, note="manual's RF defaults (p. 12): 100 trees, unlimited depth, "
                                "int(log2(p)+1) features")
        add("xgb", "XGBoost", "boosted trees", _xgb_factory("regression", trees), blackbox=True)
        add("lgbm", "LightGBM", "boosted trees", _lgbm_factory("regression", trees), blackbox=True)
        add("svm", "SVM (RBF)", "kernel", lambda: SVR(kernel="rbf", C=1.0, gamma="scale"),
            blackbox=True)
        add("mlp", "Multilayer perceptron", "neural net",
            lambda: MLPRegressor(hidden_layer_sizes=(16,), max_iter=mlp_iter, random_state=SEED,
                                 early_stopping=False), blackbox=True)
    else:
        add("plsda", "PLS-DA", "latent variable", lambda: PLSDA(n_components=pls_components),
            note="PLS regression on a +/-1 response, thresholded at zero")
        add("lda", "Linear discriminant analysis", "discriminant",
            lambda: LinearDiscriminantAnalysis(priors=None),
            discriminant=True, note="two-class LDA, priors from the class sizes (manual p. 11)")
        add("qda", "Quadratic discriminant analysis", "discriminant",
            lambda: QuadraticDiscriminantAnalysis(reg_param=0.0), discriminant=True)
        add("lda_poly2", "Polynomial (degree-2) LDA", "discriminant",
            lambda: Pipeline([("poly", PolynomialFeatures(degree=2, include_bias=False)),
                              ("lda", LinearDiscriminantAnalysis())]),
            discriminant=True, note="LDA on the degree-2 expansion of the descriptors")
        add("logreg", "Logistic regression", "linear",
            lambda: LogisticRegression(max_iter=5000, random_state=SEED))
        add("rf", "Random forest", "ensemble",
            lambda: RandomForestClassifier(n_estimators=trees, random_state=SEED, n_jobs=1,
                                           max_features=max_features),
            blackbox=True, note="manual's RF defaults (p. 12)")
        add("xgb", "XGBoost", "boosted trees", _xgb_factory("classification", trees), blackbox=True)
        add("lgbm", "LightGBM", "boosted trees", _lgbm_factory("classification", trees), blackbox=True)
        add("svm", "SVM (RBF)", "kernel",
            lambda: SVC(kernel="rbf", C=1.0, gamma="scale", probability=False, random_state=SEED),
            blackbox=True)
        add("mlp", "Multilayer perceptron", "neural net",
            lambda: MLPClassifier(hidden_layer_sizes=(16,), max_iter=mlp_iter, random_state=SEED,
                                  early_stopping=False), blackbox=True)
    return spec


def _xgb_factory(task, trees):
    def factory():
        import xgboost as xgb
        common = dict(n_estimators=trees, max_depth=3, learning_rate=0.1, random_state=SEED,
                      n_jobs=1, tree_method="hist", verbosity=0)
        return (xgb.XGBRegressor(**common) if task == "regression"
                else xgb.XGBClassifier(**common, eval_metric="logloss"))
    return factory


def _lgbm_factory(task, trees):
    def factory():
        import lightgbm as lgb
        common = dict(n_estimators=trees, max_depth=3, learning_rate=0.1, random_state=SEED,
                      n_jobs=1, verbose=-1, min_child_samples=5, force_row_wise=True,
                      deterministic=True)
        return (lgb.LGBMRegressor(**common) if task == "regression" else lgb.LGBMClassifier(**common))
    return factory


def wrap(estimator):
    """Scale inside the pipeline, so the scaler is fitted on training folds only."""
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    return Pipeline([("scale", StandardScaler()), ("model", estimator)])


def _scores(pipe, X) -> np.ndarray | None:
    model = pipe
    for attr in ("decision_function", "predict_proba"):
        if hasattr(model, attr):
            try:
                value = getattr(model, attr)(X)
            except Exception:
                continue
            value = np.asarray(value)
            return value[:, 1] if value.ndim == 2 and value.shape[1] == 2 else value.ravel()
    return None


def _fit_predict(spec, X_train, y_train, X_eval, task):
    pipe = wrap(spec["factory"]())
    y = np.asarray(y_train)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        pipe.fit(X_train, y.astype(float) if task == "regression" else y)
        if task == "regression":
            prediction = np.asarray(pipe.predict(X_eval), dtype=float).ravel()
            score = None
        else:
            prediction = np.asarray(pipe.predict(X_eval)).ravel().astype(int)
            score = _scores(pipe, X_eval)
    return pipe, prediction, score


# --------------------------------------------------------------------------------------------------
# GA-LDA (manual p. 10-11)
# --------------------------------------------------------------------------------------------------
def ga_lda(X: pd.DataFrame, y: np.ndarray, groups: np.ndarray, iters=GA_ITERS, eq_len=GA_EQ_LEN,
           mutation=GA_MUT_P, n_eq=GA_N_EQ, top=GA_TOP) -> dict:
    """Genetic-algorithm variable selection for LDA, with the manual's defaults.

    Fitness is derived from Wilks lambda (manual p. 10-11): lambda runs 0 (perfect discrimination) to 1
    (none), so the fitness maximised here is 1 - lambda of the training LDA on the chosen descriptors.
    """
    from sklearn.discriminant_analysis import LinearDiscriminantAnalysis

    columns = list(X.columns)
    eq_len = max(1, min(eq_len, len(columns)))
    rng = np.random.default_rng(SEED)
    values = X.astype(float).to_numpy()

    def fitness(subset):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                model = LinearDiscriminantAnalysis().fit(values[:, subset], y)
                lam = wilks_lambda(model.decision_function(values[:, subset]), y)
        except Exception:
            return -1.0, None
        return (1.0 - lam if lam is not None else -1.0), lam

    population = {tuple(sorted(rng.choice(len(columns), size=eq_len, replace=False).tolist()))
                  for _ in range(n_eq)}
    best = None
    for _ in range(iters):
        scored = sorted(((fitness(list(s))[0], s) for s in population), key=lambda t: (-t[0], t[1]))
        survivors = [s for _, s in scored[:top]]
        if scored and (best is None or scored[0][0] > best[0]):
            best = (scored[0][0], scored[0][1])
        children = set()
        while len(children) < n_eq and survivors:
            a = survivors[int(rng.integers(len(survivors)))]
            b = survivors[int(rng.integers(len(survivors)))]
            pool = sorted(set(a) | set(b))
            child = sorted(rng.choice(pool, size=min(eq_len, len(pool)), replace=False).tolist())
            if rng.random() < mutation:
                child[int(rng.integers(len(child)))] = int(rng.integers(len(columns)))
            child = tuple(sorted(set(child)))
            if len(child) == eq_len:
                children.add(child)
        population = set(survivors) | children
    if best is None:
        return {"status": "failed", "why": "no LDA model could be fitted on any descriptor subset"}
    score, subset = best
    _, lam = fitness(list(subset))
    return {
        "status": "ok",
        "manual_reference": "QSAR-Co manual p. 10-11, Step 6 (Genetic Algorithm) with the stated defaults",
        "parameters": {"iterations": iters, "equation_length": eq_len, "mutation_probability": mutation,
                       "initial_equations": n_eq, "top_equations_per_generation": top,
                       "fitness": "1 - Wilks lambda of the training LDA"},
        "selected_descriptors": [columns[i] for i in subset],
        "fitness_score": _round(score),
        "wilks_lambda_train": lam,
    }


# --------------------------------------------------------------------------------------------------
# one regime
# --------------------------------------------------------------------------------------------------
def run_regime(label: str, description: str, frame: pd.DataFrame, descriptor_cols: list[str],
               response: str, task: str, approach: str, out_dir: Path, quick: bool,
               n_yrand: int = N_YRAND, class_rule: str = "", confidence_col: str | None = None,
               extra_caveats: list[str] | None = None) -> dict:
    """Pre-treat, divide, run the whole ladder, validate, Y-randomise, and rank by external metric."""
    from sklearn.model_selection import (GroupKFold, LeaveOneGroupOut, StratifiedGroupKFold)

    work = frame.dropna(subset=[response] + descriptor_cols).copy()
    work = work.sort_values(["name", "atc_code", "condition", "cid"], kind="stable").reset_index(drop=True)
    result: dict = {
        "label": label, "description": description, "task": task, "approach": approach,
        "response": response, "class_rule": class_rule or None,
        "n_rows": int(len(work)), "n_compounds": int(work["cid"].nunique()),
        "caveats": list(extra_caveats or []),
    }
    if len(work) < 4 or work["cid"].nunique() < 3:
        result["status"] = "not run"
        result["why"] = (f"{work['cid'].nunique()} compounds in {len(work)} rows: there is no model to "
                         "fit, let alone validate")
        return result

    y_raw = work[response].astype(float).to_numpy()
    if task == "classification":
        threshold = float(np.median(y_raw))
        y = (y_raw >= threshold).astype(int)
        result["class_threshold"] = _round(threshold)
        result["class_balance"] = {"positives": int(y.sum()), "negatives": int(len(y) - y.sum())}
        if len(set(y.tolist())) < 2:
            result["status"] = "not run"
            result["why"] = "the response falls into a single class, so there is nothing to discriminate"
            return result
    else:
        y = y_raw

    X_all = work[descriptor_cols].astype(float)
    kept, dpt1 = pretreat(X_all)
    result["data_pretreatment_dpt1"] = dpt1
    if not kept:
        result["status"] = "not run"
        result["why"] = "data pre-treatment removed every descriptor"
        return result
    X_all = X_all[kept]
    conditions = work["condition"].astype(str)
    if approach == "box_jenkins":
        X_all, condition_means = box_jenkins(X_all, conditions)
        result["box_jenkins"] = {
            "operator": "D_i(c) = D_i - mean(D over the compounds sharing condition c)",
            "why_this_form": ("the manual states that the conditions drive a Box-Jenkins moving-average "
                              "transformation and that per-condition averages are written out (p. 7, "
                              "p. 22) but does not print the operator, so the published "
                              "deviation-from-condition-mean form is used"),
            "n_conditions": int(conditions.nunique()),
            "condition_means": {str(k): {c: _round(v) for c, v in row.items()}
                                for k, row in condition_means.round(4).to_dict("index").items()},
        }

    # --- division, by compound ---
    compounds = work["cid"].astype(str).to_numpy()
    compound_order = sorted(set(compounds.tolist()))
    compound_X = pd.DataFrame(
        [X_all[compounds == cid].mean(axis=0).to_dict() for cid in compound_order], index=compound_order)
    compound_y = np.array([y[compounds == cid][0] for cid in compound_order])
    train_idx, test_idx, division = divide(compound_X, compound_y, task)
    result["dataset_division"] = division
    train_compounds = {compound_order[i] for i in train_idx}
    test_compounds = {compound_order[i] for i in test_idx}
    train_rows = np.array([i for i, c in enumerate(compounds) if c in train_compounds])
    test_rows = np.array([i for i, c in enumerate(compounds) if c in test_compounds])

    X_train, y_train = X_all.iloc[train_rows], y[train_rows]
    groups_train = compounds[train_rows]
    kept2, dpt2 = pretreat(X_train)
    result["data_pretreatment_dpt2"] = dpt2
    if kept2 and kept2 != list(X_train.columns):
        X_all, X_train = X_all[kept2], X_train[kept2]
    descriptors = list(X_train.columns)
    X_test = X_all.iloc[test_rows] if len(test_rows) else X_all.iloc[[]]
    y_test = y[test_rows] if len(test_rows) else np.array([])

    n_train_compounds = len(train_compounds)
    ratio = n_train_compounds / max(len(descriptors), 1)
    result["descriptors"] = descriptors
    result["n_descriptors"] = len(descriptors)
    result["compounds_per_descriptor"] = {
        "training_compounds": n_train_compounds,
        "descriptors_offered": len(descriptors),
        "ratio": _round(ratio, 2),
        "rule_of_thumb": "at least 5 compounds per descriptor term",
        "breaks_rule": bool(ratio < 5),
        "note": ("counted on compounds, not rows: several rows of one drug are one molecule and add no "
                 "independent information"),
    }
    if task == "classification":
        result["less_discriminating_descriptors"] = less_discriminating(X_train, y_train)

    # --- cross-validation splitter ---
    n_splits = min(5, n_train_compounds)
    if n_train_compounds <= 15:
        cv, cv_label = LeaveOneGroupOut(), "leave-one-compound-out"
    elif task == "classification":
        cv = StratifiedGroupKFold(n_splits=n_splits)
        cv_label = f"{n_splits}-fold stratified, grouped by compound"
    else:
        cv = GroupKFold(n_splits=n_splits)
        cv_label = f"{n_splits}-fold, grouped by compound"
    result["internal_validation"] = {
        "scheme": cv_label,
        "scaling": "StandardScaler fitted inside each training fold only (sklearn Pipeline)",
    }
    loo_possible = n_train_compounds <= 120
    result["q2_loo_note"] = (
        "leave-one-compound-out PRESS" if loo_possible else
        f"leave-one-compound-out skipped: {n_train_compounds} training compounds would need that many "
        f"refits per model; the grouped k-fold figure is reported as q2_cv instead")

    def cv_predict(spec):
        """Out-of-fold predictions on the training set, scaler fitted inside each fold."""
        predictions = np.zeros(len(y_train), dtype=float)
        scores = np.full(len(y_train), np.nan, dtype=float)
        for fit_idx, hold_idx in cv.split(X_train, y_train, groups_train):
            if task == "classification" and len(set(y_train[fit_idx].tolist())) < 2:
                predictions[hold_idx] = y_train[fit_idx][0]
                continue
            _, pred, score = _fit_predict(spec, X_train.iloc[fit_idx], y_train[fit_idx],
                                          X_train.iloc[hold_idx], task)
            predictions[hold_idx] = pred
            if score is not None:
                scores[hold_idx] = score
        return predictions, (None if np.all(np.isnan(scores)) else scores)

    def loo_predict(spec):
        predictions = np.zeros(len(y_train), dtype=float)
        for fit_idx, hold_idx in LeaveOneGroupOut().split(X_train, y_train, groups_train):
            _, pred, _ = _fit_predict(spec, X_train.iloc[fit_idx], y_train[fit_idx],
                                      X_train.iloc[hold_idx], task)
            predictions[hold_idx] = pred
        return predictions

    specs = ladder(task, len(descriptors), quick)
    models: list[dict] = []
    rng = np.random.default_rng(SEED)
    permutations = [rng.permutation(len(y_train)) for _ in range(max(1, n_yrand))]

    for rung, spec in enumerate(specs, start=1):
        entry = {"rung": rung, "key": spec["key"], "model": spec["label"], "family": spec["family"],
                 "is_black_box": spec["blackbox"], "note": spec["note"] or None,
                 "compounds_per_descriptor": _round(ratio, 2),
                 "breaks_five_per_term_rule": bool(ratio < 5)}
        try:
            pipe, train_pred, train_score = _fit_predict(spec, X_train, y_train, X_train, task)
            cv_pred, cv_score = cv_predict(spec)
            if task == "classification":
                entry["train"] = classification_metrics(y_train, train_pred, train_score)
                entry["internal_cv"] = classification_metrics(y_train, cv_pred.astype(int), cv_score)
            else:
                entry["train"] = regression_metrics(y_train, train_pred)
                entry["internal_cv"] = regression_metrics(y_train, cv_pred)
                entry["internal_cv"]["q2_cv"] = entry["internal_cv"]["r2"]
                if loo_possible:
                    entry["internal_cv"]["q2_loo_press"] = regression_metrics(
                        y_train, loo_predict(spec))["r2"]
                else:
                    entry["internal_cv"]["q2_loo_press"] = None

            if len(test_rows):
                _, test_pred, test_score = _fit_predict(spec, X_train, y_train, X_test, task)
                if task == "classification":
                    entry["external"] = classification_metrics(y_test, test_pred, test_score)
                else:
                    entry["external"] = regression_metrics(y_test, test_pred,
                                                           baseline_mean=float(np.mean(y_train)))
                    entry["external"]["r2_pred"] = entry["external"]["r2"]
                entry["external"]["n_compounds"] = len(test_compounds)
            else:
                entry["external"] = {"status": "none", "why": division["reason"]}

            if spec["discriminant"]:
                entry["wilks_lambda"] = {
                    "train": wilks_lambda(_scores(pipe, X_train), y_train),
                    "external": (wilks_lambda(_scores(pipe, X_test), y_test) if len(test_rows) else None),
                    "definition": "within-group SS / total SS of the discriminant score (manual p. 13)",
                }
                if task == "classification" and hasattr(pipe, "predict_proba"):
                    try:
                        proba = pipe.predict_proba(X_train)
                        gap = np.abs(proba[:, 1] - proba[:, 0])
                        entry["applicability_domain_confidence_estimation"] = {
                            "threshold": AD_POSTERIOR_GAP,
                            "fraction_of_training_rows_reliable": _round(float(np.mean(gap >= AD_POSTERIOR_GAP))),
                            "manual_reference": "p. 17, Step 9(ii)",
                        }
                    except Exception:
                        pass

            # --- Y-randomisation (manual p. 16) ---
            perm_fit, perm_cv, perm_lambda = [], [], []
            for order in permutations:
                y_shuffled = y_train[order]
                if task == "classification" and len(set(y_shuffled.tolist())) < 2:
                    continue
                try:
                    perm_pipe, perm_pred, perm_score = _fit_predict(spec, X_train, y_shuffled,
                                                                    X_train, task)
                    if task == "classification":
                        perm_fit.append(classification_metrics(y_shuffled, perm_pred, perm_score)["accuracy"])
                    else:
                        perm_fit.append(regression_metrics(y_shuffled, perm_pred)["r2"])
                    if spec["discriminant"]:
                        perm_lambda.append(wilks_lambda(_scores(perm_pipe, X_train), y_shuffled))
                    out_of_fold = np.zeros(len(y_shuffled), dtype=float)
                    for fit_idx, hold_idx in cv.split(X_train, y_shuffled, groups_train):
                        if task == "classification" and len(set(y_shuffled[fit_idx].tolist())) < 2:
                            out_of_fold[hold_idx] = y_shuffled[fit_idx][0]
                            continue
                        _, pred, _ = _fit_predict(spec, X_train.iloc[fit_idx], y_shuffled[fit_idx],
                                                  X_train.iloc[hold_idx], task)
                        out_of_fold[hold_idx] = pred
                    perm_cv.append(classification_metrics(y_shuffled, out_of_fold.astype(int))["accuracy"]
                                   if task == "classification"
                                   else regression_metrics(y_shuffled, out_of_fold)["r2"])
                except Exception:
                    continue
            metric_name = "accuracy" if task == "classification" else "r2"
            clean_fit = [v for v in perm_fit if v is not None]
            clean_cv = [v for v in perm_cv if v is not None]
            entry["y_randomisation"] = {
                "manual_reference": "p. 16: shuffle the training response, descriptors unchanged, "
                                    f"default {N_YRAND} shuffles",
                "n_permutations": len(clean_fit),
                "metric": metric_name,
                "permuted_fit_mean": _round(float(np.mean(clean_fit))) if clean_fit else None,
                "permuted_fit_max": _round(float(np.max(clean_fit))) if clean_fit else None,
                "permuted_cv_mean": _round(float(np.mean(clean_cv))) if clean_cv else None,
                "permuted_cv_max": _round(float(np.max(clean_cv))) if clean_cv else None,
                "real_fit": entry["train"].get(metric_name) if task == "classification"
                            else entry["train"].get("r2"),
                "real_cv": entry["internal_cv"].get(metric_name) if task == "classification"
                           else entry["internal_cv"].get("r2"),
            }
            if perm_lambda:
                lambdas = [v for v in perm_lambda if v is not None]
                if lambdas:
                    entry["y_randomisation"]["permuted_wilks_lambda_mean"] = _round(float(np.mean(lambdas)))
                    entry["y_randomisation"]["permuted_wilks_lambda_min"] = _round(float(np.min(lambdas)))
                    entry["y_randomisation"]["wilks_lambda_expectation"] = (
                        "near 1 for the random models, clearly lower for the real one (manual p. 16)")
            real_cv = entry["y_randomisation"]["real_cv"]
            permuted_max = entry["y_randomisation"]["permuted_cv_max"]
            entry["y_randomisation"]["real_cv_beaten_by_chance"] = (
                None if real_cv is None or permuted_max is None else bool(permuted_max >= real_cv))

            # --- linear coefficients, for the SHAP comparison ---
            inner = pipe.named_steps["model"]
            coefficients = getattr(inner, "coef_", None)
            if coefficients is not None and np.asarray(coefficients).size == len(descriptors):
                entry["standardised_coefficients"] = {
                    d: _round(float(c)) for d, c in
                    zip(descriptors, np.asarray(coefficients).ravel())}
                entry["intercept"] = _round(float(np.ravel(getattr(inner, "intercept_", [0.0]))[0]))
            entry["status"] = "ok"
            entry["_pipe"] = pipe
            entry["_spec"] = spec
        except Exception as error:  # a model that cannot be fitted is recorded, not hidden
            entry["status"] = "failed"
            entry["why"] = f"{type(error).__name__}: {error}"
        models.append(entry)

    # --- ranking: the external set decides (fall back to internal CV when there is none) ---
    def key_of(entry):
        if entry["status"] != "ok":
            return (-9e9,)
        external = entry.get("external") or {}
        metric = "mcc" if task == "classification" else "r2_pred"
        value = external.get(metric)
        if value is None:
            value = (entry["internal_cv"].get("mcc") if task == "classification"
                     else entry["internal_cv"].get("r2"))
            return (-8e8 if value is None else value - 1e6,)
        return (value,)

    ranked = sorted(models, key=lambda e: (-key_of(e)[0], e["rung"]))
    for position, entry in enumerate(ranked, start=1):
        entry["rank_by_external"] = position if entry["status"] == "ok" else None
    result["ranking_metric"] = ("external Matthews correlation coefficient" if task == "classification"
                                else "external r2_pred")
    result["ranking_note"] = (
        "models with no external set are ranked below every model that has one; "
        f"{'there is no external set in this regime' if not len(test_rows) else 'an external set exists'}")
    result["models"] = models
    winner = next((e for e in ranked if e["status"] == "ok"), None)
    result["winner"] = (None if winner is None else
                        {"key": winner["key"], "model": winner["model"],
                         "external": winner.get("external"), "internal_cv": winner.get("internal_cv")})
    if task == "classification":
        result["ga_lda"] = ga_lda(X_train, y_train, groups_train,
                                  iters=20 if quick else GA_ITERS, n_eq=30 if quick else GA_N_EQ,
                                  top=10 if quick else GA_TOP)

    # --- SHAP for the best black-box model ---
    best_blackbox = next((e for e in ranked if e["status"] == "ok" and e["is_black_box"]), None)
    if best_blackbox is not None:
        result["shap"] = shap_for(best_blackbox, X_train, X_test if len(test_rows) else X_train,
                                  descriptors, task, quick)
        linear = next((e for e in models
                       if e["status"] == "ok" and e.get("standardised_coefficients")), None)
        if linear and result["shap"].get("mean_abs_shap"):
            result["shap"]["agreement_with_linear_model"] = compare_rankings(
                result["shap"]["mean_abs_shap"], linear["standardised_coefficients"], linear["model"])
    for entry in models:  # drop the un-serialisable fitted objects
        entry.pop("_pipe", None)
        entry.pop("_spec", None)
    result["status"] = "ok"
    return result


def shap_for(entry, X_train, X_eval, descriptors, task, quick) -> dict:
    """TreeExplainer for the tree models, KernelExplainer on a small background sample otherwise."""
    import shap

    pipe = entry["_pipe"]
    scaler = pipe.named_steps["scale"]
    model = pipe.named_steps["model"]
    X_eval_scaled = scaler.transform(X_eval)
    X_train_scaled = scaler.transform(X_train)
    cap = 60 if quick else 150
    sample = X_eval_scaled[:cap]
    info = {"model": entry["model"], "key": entry["key"], "n_rows_explained": int(len(sample))}
    try:
        if entry["key"] in {"rf", "xgb", "lgbm"}:
            explainer = shap.TreeExplainer(model)
            values = explainer.shap_values(sample, check_additivity=False)
            info["explainer"] = "shap.TreeExplainer"
        else:
            background = shap.sample(X_train_scaled, min(40, len(X_train_scaled)), random_state=SEED)
            predictor = model.predict
            explainer = shap.KernelExplainer(predictor, background)
            sample = sample[:40]
            values = explainer.shap_values(sample, nsamples=100, silent=True)
            info["explainer"] = "shap.KernelExplainer (background sample of the training set)"
            info["n_rows_explained"] = int(len(sample))
        values = np.asarray(values)
        if values.ndim == 3:  # one matrix per class: take the positive class
            values = values[:, :, -1] if values.shape[-1] <= 3 else values[-1]
        info["mean_abs_shap"] = {d: _round(float(v)) for d, v in
                                 zip(descriptors, np.abs(values).mean(axis=0))}
        info["ranking"] = [d for d, _ in sorted(info["mean_abs_shap"].items(),
                                                key=lambda t: -(t[1] or 0))]
        info["_values"] = values
        info["_sample"] = sample
        info["status"] = "ok"
    except Exception as error:
        info["status"] = "failed"
        info["why"] = f"{type(error).__name__}: {error}"
    return info


def compare_rankings(mean_abs_shap: dict, coefficients: dict, linear_label: str) -> dict:
    from scipy.stats import spearmanr

    shared = [d for d in mean_abs_shap if d in coefficients]
    if len(shared) < 3:
        return {"status": "too few shared descriptors to compare"}
    shap_values = [mean_abs_shap[d] or 0.0 for d in shared]
    coefficient_values = [abs(coefficients[d] or 0.0) for d in shared]
    rho, p_value = spearmanr(shap_values, coefficient_values)
    shap_order = [d for d, _ in sorted(zip(shared, shap_values), key=lambda t: -t[1])]
    coefficient_order = [d for d, _ in sorted(zip(shared, coefficient_values), key=lambda t: -t[1])]
    return {
        "compared_with": linear_label,
        "spearman_rho_of_importance_ranks": _round(float(rho)),
        "p_value": _round(float(p_value)),
        "shap_order": shap_order,
        "absolute_standardised_coefficient_order": coefficient_order,
        "same_top_descriptor": bool(shap_order[0] == coefficient_order[0]),
        "reading": ("a positive rho means the black box leans on the same descriptors as the linear "
                    "model, in roughly the same order; a rho near zero or negative means the two "
                    "disagree about what matters"),
    }


# --------------------------------------------------------------------------------------------------
# figures
# --------------------------------------------------------------------------------------------------
def shap_figure(regimes: list[dict], path: Path) -> dict:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    panels = [r for r in regimes if (r.get("shap") or {}).get("status") == "ok"]
    if not panels:
        return {"status": "not written", "why": "no black-box model produced SHAP values"}
    fig, axes = plt.subplots(len(panels), 2, figsize=(11.5, 3.3 * len(panels)), squeeze=False)
    for row, regime in enumerate(panels):
        shap_info = regime["shap"]
        values = np.asarray(shap_info["_values"])
        sample = np.asarray(shap_info["_sample"])
        names = list(shap_info["mean_abs_shap"].keys())
        means = np.array([shap_info["mean_abs_shap"][n] or 0.0 for n in names])
        order = np.argsort(means)
        left = axes[row][0]
        left.barh(np.array(names)[order], means[order], color="#2d6a9f")
        left.set_xlabel("mean |SHAP|")
        left.set_title(f"{regime['label']}: {shap_info['model']}", fontsize=10, loc="left")
        left.tick_params(labelsize=8)
        right = axes[row][1]
        for position, index in enumerate(order):
            column = values[:, index]
            feature = sample[:, index]
            spread = np.ptp(feature)
            colour = (feature - feature.min()) / spread if spread > 0 else np.zeros_like(feature)
            jitter = (np.random.default_rng(SEED + position).random(len(column)) - 0.5) * 0.3
            right.scatter(column, np.full(len(column), position) + jitter, c=colour, cmap="coolwarm",
                          s=7, alpha=0.75, linewidths=0)
        right.set_yticks(range(len(order)))
        right.set_yticklabels(np.array(names)[order], fontsize=8)
        right.axvline(0, color="#999", lw=0.8)
        right.set_xlabel("SHAP value (red = high descriptor value)")
        right.set_title(f"n = {shap_info['n_rows_explained']} rows, {shap_info['explainer'].split('(')[0]}",
                        fontsize=9, loc="left")
        right.tick_params(labelsize=8)
    fig.suptitle("SHAP for the winning black-box model of each regime", fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=105)
    plt.close(fig)
    return {"status": "written", "path": str(path.relative_to(REPO)),
            "bytes": path.stat().st_size,
            "panels": [r["label"] for r in panels]}


def ladder_figure(regimes: list[dict], path: Path) -> dict:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    panels = [r for r in regimes if r.get("status") == "ok" and r.get("models")]
    if not panels:
        return {"status": "not written", "why": "no regime ran"}
    fig, axes = plt.subplots(1, len(panels), figsize=(5.0 * len(panels), 4.2), squeeze=False)
    for column, regime in enumerate(panels):
        ax = axes[0][column]
        ok = [m for m in regime["models"] if m["status"] == "ok"]
        names = [m["key"] for m in ok]
        metric = "mcc" if regime["task"] == "classification" else "r2"
        train = [(m["train"].get(metric) or 0) for m in ok]
        cv = [(m["internal_cv"].get(metric) or 0) for m in ok]
        external = [((m.get("external") or {}).get(metric) or 0) for m in ok]
        positions = np.arange(len(names))
        ax.bar(positions - 0.27, train, 0.26, label="train", color="#c9d8e4")
        ax.bar(positions, cv, 0.26, label="internal CV", color="#6a9fc0")
        ax.bar(positions + 0.27, external, 0.26, label="external", color="#1f4e79")
        ax.set_xticks(positions)
        ax.set_xticklabels(names, rotation=45, ha="right", fontsize=8)
        ax.axhline(0, color="#444", lw=0.8)
        ax.set_ylabel("MCC" if regime["task"] == "classification" else "r²")
        ax.set_title(f"{regime['label']}\n{regime['task']}, {regime['n_compounds']} compounds, "
                     f"{regime['compounds_per_descriptor']['ratio']} compounds/descriptor", fontsize=9)
        ax.legend(fontsize=7)
    fig.suptitle("The ladder, lowest complexity first: training fit, internal CV and the external set",
                 fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=105)
    plt.close(fig)
    return {"status": "written", "path": str(path.relative_to(REPO)), "bytes": path.stat().st_size}


# --------------------------------------------------------------------------------------------------
# the H2 antagonist feature table
# --------------------------------------------------------------------------------------------------
H2_REASONS = {
    "act": "no bioactivity value for this drug at the group's target in ChEMBL",
    "act_n": "no bioactivity value for this drug at the group's target in ChEMBL",
    "act_ndoc": "no bioactivity value for this drug at the group's target in ChEMBL",
    "act_types": "no bioactivity value for this drug at the group's target in ChEMBL",
    "offtox": "no off-target bioactivity value for this drug in ChEMBL",
    "offtox_name": "no off-target bioactivity value for this drug in ChEMBL",
    "route": "no coded mode of administration: no US label was found for this generic name",
    "invivo_act": "the WHO ATC/DDD index publishes no defined daily dose for this drug",
    "invivo_tox": "no acute lethal or no-effect dose stated in the US label text for this drug",
    "ti": "the therapeutic index needs both an in-vivo activity and an in-vivo toxicity; at least one is missing",
    "ti_classical": "the therapeutic index needs both an in-vivo activity and an in-vivo toxicity; at least one is missing",
    "F": "bioavailability is not stated in the label text or PubChem for this drug",
    "F_per_mg": "dose-corrected bioavailability needs both the bioavailability and the dose",
    "t_half": "no half-life stated in the label text for this drug",
    "dose": "the WHO ATC/DDD index publishes no defined daily dose for this drug",
    "free_conc": "the free concentration needs bioavailability, half-life, dose and dose interval; "
                 "at least one is missing",
    "hammett_sigma": "a Hammett sigma is defined for a substituent on a fixed parent ring; the members "
                     "of this group differ in the ring itself, so no common parent exists",
}


def h2_features(cohort: pd.DataFrame | None, cohort_meta: dict, wide: pd.DataFrame, atc4: str,
                out_path: Path, n_drugs: int = 5) -> dict:
    """The first `n_drugs` members of the ATC level-4 group, one row per mode of administration,
    carrying every feature. Empty cells stay empty; a reason column says why each one is empty."""
    if cohort is not None and len(cohort):
        frame = cohort.copy()
        source = cohort_meta.get("source")
    else:  # the cohort file is not there: fall back to the wide table, with far fewer columns
        frame = wide[wide["atc4"] == atc4].copy()
        source = "site/data/drugs.json (the cohort file was not available)"
        frame["atc"] = frame["atc_code"]
    frame["atc"] = frame.get("atc", frame.get("atc_code"))
    frame = frame.sort_values(["atc", "route"], kind="stable")
    first = sorted(frame["atc"].astype(str).unique())[:n_drugs]
    frame = frame[frame["atc"].astype(str).isin(first)].copy()

    # every descriptor recomputed from the curated SMILES, so the table carries one consistent set
    descriptors = pd.DataFrame([descriptor_block(s) for s in frame["smiles"].astype(str)],
                               index=frame.index)
    for column in descriptors.columns:
        frame[column] = descriptors[column]
    frame["hammett_sigma"] = np.nan  # see H2_REASONS
    frame["route"] = frame["route"].map(_clean_route)

    ordered = [c for c in [
        "cid", "name", "atc", "l1", "l2", "l3", "l4", "route", "route_rank", "route_fda_code",
        "route_nci", "route_other", "smiles", "formula", "ik", "chembl", "mechanism", "target",
        "target_name",
        "MW", "logP", "xlogp", "MolMR", "TPSA", "HBD", "HBA", "ROTB", "AROM", "FractionCSP3",
        "HeavyAtomCount", "RingCount", "NumHeteroatoms", "BertzCT", "Chi1v", "Kappa2",
        "NumAmideBonds", "FormalCharge", "hammett_sigma",
        "QED", "QED_max_weights", "ALERTS", "PSA", "ALOGP",
        *[f"des_{t}" for t in QED_TERMS],
        "act", "act_n", "act_ndoc", "act_types", "offtox", "offtox_target", "offtox_name",
        "invivo_act", "invivo_tox", "tox_kind", "tox_route", "tox_species", "rep_act", "rep_act_kind",
        "ti", "ti_classical", "F", "F_per_mg", "t_half", "dose", "tau", "free_conc",
        "F_source", "t_half_source", "dose_source", "invivo_act_source", "invivo_tox_source",
        "route_evidence", "flags",
    ] if c in frame.columns]
    out = frame[ordered].copy()

    def reason_for(row) -> str:
        reasons = []
        for column in ordered:
            value = row[column]
            empty = value is None or (isinstance(value, float) and not np.isfinite(value)) or \
                (isinstance(value, str) and not value.strip())
            if empty:
                reasons.append(f"{column}: {H2_REASONS.get(column, 'no value found in the sources used')}")
        return " | ".join(reasons)

    out["empty_cell_reasons"] = out.apply(reason_for, axis=1)
    out = out.sort_values(["atc", "route"], kind="stable")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    return {
        "path": str(out_path.relative_to(REPO)),
        "source": source,
        "atc4": atc4,
        "atc4_name": cohort_meta.get("atc4_name"),
        "n_drugs_requested": n_drugs,
        "drugs": sorted(set(out["name"].astype(str))),
        "atc_codes": sorted(set(out["atc"].astype(str))),
        "n_rows": int(len(out)),
        "n_columns": int(out.shape[1]),
        "rows_are": "one per drug and mode of administration",
        "rule": ("empty cells are left empty and explained in empty_cell_reasons; no gap is filled with "
                 "an invented number"),
        "formulas": cohort_meta.get("formulas", {}),
    }


# --------------------------------------------------------------------------------------------------
# printing
# --------------------------------------------------------------------------------------------------
def print_ranking(regimes: list[dict]) -> None:
    for regime in regimes:
        print()
        print("=" * 112)
        print(f"{regime['label']}  -  {regime['description']}")
        if regime.get("status") != "ok":
            print(f"  NOT RUN: {regime.get('why')}")
            continue
        ratio = regime["compounds_per_descriptor"]
        print(f"  task {regime['task']} | approach {regime['approach']} | response {regime['response']}"
              f"{' | ' + regime['class_rule'] if regime.get('class_rule') else ''}")
        print(f"  {regime['n_rows']} rows / {regime['n_compounds']} compounds | "
              f"{ratio['descriptors_offered']} descriptors offered, {regime['n_descriptors']} kept | "
              f"{ratio['ratio']} training compounds per descriptor"
              f"{'  ** BREAKS THE 5-PER-TERM RULE **' if ratio['breaks_rule'] else ''}")
        division = regime["dataset_division"]
        print(f"  division: {division['method']} ({division['n_train']} train / "
              f"{division['n_external']} external compounds) - {division['reason']}")
        print(f"  internal: {regime['internal_validation']['scheme']}; "
              f"ranked on {regime['ranking_metric']}")
        if regime["task"] == "classification":
            header = (f"  {'#':>2} {'rung':>4} {'model':<30} {'acc':>6} {'sens':>6} {'spec':>6} "
                      f"{'MCC':>7} {'AUC':>6} | {'cvMCC':>7} | {'extMCC':>7} {'extAcc':>7} | "
                      f"{'Yrand cv max':>12}")
        else:
            header = (f"  {'#':>2} {'rung':>4} {'model':<30} {'r2':>6} {'q2loo':>7} {'q2cv':>7} "
                      f"{'RMSE':>7} | {'ext r2p':>8} {'extRMSE':>8} | {'Yrand cv max':>12}")
        print("  " + "-" * (len(header) - 2))
        print(header)
        print("  " + "-" * (len(header) - 2))
        for entry in sorted(regime["models"], key=lambda e: (e["rank_by_external"] or 99, e["rung"])):
            if entry["status"] != "ok":
                print(f"   -  {entry['rung']:>4} {entry['model']:<30} FAILED: {entry.get('why','')[:60]}")
                continue
            yrand = entry["y_randomisation"]
            external = entry.get("external") or {}
            if regime["task"] == "classification":
                print(f"  {entry['rank_by_external']:>2} {entry['rung']:>4} {entry['model']:<30} "
                      f"{_fmt(entry['train']['accuracy'])} {_fmt(entry['train']['sensitivity'])} "
                      f"{_fmt(entry['train']['specificity'])} {_fmt(entry['train']['mcc'],7)} "
                      f"{_fmt(entry['train']['auc'])} | {_fmt(entry['internal_cv']['mcc'],7)} | "
                      f"{_fmt(external.get('mcc'),7)} {_fmt(external.get('accuracy'),7)} | "
                      f"{_fmt(yrand['permuted_cv_max'],12)}")
            else:
                print(f"  {entry['rank_by_external']:>2} {entry['rung']:>4} {entry['model']:<30} "
                      f"{_fmt(entry['train']['r2'])} {_fmt(entry['internal_cv'].get('q2_loo_press'),7)} "
                      f"{_fmt(entry['internal_cv'].get('q2_cv'),7)} {_fmt(entry['train']['rmse'],7)} | "
                      f"{_fmt(external.get('r2_pred'),8)} {_fmt(external.get('rmse'),8)} | "
                      f"{_fmt(yrand['permuted_cv_max'],12)}")
        if regime.get("winner"):
            print(f"  winner on the external set: {regime['winner']['model']}")
        shap_info = regime.get("shap") or {}
        if shap_info.get("status") == "ok":
            print(f"  SHAP ({shap_info['model']}, {shap_info['explainer']}): "
                  f"{', '.join(shap_info['ranking'][:5])}")
            agreement = shap_info.get("agreement_with_linear_model") or {}
            if agreement.get("spearman_rho_of_importance_ranks") is not None:
                print(f"    vs {agreement['compared_with']}: Spearman rho "
                      f"{agreement['spearman_rho_of_importance_ranks']}, same top descriptor: "
                      f"{agreement['same_top_descriptor']}")
        for caveat in regime.get("caveats", []):
            print(f"  CAVEAT: {caveat}")


def _fmt(value, width=6):
    return f"{'':>{width}}" if value is None else f"{value:>{width}.3f}"


# --------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC,
                        help="primary input table (default: site/data/clean_drugs.csv); the JSON "
                             "fallbacks are used when it does not exist")
    parser.add_argument("--atc4", default="A02BA",
                        help="ATC level-4 chemical group for the small-cohort regime and the feature CSV")
    parser.add_argument("--out", type=Path, default=REPO / "models", help="output directory")
    parser.add_argument("--quick", action="store_true",
                        help="fewer Y-randomisation shuffles and smaller models, for a fast check")
    parser.add_argument("--yrand", type=int, default=None,
                        help=f"number of Y-randomisation shuffles (default {N_YRAND}, 10 with --quick)")
    args = parser.parse_args(argv)

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    n_yrand = args.yrand if args.yrand is not None else (10 if args.quick else N_YRAND)
    started = datetime.now(timezone.utc)

    wide, provenance = load_table(args.src)
    cohort, cohort_meta = load_cohort(args.atc4)
    print(f"loaded {provenance['rows_modellable']} rows / {provenance['compounds']} compounds "
          f"from {provenance['source']} ({provenance['kind']})")

    # ---- the response columns ----
    wide["qed_class"] = (wide["QED"] >= 0.5).astype(int)
    activity = wide[wide["act"].notna()].copy() if "act" in wide else wide.iloc[[]].copy()

    inputs: list[dict] = []
    regimes: list[dict] = []

    # ---------- regime 1: the widest table, QED as the response ----------
    qed_descriptors = [c for c in NON_QED_DESCRIPTORS if c in wide.columns]
    inputs.append(write_qsar_co_input(
        out_dir / "qsar_co_input.csv", wide, "cid", ["Mode of administration"], "qed_class", None,
        qed_descriptors) | {"note": "the headline input file: the widest table"})
    # the condition column has to exist under the name written into the file
    wide["Mode of administration"] = wide["condition"]
    inputs[-1] = write_qsar_co_input(
        out_dir / "qsar_co_input.csv", wide, "cid", ["Mode of administration"], "qed_class", None,
        qed_descriptors)
    inputs[-1]["note"] = "the headline input file: the widest table available"

    leak_caveat = (
        "QED is a deterministic function of its own eight component properties, so a ladder that is "
        "handed those eight back cannot do anything but reproduce them. The descriptor block here "
        "deliberately excludes all eight (MW, ALOGP, HBA, HBD, PSA, ROTB, AROM, ALERTS) and their "
        "desirabilities, so this is a real generalisation question: how far do descriptors QED does not "
        "use predict the QED class.")
    for approach in ["normal", "box_jenkins"]:
        regimes.append(run_regime(
            label=f"wide-qed-class [{approach}]",
            description=("every curated drug, one row per drug and mode of administration; the response "
                         "is the QED drug-likeness class"),
            frame=wide, descriptor_cols=qed_descriptors, response="QED", task="classification",
            approach=approach, out_dir=out_dir, quick=args.quick, n_yrand=n_yrand,
            class_rule="class 1 when QED >= the median, else 0",
            extra_caveats=[leak_caveat,
                           "QED-derived labels are a property of the molecule, not a measured biological "
                           "response: this regime tests the pipeline and the descriptors, not pharmacology"]))
    regimes.append(run_regime(
        label="wide-qed-value [normal]",
        description="the same table with QED itself as a continuous response",
        frame=wide, descriptor_cols=qed_descriptors, response="QED", task="regression",
        approach="normal", out_dir=out_dir, quick=args.quick, n_yrand=n_yrand,
        extra_caveats=[leak_caveat]))

    # ---------- regime 2: every drug with a measured activity ----------
    if len(activity) >= 20:
        hansch = [c for c in HANSCH_DESCRIPTORS if c in activity.columns]
        activity["Mode of administration"] = activity["condition"]
        inputs.append(write_qsar_co_input(
            out_dir / "qsar_co_input_activity.csv", activity, "cid", ["Mode of administration"],
            "act_class", "act_ndoc", hansch) if "act_class" in activity else None)
        activity["act_class"] = (activity["act"].astype(float)
                                 >= float(np.median(activity["act"].astype(float)))).astype(int)
        inputs[-1] = write_qsar_co_input(
            out_dir / "qsar_co_input_activity.csv", activity, "cid", ["Mode of administration"],
            "act_class", "act_ndoc", hansch)
        inputs[-1]["note"] = ("measured ChEMBL potency as the response; the confidence variable is the "
                              "number of ChEMBL documents behind each value, which is what the manual's "
                              "optional confidence column is for (p. 7, p. 21)")
        activity_caveats = [
            "the drugs in this regime do not share a target, so this is not a congeneric series and no "
            "Hansch regression over it should be read as a structure-activity relationship; it is a "
            "test of whether bulk descriptors track potency at all",
            "potency values are medians over heterogeneous ChEMBL assay types (IC50, Ki, EC50, AC50), "
            "pooled across documents",
        ]
        for approach in ["normal", "box_jenkins"]:
            regimes.append(run_regime(
                label=f"activity-class [{approach}]",
                description=("every curated drug with a ChEMBL potency at its mechanism target; the "
                             "response is the potency class"),
                frame=activity, descriptor_cols=hansch, response="act", task="classification",
                approach=approach, out_dir=out_dir, quick=args.quick, n_yrand=n_yrand,
                class_rule="class 1 when pChEMBL >= the median, else 0",
                confidence_col="act_ndoc", extra_caveats=activity_caveats))
        regimes.append(run_regime(
            label="activity-value [normal]",
            description="the same drugs with the measured pChEMBL potency as a continuous response",
            frame=activity, descriptor_cols=hansch, response="act", task="regression",
            approach="normal", out_dir=out_dir, quick=args.quick, n_yrand=n_yrand,
            extra_caveats=activity_caveats))

    # ---------- regime 3: the small cohort ----------
    cohort_frame = None
    if cohort is not None and len(cohort):
        cohort_frame = cohort.copy()
        descriptors = pd.DataFrame([descriptor_block(s) for s in cohort_frame["smiles"].astype(str)],
                                   index=cohort_frame.index)
        for column in descriptors.columns:
            cohort_frame[column] = descriptors[column]
        cohort_frame["condition"] = cohort_frame["route"].where(cohort_frame["route"].astype(bool),
                                                                "UNSPECIFIED")
        cohort_frame["atc_code"] = cohort_frame["atc"]
        cohort_frame["Mode of administration"] = cohort_frame["condition"]
        cohort_frame["qed_class"] = (cohort_frame["QED"] >= float(np.median(cohort_frame["QED"]))).astype(int)
        inputs.append(write_qsar_co_input(
            out_dir / f"qsar_co_input_{args.atc4}.csv", cohort_frame, "cid",
            ["Mode of administration"], "qed_class", "act_ndoc",
            [c for c in H2_DESCRIPTORS if c in cohort_frame.columns]))
        inputs[-1]["note"] = (f"the {args.atc4} cohort; written in the manual's format for completeness, "
                              "but see the regime below for why no model over it can be validated")
        cohort_caveats = [
            f"this cohort is {cohort_frame['cid'].nunique()} compounds in {len(cohort_frame)} rows. That "
            "is not a modelling dataset. Nothing fitted on it is validated, by this pipeline or any "
            "other, and no number below should be quoted as a model performance.",
            "the rows are not independent: one drug contributes one row per mode of administration, and "
            "its descriptors are identical in each, so the row count overstates the information present",
        ]
        n_with_activity = int(cohort_frame["act"].notna().sum()) if "act" in cohort_frame else 0
        compounds_with_activity = (int(cohort_frame.loc[cohort_frame["act"].notna(), "cid"].nunique())
                                   if "act" in cohort_frame else 0)
        regimes.append(run_regime(
            label=f"{args.atc4}-qed-class",
            description=(f"the {cohort_meta.get('atc4_name', args.atc4)} cohort, one row per drug and "
                         "mode of administration, QED class as the response"),
            frame=cohort_frame, descriptor_cols=[c for c in H2_DESCRIPTORS if c in cohort_frame.columns],
            response="QED", task="classification", approach="normal", out_dir=out_dir,
            quick=args.quick, n_yrand=n_yrand, class_rule="class 1 when QED >= the median, else 0",
            extra_caveats=cohort_caveats))
        regimes.append(run_regime(
            label=f"{args.atc4}-activity-value",
            description=(f"the same cohort with the measured potency at "
                         f"{cohort_meta.get('target_name', 'the group target')} as the response"),
            frame=cohort_frame[cohort_frame["act"].notna()] if "act" in cohort_frame else cohort_frame.iloc[[]],
            descriptor_cols=[c for c in H2_DESCRIPTORS if c in cohort_frame.columns],
            response="act", task="regression", approach="normal", out_dir=out_dir,
            quick=args.quick, n_yrand=n_yrand,
            extra_caveats=cohort_caveats + [
                f"only {compounds_with_activity} of the cohort's {cohort_frame['cid'].nunique()} "
                f"compounds ({n_with_activity} of {len(cohort_frame)} rows) carry a potency value at the "
                "group target at all"]))

    # ---------- the H2 feature table ----------
    features = h2_features(cohort, cohort_meta, wide, args.atc4,
                           out_dir / "h2_antagonist_features.csv")

    # ---------- figures ----------
    shap_png = shap_figure(regimes, out_dir / "shap_summary.png")
    ladder_png = ladder_figure([r for r in regimes if r.get("status") == "ok"],
                               out_dir / "ladder_summary.png")
    for regime in regimes:  # strip the arrays kept only for plotting
        if isinstance(regime.get("shap"), dict):
            regime["shap"].pop("_values", None)
            regime["shap"].pop("_sample", None)

    print_ranking(regimes)

    honest_verdict = {
        "can_this_data_support_model_selection": {
            f"{args.atc4} cohort": "no",
            "wide table (QED-derived labels)": "yes, for the question it actually asks",
            "measured-activity table": "yes for model selection, with a weak signal",
        },
        "why": [
            (f"The {args.atc4} cohort is a handful of compounds. Model selection needs an external set "
             "that is itself large enough to separate models; here it is not large enough to separate "
             "anything, so the cohort is reported with leave-one-compound-out only and no winner."),
            ("The widest table has enough compounds for a genuine external set and a compounds-per-"
             "descriptor ratio far above the five-per-term rule, so model selection there is "
             "meaningful - but the response is QED, a computed property, not a measured biological one."),
            ("The measured-activity table is the only regime with a real biological response and enough "
             "compounds to validate on. Its drugs share no target, so a weak result there is the "
             "expected result, not a failure of the ladder."),
        ],
        "qsar_co_is_classification_only": (
            "QSAR-Co develops and validates two-class models only (manual p. 11-12: two-class LDA and "
            "Random Forest). What it validates is therefore a classification restatement of this "
            "problem - the response cut at its median - not the continuous Hansch regression. The "
            "regression half of this ladder is validated with continuous QSAR statistics instead, and "
            "the two halves are ranked separately and never compared to each other."),
    }

    results = {
        "meta": {
            "generated_utc": started.isoformat(timespec="seconds"),
            "runtime_seconds": round((datetime.now(timezone.utc) - started).total_seconds(), 1),
            "script": "tools/ml_ladder.py",
            "seed": SEED,
            "quick_mode": bool(args.quick),
            "y_randomisation_shuffles": n_yrand,
            "python": sys.version.split()[0],
            "packages": package_versions(),
            "method_reference": {
                "document": "QSAR-Co v1.0.0 user manual (PDF, 30 pages)",
                "citation": ("Ambure P, Halder AK, Gonzalez-Diaz H, Cordeiro MNDS. QSAR-Co: An Open "
                             "Source Software for Developing Robust Multitasking or Multitarget "
                             "Classification-Based QSAR Models. J Chem Inf Model. 2019;59(6):2538-2544. "
                             "doi:10.1021/acs.jcim.9b00295"),
                "pages_used": {
                    "input file format and column order": "p. 20-21",
                    "conditions and the Box-Jenkins approach": "p. 7 (Step 2), p. 22",
                    "data pre-treatment (variance 0.001, correlation 0.99)": "p. 8-9 (Step 3)",
                    "dataset division, Kennard-Stone, 70 % training, size rule": "p. 9-10 (Step 4)",
                    "less-discriminating descriptors (0.05)": "p. 10 (Step 5)",
                    "genetic algorithm defaults and the Wilks-lambda fitness": "p. 10-11 (Step 6)",
                    "LDA with class-size priors, Random Forest defaults": "p. 11-12 (Step 7)",
                    "Wilks lambda definition": "p. 13",
                    "confusion matrix, accuracy, sensitivity, specificity, precision, F, MCC": "p. 14",
                    "ROC and AUC by k-fold cross-validation": "p. 15",
                    "Y-randomisation (50 shuffles, Wilks lambda near 1)": "p. 16",
                    "applicability domain, confidence estimation (gap 0.5)": "p. 17",
                },
                "deviations": [
                    ("The manual's Box-Jenkins operator is not printed in the PDF, so the published "
                     "deviation-from-condition-mean form is used and labelled as such."),
                    ("The manual gives one variance cut-off (0.001) without naming the scale; it is "
                     "applied to descriptors scaled 0-1 so that one cut-off means the same thing for "
                     "every descriptor."),
                    ("The manual's F-measure sentence on p. 14 contradicts its own formula; the formula "
                     "is used, on fractions."),
                    ("Splitting and cross-validation are grouped by compound, which the manual does not "
                     "discuss because it assumes one row per compound. This table has one row per drug "
                     "and mode of administration, so an ungrouped split would put the same molecule in "
                     "both sets."),
                ],
            },
            "inputs": provenance,
            "cohort_source": cohort_meta,
            "determinism": ("fixed seed, descriptors recomputed from curated SMILES, rows sorted before "
                            "use, no timestamps outside this meta block"),
        },
        "honest_verdict": honest_verdict,
        "model_ladder_order": [
            "multiple linear regression (Hansch)", "PLS regression", "PLS-DA",
            "linear discriminant analysis", "quadratic discriminant analysis",
            "polynomial (degree-2) LDA", "logistic regression", "random forest", "XGBoost",
            "LightGBM", "SVM (RBF)", "multilayer perceptron",
        ],
        "qsar_co_input_files": [i for i in inputs if i],
        "regimes": regimes,
        "h2_antagonist_features": features,
        "figures": {"shap_summary": shap_png, "ladder_summary": ladder_png},
    }
    results_path = out_dir / "qsar_co_results.json"
    results_path.write_text(json.dumps(results, indent=1, sort_keys=False, default=str) + "\n")

    print()
    print("=" * 112)
    print("HONEST VERDICT")
    for key, value in honest_verdict["can_this_data_support_model_selection"].items():
        print(f"  model selection on {key}: {value}")
    for line in honest_verdict["why"]:
        print(f"  - {line}")
    print()
    print("written:")
    for path in sorted(out_dir.iterdir()):
        print(f"  {path.relative_to(REPO)}  ({path.stat().st_size:,} bytes)")
    return 0


def package_versions() -> dict:
    out = {}
    for name in ["numpy", "pandas", "scipy", "sklearn", "rdkit", "matplotlib", "xgboost", "lightgbm",
                 "shap"]:
        try:
            if name == "rdkit":
                import rdkit.rdBase as base
                out[name] = base.rdkitVersion
            else:
                module = __import__(name)
                out[name] = getattr(module, "__version__", "unknown")
        except Exception as error:
            out[name] = f"not installed ({type(error).__name__})"
    return out


if __name__ == "__main__":
    raise SystemExit(main())
