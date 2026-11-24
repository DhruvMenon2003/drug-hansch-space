"""
===============================================================================
 QSAR WORKFLOW FOR LOG THERAPEUTIC INDEX, STRUCTURED BY THE FIVE OECD PRINCIPLES
===============================================================================

 Paste this whole file into ONE Google Colab cell and run it. It installs what it
 needs, reads your workbook, and runs end to end without edits.

 WHAT "OECD-COMPLIANT" MEANS HERE
 --------------------------------
 The five principles for the validation of (Q)SAR models were agreed by the OECD
 member countries in November 2004 (the "Setubal principles", adopted at the 37th
 Joint Meeting) and are set out in:

   OECD (2007), "Guidance Document on the Validation of (Quantitative)
   Structure-Activity Relationship [(Q)SAR] Models", OECD Series on Testing and
   Assessment No. 69, ENV/JM/MONO(2007)2.
   Find it by that document number on the OECD iLibrary. The document number is
   the thing to cite; no landing-page URL is asserted here because it moves.

 A valid model should be associated with:
   1. a defined endpoint
   2. an unambiguous algorithm
   3. a defined domain of applicability
   4. appropriate measures of goodness-of-fit, robustness and predictivity
   5. a mechanistic interpretation, if possible

 Every section below is labelled with the principle it satisfies, in the same
 order and with the same numbering as the flowchart in your deck (the recurring
 figure identified as Fig. 2.4 of Roy, Kar & Das, "A Primer on QSAR/QSPR
 Modeling", Springer 2015).

 The acceptance thresholds printed by section 7 are the ones written on your own
 flowchart:
   internal:  Q2 > 0.5,  avg rm2(LOO)  > 0.5,  delta rm2(LOO)  < 0.2,  cRp2 > 0.5
   external:  R2pred > 0.5, avg rm2(test) > 0.5, delta rm2(test) < 0.2
 plus the concordance correlation coefficient of
   Chirico N, Gramatica P. J Chem Inf Model. 2011;51(9):2320-35  (CCC > 0.85)

 THREE ENDPOINTS, ONE AT A TIME
 ------------------------------
 CONFIG["DATASET"] picks which:

   "schulz_plasma"    the best populated, and the one to try first:
                      log10(toxic mg/L / therapeutic mg/L) from a compilation
                      of therapeutic and toxic PLASMA CONCENTRATIONS. 949 rows,
                      928 with a structure, 421 with both a structure and an
                      index, 402 of those organic. Units mg/L, not mg: this
                      cannot be converted to or compared with a dose.

   "leaderboard"      the clinical endpoint from your own workbook:
                      log10(Minimum Toxic Level mg / Minimum Therapeutic Level
                      mg), single dose, healthy subjects, oral or IV.
                      19 molecules carry it, out of 1,373 rows.

   "curated_invitro"  the in vitro endpoint from the project's curated file:
                      log10(off-target nM / on-target nM), one congeneric
                      series. 282 molecules carry it, and the file already
                      fixes the split (234 training, 75 external), which the
                      script uses as given rather than re-making.

 All three share a name and nothing else: a ratio of clinical doses in mg, a
 ratio of plasma concentrations in mg/L, and a ratio of in vitro potencies in
 nM. The script runs ONE at a time, names every output file after the dataset,
 and prints the endpoint and its units above the ranked table, so no number
 from one can be mistaken for a number from another. NEVER pool them, and
 never validate one against another.

 HONEST WARNING ABOUT THE CLINICAL ENDPOINT, READ THIS FIRST
 -----------------------------------------------------------
 In Drug-Leaderboard-v3-live-summary-fixed.xlsx, sheet "Drug Leaderboard",
 1,373 drugs are listed but only 19 carry a Log Therapeutic Index. 1,074 carry a
 SMILES string. So the modelling set is n = 19 and the ranking set is ~1,055.
 n = 19 is far below what any of the statistics below need to mean anything.
 The script therefore:
   * counts and prints n before it trains anything,
   * REFUSES to train if n or the number of scaffold groups is under the floor
     set in CONFIG (set ALLOW_UNDERPOWERED = False to enforce the refusal),
   * when it does run underpowered, stamps every single number "INDICATIVE",
   * never invents, imputes or back-fills an endpoint value.
 Fill in more Minimum Therapeutic Level / Minimum Toxic Level pairs and the same
 script becomes meaningful with no change.

 SHAPE OF THE SCRIPT
 -------------------
 It follows the two notebooks you gave as examples, by Dr Ashfaq Ahmad
 (CADD_Project, Part 14 "QSAR Modeling - Descriptors Generations" and Part 15
 "QSAR Model Generation and Testing"): the same four named descriptor families,
 the same merged master descriptor file, the same five-model comparison with
 GridSearchCV, the same actual-vs-predicted, residual and feature-importance
 plots, the same joblib .pkl, and the same closing step of scoring an unknown
 compound set. Every place where it departs from them is listed at the very end
 of the run, with the reason.

 WHAT IT DOES NOT DO
 -------------------
 It never writes to your workbook. It only reads it. All outputs go to CSV files
 in the working directory.
===============================================================================
"""

# =============================================================================
# 0. CONFIG  (the only block you may want to touch)
# =============================================================================

CONFIG = {
    # ---- WHICH ENDPOINT ----------------------------------------------------
    # "schulz_plasma"   the plasma-concentration endpoint, and the best
    #                   populated of the three: log10(toxic mg/L / therapeutic
    #                   mg/L) from Schulz's compilation of therapeutic and
    #                   toxic plasma concentrations. 421 molecules have both a
    #                   value and a structure; 402 of those are organic, which
    #                   is the n a structure-based model actually gets.
    #                   Units are mg/L in plasma or serum, NOT mg of dose, and
    #                   the two cannot be converted into each other without
    #                   every drug's volume of distribution and bioavailability.
    # "leaderboard"     the clinical mg-dose endpoint from your own workbook:
    #                   log10(Minimum Toxic Level mg / Minimum Therapeutic
    #                   Level mg), single dose, healthy volunteers, oral or IV.
    #                   19 molecules carry it. The script will refuse to train.
    # "curated_invitro" the in vitro endpoint from
    #                   "Side effect prediction/curated dataset for therapeutic
    #                   index prediction.xlsx": log10(off-target nM /
    #                   on-target nM). 282 molecules carry it, with the split
    #                   already decided in the file (234 training, 75 external).
    #
    # THESE TWO ARE DIFFERENT QUANTITIES AND MUST NEVER BE POOLED. One is a
    # ratio of clinical doses in mg; the other a ratio of in vitro potencies in
    # nM on one congeneric series. They share a name and nothing else. The
    # script runs one at a time, labels every output with the endpoint it came
    # from, and will not let you mix them.
    "DATASET": "leaderboard",

    # ---- input -------------------------------------------------------------
    # Leave as None in Colab to get an upload button. Or set a path, e.g.
    # "/content/Drug-Leaderboard-v3-live-summary-fixed.xlsx"
    "XLSX_PATH": None,
    "SHEET_NAME": "Drug Leaderboard",
    # Header row as you see it in Excel (1-based). Row 24 holds "Rank | Percentile
    # | Drug Name | ... | Log Therapeutic Index | ...". Data starts at row 25.
    "HEADER_ROW_EXCEL": 24,
    # Columns, by Excel letter. A-Q are formula mirrors; X-AN are the typed
    # originals. The script reads the typed column first and falls back to the
    # mirror. Change only if you move columns.
    "COL": {
        "name":      ("Z",  "C"),
        "drugbank":  ("AA", "D"),
        "smiles":    ("AB", "E"),
        "target":    ("AC", "F"),
        "uniprot":   ("AD", "G"),
        "ther":      ("AE", "H"),   # Minimum Therapeutic Level (mg)
        "tox":       ("AF", "I"),   # Minimum Toxic Level (mg)
        "logti":     ("AG", "J"),   # Log Therapeutic Index
    },
    # Optional: join the mechanism-of-action sheet to get a target for routing.
    "MOA_SHEET_NAME": "Mechanism of Action",
    "MOA_HEADER_ROW_EXCEL": 2,
    "MOA_COL": {"mechanism": "A", "drug": "B", "book_target": "C"},
    "USE_MOA_SHEET_FOR_TARGET": True,

    # ---- the curated in vitro file, used only when DATASET is that ---------
    "CURATED": {
        "PATH": "/mnt/project-files/Side effect prediction/"
                "curated dataset for therapeutic index prediction.xlsx",
        "FALLBACK_PATHS": [
            "curated dataset for therapeutic index prediction.xlsx",
            "/content/curated dataset for therapeutic index prediction.xlsx",
        ],
        "SHEET": "curated_dataset",
        "HEADER_ROW_EXCEL": 1,
        # read by name, because this file has a proper header row
        "COL_NAME": "compound_id",
        "COL_SMILES": "smiles",
        "COL_ENDPOINT": "therapeutic_index",
        "COL_SPLIT": "set",              # "training" / "external", as given
        "COL_SOURCE": "endpoint_source_type",
        "COL_CITATION": "citation",
        "COL_ACTIVITY_TYPE": "activity_standard_type",
        "COL_TOXICITY_TYPE": "toxicity_standard_type",
        # Honour the split in the file rather than making a new one.
        "USE_FILE_SPLIT": True,
    },

    # ---- the plasma-concentration file, used only when DATASET is that -----
    # This CSV was built in two steps, both recorded in it per row: Schulz's
    # table was extracted to schulz-extract.csv, then each name was resolved to
    # a structure, 596 from the project's DrugBank dump and 332 from a PubChem
    # name lookup. The structure_source column says which, so a wrong salt or
    # stereoisomer from a name lookup can be traced rather than guessed at.
    "SCHULZ": {
        "PATH": "/mnt/project-files/qsar-moa/schulz/schulz-structures.csv",
        "FALLBACK_PATHS": [
            "schulz-structures.csv",
            "/content/schulz-structures.csv",
        ],
        # Inorganics (arsenic, bromide and the like) carry a real plasma index
        # but have no meaningful fingerprint or descriptor profile, so they are
        # dropped from a structure-based model by default, with a printed count.
        "REQUIRE_CARBON": True,

        # Schulz is clinical AND forensic toxicology, so the table carries
        # solvents and industrial poisons beside the drugs: methanol, acetone,
        # chloroform, butanone, carbon tetrachloride, propylene glycol,
        # 2,2,2-trichloroethanol, aniline, chloral hydrate. They sit far outside
        # drug-like space and will stretch the applicability domain.
        #
        # A DrugBank-ID filter does NOT remove them, which was checked rather
        # than assumed: propylene glycol has DrugBank ID DB01839, and it is the
        # largest index in the whole set (4.30), so the one point the filter was
        # wanted for is the one it keeps. Chloral hydrate, a real sedative, is
        # flagged the other way by a spelling ("Chloralhydrate"). The DrugBank
        # flag is therefore carried as PROVENANCE and reported, never used as a
        # filter.
        #
        # What does separate them is size. Heavy-atom counts: methanol 2,
        # acetone 4, chloroform 4, butanone 5, carbon tetrachloride 5, propylene
        # glycol 5, trichloroethanol 6, chloral hydrate 6, aniline 7 — against
        # 10 for valproic acid and metformin, 11 for paracetamol, 13 for
        # aspirin. So the filter is a floor on heavy atoms, computed by RDKit at
        # run time, and every dropped molecule is named in the output.
        #
        # SUBSET: "drug_like" applies the floor (the primary model).
        #         "all" applies nothing (the sensitivity check).
        # Run both and compare: the comparison helper at the end of section 10
        # prints the two runs side by side from their saved summaries.
        "SUBSET": "drug_like",
        "MIN_HEAVY_ATOMS": 8,

        # Molecules whose applicability-domain status is printed by name in
        # every run, so the influential ones can be followed between the two
        # subsets instead of argued about.
        "WATCH": ["Propylene glycol", "Methanol", "Acetone", "Chloroform",
                  "Butanone", "Carbon tetrachloride", "2,2,2-Trichloroethanol",
                  "Aniline", "Chloralhydrate"],
        "SIBLING_FILES": {
            "extract": "/mnt/project-files/qsar-moa/schulz/schulz-extract.csv",
            "annotations":
                "/mnt/project-files/qsar-moa/schulz/schulz-extract-annotations.csv",
            "report": "/mnt/project-files/qsar-moa/schulz/schulz-report.md",
            "unresolved":
                "/mnt/project-files/qsar-moa/schulz/schulz-unresolved-names.csv",
        },
    },

    # Strings that mean "not found" in this workbook. A literal 0 means
    # "not filled in" here, NOT a measured zero dose.
    "MISSING_TOKENS": ["", "0", "0.0", "n.f.", "n.a.", "na", "nan", "none",
                       "-", "--", "not found", "n/a"],
    # True for the leaderboard, where a typed 0 is the "not filled in" marker.
    # Switched off for the curated file, where 0 is a real value. Set by the
    # dataset pre-pass below; do not edit by hand.
    "ZERO_MEANS_MISSING": True,

    # ---- reproducibility ---------------------------------------------------
    "SEED": 20261124,

    # ---- chemistry ---------------------------------------------------------
    "MORGAN_RADIUS": 2,
    "MORGAN_NBITS": 2048,
    # Two molecules in the same congeneric series if Tanimoto >= this, after
    # Bemis-Murcko scaffolds are used as the first grouping key.
    "TANIMOTO_SERIES_CUTOFF": 0.60,
    # Reject a query molecule whose nearest training neighbour is less similar
    # than this (part of the applicability domain).
    "TANIMOTO_AD_CUTOFF": 0.25,
    "DROP_DESCRIPTORS": ["Ipc"],          # overflows on large molecules
    "CORR_PRUNE_THRESHOLD": 0.95,
    # The four named descriptor families from Part 14 of your notebooks are
    # always computed. The 3D family needs a conformer per molecule, which is
    # slow over 1,000 molecules, so it is off until you want it.
    "COMPUTE_3D_DESCRIPTORS": False,

    # ---- optional: your own CSV of new compounds to score ------------------
    # Part 15 ends by scoring an unknown set. Point this at a CSV with a
    # "SMILES" column (a "Name" column is used if present) and section 10 will
    # score it with the saved model, routing and refusal included.
    "UNKNOWN_CSV": None,
    "SAVE_MODEL_PKL": True,       # joblib dump, as Part 15 does

    # ---- splitting ---------------------------------------------------------
    "MIN_TRAIN_N": 40,            # floor for honest GroupKFold training
    "MIN_GROUPS": 5,              # floor for number of scaffold groups
    "N_OUTER_FOLDS": 5,
    "N_INNER_FOLDS": 3,
    "EXTERNAL_TEST_FRACTION": 0.20,
    "ALLOW_UNDERPOWERED": True,   # <-- set False to enforce the refusal and stop

    # ---- tuning ------------------------------------------------------------
    "N_OPTUNA_TRIALS": 60,        # deck: Optuna, TPE sampler, median pruning
    "USE_OPTUNA": True,           # False -> fixed, documented defaults

    # ---- validation --------------------------------------------------------
    "N_Y_SCRAMBLE": 50,           # y-randomisation runs (deck: cRp2 > 0.5)

    # ---- applicability domain ---------------------------------------------
    "AD_BOX_PERCENTILES": (1.0, 99.0),   # deck: percentile bounding box
    "AD_REQUIRE_ALL": True,  # in-domain only if box AND leverage AND similarity

    # ---- toxicity filters (deck slides 6 and 7) ----------------------------
    "PFIZER_FILTER_TRAINING": False,   # do NOT delete training rows at n=19
    # (query molecules are always flagged, never filtered, so there is no
    #  switch for that: a flag you can see costs nothing and hides nothing)

    # ---- routing -----------------------------------------------------------
    "MIN_SERIES_N": 8,   # a series needs this many labelled drugs for its own model

    # ---- output ------------------------------------------------------------
    # Outputs are prefixed with the dataset name too, so a run on one endpoint
    # can never overwrite or be mistaken for a run on the other.
    "OUT_PREFIX": "qsar_oecd",
    "TOP_N_PRINT": 25,
    "MAX_QUERY_MOLECULES": None,   # set e.g. 300 to run faster on a first pass
}


# =============================================================================
# 0a. DEPENDENCIES  (installed quietly, only if missing)
# =============================================================================

import importlib
import subprocess
import sys


def _ensure(pip_name, import_name=None):
    mod = import_name or pip_name
    try:
        importlib.import_module(mod)
        return True
    except Exception:
        print(f"[setup] installing {pip_name} ...", flush=True)
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "--quiet", pip_name],
                check=True,
            )
            importlib.invalidate_caches()
            importlib.import_module(mod)
            return True
        except Exception as exc:          # noqa: BLE001
            print(f"[setup] COULD NOT INSTALL {pip_name}: {exc}")
            return False


_ensure("numpy")
_ensure("pandas")
_ensure("scipy")
_ensure("scikit-learn", "sklearn")
_ensure("openpyxl")
_ensure("rdkit")                      # the official 'rdkit' wheel, not rdkit-pypi
_ensure("networkx")                   # Part 14 uses it for the Wiener index
_ensure("joblib")                     # Part 15 saves the best model with it
HAVE_OPTUNA = _ensure("optuna") if CONFIG["USE_OPTUNA"] else False
HAVE_SHAP = _ensure("shap")
HAVE_MPL = _ensure("matplotlib")
HAVE_SNS = _ensure("seaborn")         # Part 15 plots with it

import json
import math
import os
import random
import textwrap
import warnings
from datetime import datetime, timezone

import joblib
import networkx as nx
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from scipy.stats import pearsonr
from sklearn.base import clone
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.model_selection import (GridSearchCV, GroupKFold,
                                     GroupShuffleSplit, LeaveOneGroupOut,
                                     LeaveOneOut)
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR

from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import (QED, AllChem, Descriptors, rdFingerprintGenerator,
                        rdFreeSASA, rdMolDescriptors, rdmolops)
from rdkit.Chem.MolStandardize import rdMolStandardize
from rdkit.Chem.Scaffolds import MurckoScaffold

RDLogger.DisableLog("rdApp.*")
warnings.filterwarnings("ignore")

SEED = CONFIG["SEED"]
os.environ["PYTHONHASHSEED"] = str(SEED)
random.seed(SEED)
np.random.seed(SEED)

RUN_STAMP = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
LOG = []            # every step, for principle 1's audit trail
INDICATIVE = False  # set True if the run is underpowered; stamps all statistics


def banner(text, char="="):
    line = char * 79
    print(f"\n{line}\n{text}\n{line}", flush=True)


def step(msg):
    print(f"  - {msg}", flush=True)
    LOG.append(msg)


def tag():
    return "  [INDICATIVE, UNDERPOWERED]" if INDICATIVE else ""


banner("QSAR for Log Therapeutic Index, structured by the 5 OECD principles")
print(f"run started        : {RUN_STAMP}")
print(f"random seed        : {SEED}")
print(f"numpy / pandas     : {np.__version__} / {pd.__version__}")
print(f"rdkit              : {Chem.rdBase.rdkitVersion}")
print(f"optuna available   : {HAVE_OPTUNA}")
print(f"shap available     : {HAVE_SHAP}")


# =============================================================================
# 1. OECD PRINCIPLE 1 - A DEFINED ENDPOINT
#    Read the workbook, say exactly what is being predicted, count n, and say
#    out loud how many rows are unusable and why.
# =============================================================================

banner("OECD PRINCIPLE 1 - DEFINED ENDPOINT")

DATASET = CONFIG["DATASET"]
_VALID = ("leaderboard", "curated_invitro", "schulz_plasma")
if DATASET not in _VALID:
    raise SystemExit(f"CONFIG['DATASET'] must be one of {_VALID}, "
                     f"not {DATASET!r}.")

if DATASET == "leaderboard":
    print(textwrap.dedent("""
        Endpoint        : Log Therapeutic Index  (CLINICAL, mg doses)
        Definition      : log10( Minimum Toxic Level / Minimum Therapeutic Level )
        Units of inputs : mg of dose
        Study design    : single dose, healthy volunteers or subjects, oral or IV.
                          Taken verbatim from the project's own curation board
                          (Data Curation Workflow.excalidraw), whose worked example
                          reads "Minimum Therapeutic Level = 400 mg",
                          "Minimum Toxic Level = 1600 mg" under the heading
                          "Single Dose Pharmacokinetics In Healthy
                          Volunteers/Subjects", branching to "Oral" and "IV".
                          So: NOT steady state, NOT patient data.
        Direction       : higher is safer (a wider window between the dose that
                          works and the dose that harms)
        Source of truth : the typed columns of sheet "Drug Leaderboard"
                          (AE = Minimum Therapeutic Level, AF = Minimum Toxic
                          Level, AG = Log Therapeutic Index); A-Q are formula
                          mirrors of those
        Still undefined : which route each recorded pair used, and in whom. The
                          board fixes the design in general; the sheet does not
                          record it per drug. That is a real gap under principle
                          1 and is reported, not papered over.
    """).strip())
    print(textwrap.dedent("""
        A PROVENANCE PROBLEM WITH THIS ENDPOINT, CHECKED AGAINST THE SOURCE
        -------------------------------------------------------------------
        The worked example on the curation board (400 mg and 1600 mg, giving an
        index of 4) traces to reference 5 on the board's own list:
        Holdich T, Shiveley L, Sawyer J. Clin Drug Invest 2006;26(5):279-86.
        Its text was read for this note, and verbatim it is:
          * title: "Pharmacokinetics of Single Oral Doses of ... in Healthy
            Volunteers"
          * "Participants received single oral doses of ... 400mg, 800mg and
            1600mg in ascending order at intervals of at least 1 week."
          * "All doses ... were well tolerated."
          * "There was no relationship between the incidence of adverse events
            and the dose ... The total numbers of events reported with the
            400mg, 800mg and 1600mg doses were 23 (reported by 17% of
            participants), 34 (48%) and 10 (17%), respectively."
        So 400 mg is the LOWEST dose studied, not a measured minimum effective
        dose: there was no efficacy endpoint and the subjects were healthy. And
        1600 mg is the HIGHEST dose studied, which was tolerated, with the
        fewest events of the three. No toxic threshold was reached.

        That makes 1600/400 = 4 the ratio of the top to the bottom of a
        three-point dose escalation. It is a property of the trial design, not
        of the drug, and the toxic axis is censored from above.

        Consequence, stated and not acted on: where a row's "Minimum Toxic
        Level" is the highest dose studied rather than an observed toxic dose,
        the endpoint is a studied-dose-range ratio, and a model fitted to it
        learns the dose ladders that trials happen to use. This script does not
        rename anything in your workbook and does not decide the matter. It
        refuses to train on this endpoint for this reason as well as for n, and
        says so, so the refusal cannot be mistaken for a sample-size problem
        alone. That decision is yours to make.
    """).strip())
elif DATASET == "schulz_plasma":
    print(textwrap.dedent("""
        Endpoint        : Log Therapeutic Index  (PLASMA CONCENTRATIONS, mg/L)
        Definition      : log10( toxic concentration / therapeutic concentration )
                          Verified on all 426 rows that carry it: the stored
                          value equals log10(toxic_low / therapeutic_low) to
                          1e-6. It is ALREADY a log10 ratio and must not be
                          logged again.
        Units of inputs : mg/L in plasma or serum. NOT mg of dose. The two
                          cannot be converted without each drug's volume of
                          distribution and bioavailability, so do not try.
        Which end        : the low end of each range, because the source column
                          is "toxic (from)", and a minimum is what is wanted.
        Study design    : a compilation of therapeutic and toxic plasma
                          concentrations, every row carrying its own citation.
        Structures      : the source has none. Names were resolved in two
                          steps, recorded per row in structure_source:
                          596 from the project's DrugBank dump, 332 from a
                          PubChem name lookup. A name lookup can land on a
                          different salt or stereoisomer than was measured, so
                          treat the PubChem-sourced rows as the weaker half and
                          check any row a conclusion rests on.
        Counts          : 949 rows; 928 with a structure (97.8%); 421 with both
                          a structure and an index; 402 of those organic, which
                          is the n a structure-based model gets. The 19
                          inorganic ones are dropped by default and counted.
        Qualifiers      : 886 rows carry one ("approximate", "<", ">", "range").
                          They are kept and reported, not filtered, because
                          dropping them would quietly change what the set is.
        NOT the same as : the clinical mg-dose endpoint, nor the in vitro nM
                          one. Three different quantities. Never pooled.
    """).strip())
else:
    print(textwrap.dedent("""
        Endpoint        : Therapeutic Index  (IN VITRO, nM potencies)
        Definition      : log10( off-target nM / on-target nM ), which the file
                          also stores as p_activity - p_toxicity. Verified on all
                          282 labelled rows: both forms agree to 1e-6.
        Units of inputs : nM concentration. The endpoint itself is a log10 ratio,
                          so it is dimensionless and must NOT be logged again.
        Study design    : in vitro binding and functional assays against two
                          molecular targets, on one congeneric series, every row
                          marked endpoint_source_type = experimental and carrying
                          a citation. On-target potency is Ki throughout;
                          off-target is IC50 for 207 rows and Ki for 75.
        Direction       : higher is a wider margin between the wanted and the
                          unwanted molecular effect
        Source of truth : sheet "curated_dataset", column therapeutic_index
        Split           : already decided in the file, column "set":
                          234 training, 75 external. Used as given, not re-split.
        NOT the same as  : the clinical mg-dose endpoint above. Same name,
                          different quantity. Never pool the two, and never
                          validate one against the other.
    """).strip())

# --- dataset pre-pass: point the reader at the right file and columns -------
# This rewrites CONFIG so that one reader, one set of missing-value rules and
# one set of counts serve both endpoints. Nothing below this line needs to know
# which dataset is in use, except where the split comes from.
if DATASET == "curated_invitro":
    _cur = CONFIG["CURATED"]
    CONFIG["XLSX_PATH"] = _cur["PATH"]
    CONFIG["SHEET_NAME"] = _cur["SHEET"]
    CONFIG["HEADER_ROW_EXCEL"] = _cur["HEADER_ROW_EXCEL"]
    # by Excel letter, as the file is laid out:
    #   A set | B compound_id | C smiles | D p_activity | E activity_type
    #   F activity_nM | G p_toxicity | H toxicity_type | I toxicity_nM
    #   J therapeutic_index | K endpoint_source_type | L citation
    CONFIG["COL"] = {
        "name":     ("B", "B"),
        "drugbank": ("B", "B"),
        "smiles":   ("C", "C"),
        "target":   ("E", "E"),
        "uniprot":  ("L", "L"),       # citation, carried through for provenance
        "ther":     ("F", "F"),       # on-target nM  -> the denominator
        "tox":      ("I", "I"),       # off-target nM -> the numerator
        "logti":    ("J", "J"),
        "split":    ("A", "A"),       # "training" / "external", as given
    }
    CONFIG["USE_MOA_SHEET_FOR_TARGET"] = False
    CONFIG["ZERO_MEANS_MISSING"] = False   # 0 is a real index here
    CONFIG["MISSING_TOKENS"] = [t for t in CONFIG["MISSING_TOKENS"]
                                if t not in ("0", "0.0")]
    print("\n  dataset pre-pass: reading the curated in vitro file, honouring "
          "its own train/external split, and treating a literal 0 as a real "
          "value rather than a blank.")
elif DATASET == "schulz_plasma":
    _sch = CONFIG["SCHULZ"]
    CONFIG["XLSX_PATH"] = _sch["PATH"]
    CONFIG["SHEET_NAME"] = "(a CSV, so there is no sheet)"
    CONFIG["HEADER_ROW_EXCEL"] = 1
    # by column position in schulz-structures.csv:
    #   A substance | B has_log_index | C log_therapeutic_index
    #   D therapeutic_low_mg_L | E toxic_low_mg_L | F units
    #   G structure_source | H matched_name | I source_id | J smiles
    #   K has_carbon
    CONFIG["COL"] = {
        "name":        ("A", "A"),
        "drugbank":    ("I", "I"),      # DBxxxxx or CID:xxxxx, whichever it was
        "smiles":      ("J", "J"),
        "target":      ("G", "G"),      # overwritten with a constant below
        "uniprot":     ("F", "F"),      # units string, carried for provenance
        "ther":        ("D", "D"),      # therapeutic mg/L -> the denominator
        "tox":         ("E", "E"),      # toxic mg/L       -> the numerator
        "logti":       ("C", "C"),
        "flag_carbon": ("K", "K"),
        "flag_drug":   ("L", "L"),      # in the DrugBank dump: provenance only
    }
    CONFIG["USE_MOA_SHEET_FOR_TARGET"] = False
    CONFIG["ZERO_MEANS_MISSING"] = False
    CONFIG["MISSING_TOKENS"] = [t for t in CONFIG["MISSING_TOKENS"]
                                if t not in ("0", "0.0")]
    print("\n  dataset pre-pass: reading the plasma-concentration CSV. Units "
          "are mg/L, not mg. A literal 0 is a real value here. The split is "
          "made by congeneric series, because this file brings none of its own.")
    for _k, _p in _sch["SIBLING_FILES"].items():
        print(f"    provenance ({_k}): {_p}")
else:
    print("\n  dataset pre-pass: reading your leaderboard workbook, treating a "
          "literal 0 as 'not filled in', as that sheet uses it.")

# every output file carries the dataset in its name, so a run on one endpoint
# cannot overwrite or be mistaken for a run on the other
CONFIG["OUT_PREFIX"] = f"{CONFIG['OUT_PREFIX']}_{DATASET}"
if DATASET == "schulz_plasma":
    # the subset goes in the name too, so the primary run and the sensitivity
    # run cannot overwrite each other and can be compared afterwards
    CONFIG["OUT_PREFIX"] += f"_{CONFIG['SCHULZ']['SUBSET']}"
print(f"  output files will be named {CONFIG['OUT_PREFIX']}_*")


def col_to_idx(letter):
    """'A'->0, 'Z'->25, 'AA'->26, 'AN'->39."""
    n = 0
    for ch in letter.strip().upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def resolve_path():
    path = CONFIG["XLSX_PATH"]
    if path and os.path.exists(path):
        return path
    guesses = (list(CONFIG["CURATED"]["FALLBACK_PATHS"])
               if DATASET == "curated_invitro"
               else list(CONFIG["SCHULZ"]["FALLBACK_PATHS"])
               if DATASET == "schulz_plasma" else [
                   "Drug-Leaderboard-v3-live-summary-fixed.xlsx",
                   "/content/Drug-Leaderboard-v3-live-summary-fixed.xlsx",
                   "/mnt/project-files/Drug-Leaderboard-v3-live-summary-fixed.xlsx",
               ])
    for guess in guesses:
        if os.path.exists(guess):
            step(f"found workbook at {guess}")
            return guess
    try:                                        # Colab upload button
        from google.colab import files          # type: ignore
        print("\nUpload Drug-Leaderboard-v3-live-summary-fixed.xlsx:")
        uploaded = files.upload()
        return list(uploaded.keys())[0]
    except Exception as exc:                    # noqa: BLE001
        raise SystemExit(
            "No workbook found. Set CONFIG['XLSX_PATH'] to the .xlsx file. "
            f"({exc})"
        )


XLSX = resolve_path()
step(f"reading {XLSX} (read-only; this script never writes to your workbook)")

try:
    if str(XLSX).lower().endswith(".csv"):
        # Same reader downstream: a header row and columns addressed by letter.
        raw = pd.read_csv(XLSX, header=None, dtype=str, keep_default_na=False)
    else:
        raw = pd.read_excel(XLSX, sheet_name=CONFIG["SHEET_NAME"], header=None,
                            engine="openpyxl")
except ValueError:
    _present = pd.ExcelFile(XLSX, engine="openpyxl").sheet_names
    raise SystemExit(
        f"\nSTOP. There is no sheet called '{CONFIG['SHEET_NAME']}' in {XLSX}.\n"
        f"The sheets in that file are: {_present}\n"
        "Set CONFIG['SHEET_NAME'] to one of those and run again."
    )
hdr_i = CONFIG["HEADER_ROW_EXCEL"] - 1
if hdr_i >= len(raw):
    raise SystemExit(
        f"\nSTOP. Sheet '{CONFIG['SHEET_NAME']}' has only {len(raw)} rows, so "
        f"header row {CONFIG['HEADER_ROW_EXCEL']} does not exist. Set "
        "CONFIG['HEADER_ROW_EXCEL'] to the row that holds 'Drug Name' and "
        "'Log Therapeutic Index'."
    )

step(f"header row {CONFIG['HEADER_ROW_EXCEL']} -> "
     f"{[str(x) for x in raw.iloc[hdr_i, :17].tolist()]}")

body = raw.iloc[hdr_i + 1:].reset_index(drop=True)
MISSING = {t.strip().lower() for t in CONFIG["MISSING_TOKENS"]}


def is_missing(v):
    if v is None:
        return True
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return True
    s = str(v).strip().lower()
    if s in MISSING:
        return True
    try:
        # In the leaderboard a literal zero IS the "not filled in" marker. In
        # the curated file zero is a real index. One flag, set by the pre-pass.
        return CONFIG["ZERO_MEANS_MISSING"] and float(s) == 0.0
    except (TypeError, ValueError):
        return False


UNPARSEABLE = []        # every cell that looked filled in but is not a number


def pick(row, key, numeric=False):
    """
    Typed column first, formula mirror second.
    With numeric=True a cell that float() cannot read ("12 mg", "250-500",
    "<5", a stray date) does NOT stop the search: it is recorded and the mirror
    column is tried. Without that, one typo in the typed column would silently
    move a drug out of the modelling set and into the ranking set.
    """
    for letter in CONFIG["COL"][key]:
        idx = col_to_idx(letter)
        if idx < len(row):
            v = row.iloc[idx]
            if not is_missing(v):
                if numeric and np.isnan(as_float(v)):
                    UNPARSEABLE.append((key, letter, str(v)[:40]))
                    continue
                return v
    return None


def as_float(v):
    if is_missing(v):
        return np.nan
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return np.nan


def raw_cells(row, key):
    """The untouched cell text of both columns for a field, for auditing."""
    out = []
    for letter in CONFIG["COL"][key]:
        i = col_to_idx(letter)
        out.append("" if i >= len(row) or row.iloc[i] is None
                   else str(row.iloc[i]).strip())
    return out


records, skipped_no_name, zero_endpoint_rows = [], 0, []
for _, row in body.iterrows():
    name = pick(row, "name")
    if name is None or not str(name).strip():
        skipped_no_name += 1
        continue
    ther = as_float(pick(row, "ther", numeric=True))
    tox = as_float(pick(row, "tox", numeric=True))
    logti = as_float(pick(row, "logti", numeric=True))
    endpoint_source = "none"
    if not np.isnan(logti):
        endpoint_source = "Log Therapeutic Index column"
    elif not np.isnan(ther) and not np.isnan(tox) and ther > 0 and tox > 0:
        logti = math.log10(tox / ther)
        endpoint_source = "computed from the two dose columns"
    # A Log Therapeutic Index of exactly 0 is a real measurement: it means the
    # toxic dose equals the therapeutic dose. In THIS workbook a literal 0 is
    # also the "not filled in" marker, so the two cannot be told apart from the
    # index column alone. Such rows are counted and named rather than guessed
    # at, and a drug whose two doses are typed in and equal IS kept, because
    # the fallback above computes log10(1) = 0.0 and that 0.0 is a float, not a
    # re-read cell.
    if np.isnan(logti) and any(c in ("0", "0.0", "0.00")
                               for c in raw_cells(row, "logti")):
        zero_endpoint_rows.append(str(name).strip())

    smiles = pick(row, "smiles")
    target = pick(row, "target")
    records.append({
        "name": str(name).strip(),
        "drugbank_id": None if pick(row, "drugbank") is None
        else str(pick(row, "drugbank")).strip(),
        "smiles_raw": None if smiles is None else str(smiles).strip(),
        "target_raw": None if target is None else str(target).strip(),
        "uniprot": None if pick(row, "uniprot") is None
        else str(pick(row, "uniprot")).strip(),
        "ther_mg": ther,
        "tox_mg": tox,
        "log_ti": logti,
        "endpoint_source": endpoint_source,
        # only the curated file carries a split of its own
        "preset_split": (str(pick(row, "split")).strip().lower()
                         if "split" in CONFIG["COL"]
                         and pick(row, "split") is not None else None),
        # only the plasma file carries an organic/inorganic flag
        "has_carbon": (str(pick(row, "flag_carbon")).strip().lower()
                       if "flag_carbon" in CONFIG["COL"]
                       and pick(row, "flag_carbon") is not None else None),
        "in_drugbank": (str(pick(row, "flag_drug")).strip().lower()
                        if "flag_drug" in CONFIG["COL"]
                        and pick(row, "flag_drug") is not None else None),
    })

df = pd.DataFrame.from_records(records)
if df.empty:
    raise SystemExit(
        f"\nSTOP. No drug names found below header row "
        f"{CONFIG['HEADER_ROW_EXCEL']} of sheet '{CONFIG['SHEET_NAME']}'. "
        f"Check CONFIG['HEADER_ROW_EXCEL'] and CONFIG['COL']['name'] "
        f"(currently {CONFIG['COL']['name']}, meaning column Z then column C). "
        "No model, no statistics and no ranking are produced."
    )
step(f"rows after the header            : {len(body)}")
step(f"rows with a drug name            : {len(df)}  (skipped {skipped_no_name} blank)")
step(f"rows with a SMILES string        : {int(df['smiles_raw'].notna().sum())}")
step(f"rows with Minimum Therapeutic mg : {int(df['ther_mg'].notna().sum())}")
step(f"rows with Minimum Toxic mg       : {int(df['tox_mg'].notna().sum())}")
step(f"rows with a Log Therapeutic Index: {int(df['log_ti'].notna().sum())}")
step(f"rows with a Drug Target          : {int(df['target_raw'].notna().sum())}")
if UNPARSEABLE:
    step(f"cells that looked filled in but are not numbers: {len(UNPARSEABLE)} "
         "(the mirror column was used instead; first few below)")
    for k, letter, txt in UNPARSEABLE[:10]:
        step(f"    {k} in column {letter}: '{txt}'")
step(f"rows whose index cell holds a literal 0: {len(zero_endpoint_rows)} "
     "-> read as 'not filled in', NOT as log TI = 0")
if zero_endpoint_rows:
    print("\n  A NOTE YOU SHOULD READ ONCE, then never again:")
    print("  In this workbook a literal 0 marks an empty cell, so a drug whose "
          "toxic dose really does equal its therapeutic dose (log TI = 0, the "
          "most dangerous drug there is) looks exactly like a blank. The script "
          f"has read {len(zero_endpoint_rows)} such cells as blank, which for "
          "this file is right. If any of those drugs genuinely has toxic dose "
          "= therapeutic dose, type both doses into columns AE and AF and this "
          "script will compute 0.0 and keep the row. Nothing silently vanishes.")

# optional: targets from the mechanism-of-action sheet, for routing
if CONFIG["USE_MOA_SHEET_FOR_TARGET"]:
    try:
        moa_raw = pd.read_excel(XLSX, sheet_name=CONFIG["MOA_SHEET_NAME"],
                                header=None, engine="openpyxl")
        mh = CONFIG["MOA_HEADER_ROW_EXCEL"] - 1
        moa_body = moa_raw.iloc[mh + 1:]
        c_drug = col_to_idx(CONFIG["MOA_COL"]["drug"])
        c_mech = col_to_idx(CONFIG["MOA_COL"]["mechanism"])
        c_tgt = col_to_idx(CONFIG["MOA_COL"]["book_target"])
        lookup = {}
        for _, r in moa_body.iterrows():
            if c_drug >= len(r):
                continue
            d = r.iloc[c_drug]
            if is_missing(d):
                continue
            key = str(d).strip().lower()
            mech = r.iloc[c_mech] if c_mech < len(r) else None
            tgt = r.iloc[c_tgt] if c_tgt < len(r) else None
            if key not in lookup:
                lookup[key] = (
                    None if is_missing(mech) else str(mech).strip(),
                    None if is_missing(tgt) else str(tgt).strip(),
                )
        df["moa_mechanism"] = df["name"].str.lower().map(
            lambda k: lookup.get(k, (None, None))[0])
        df["moa_book_target"] = df["name"].str.lower().map(
            lambda k: lookup.get(k, (None, None))[1])
        step(f"joined sheet '{CONFIG['MOA_SHEET_NAME']}': "
             f"{int(df['moa_mechanism'].notna().sum())} drugs picked up a mechanism")
    except Exception as exc:                    # noqa: BLE001
        df["moa_mechanism"] = None
        df["moa_book_target"] = None
        step(f"no usable '{CONFIG['MOA_SHEET_NAME']}' sheet ({exc}); "
             "routing will fall back to target UNSPECIFIED")
else:
    df["moa_mechanism"] = None
    df["moa_book_target"] = None


def resolve_target(r):
    for v in (r.get("target_raw"), r.get("moa_mechanism"), r.get("moa_book_target")):
        if v and str(v).strip() and not is_missing(v):
            return str(v).strip()
    return "UNSPECIFIED"


df["target"] = df.apply(resolve_target, axis=1)
if DATASET == "schulz_plasma":
    # column G was read into target_raw; it is the structure's provenance, not
    # a target, so report it and then put a truthful constant in target
    _srcs = df["target_raw"].fillna("unknown").value_counts()
    step("where each structure came from: "
         + ", ".join(f"{k} {v}" for k, v in _srcs.items()))
    step("a PubChem name lookup can land on a different salt or stereoisomer "
         "than was measured, so those rows are the weaker half of this set")
    df["target"] = "whole-body plasma exposure, no single molecular target"
    if CONFIG["SCHULZ"]["REQUIRE_CARBON"]:
        _before = len(df)
        _inorg = df[(df["has_carbon"] == "no") & df["log_ti"].notna()]
        df = df[df["has_carbon"] != "no"].reset_index(drop=True)
        step(f"dropped {_before - len(df)} inorganic entries (no carbon in the "
             f"structure), of which {len(_inorg)} carried an index. They have a "
             "real plasma index but no meaningful fingerprint or descriptor "
             "profile, so a structure-based model cannot speak about them. Set "
             "CONFIG['SCHULZ']['REQUIRE_CARBON'] = False to keep them.")
        if len(_inorg):
            step("    they were: " + ", ".join(sorted(_inorg["name"])[:20])
                 + ("..." if len(_inorg) > 20 else ""))
    # provenance, reported and never used as a filter. Read the long comment in
    # CONFIG["SCHULZ"] for why: the one molecule a DrugBank filter was wanted
    # for is the one it keeps.
    _ndb = int((df["in_drugbank"] == "yes").sum())
    step(f"in the DrugBank dump: {_ndb} of {len(df)}; not in it: {len(df) - _ndb}. "
         "Carried as provenance only. Absence is weak evidence, because that "
         "dump holds a structure for just 3,542 distinct names: alprenolol, "
         "amobarbital and astemizole are real drugs missing from it, and "
         "chloral hydrate is marked absent only because of its spelling.")
elif DATASET == "curated_invitro":
    # The file names no target column; the two targets are in the header names
    # of the potency columns. One constant target across the whole set means
    # routing reduces to routing by congeneric series, which is correct for a
    # single series.
    df["target"] = "on-target vs off-target, one congeneric series"

N_LABELLED_RAW = int(df["log_ti"].notna().sum())
print(f"\n  >>> endpoint present for {N_LABELLED_RAW} of {len(df)} drugs "
      f"({100.0 * N_LABELLED_RAW / max(len(df), 1):.1f}%)")
if N_LABELLED_RAW:
    lab = df.loc[df["log_ti"].notna(), "log_ti"]
    print(f"  >>> endpoint range {lab.min():.3f} to {lab.max():.3f}, "
          f"mean {lab.mean():.3f}, sd {lab.std(ddof=1):.3f}")
    print("  >>> a narrow range means even a good model will score badly on R2, "
          "because R2 is measured against the spread of y.")


# =============================================================================
# 2. OECD PRINCIPLE 2, PART A - AN UNAMBIGUOUS ALGORITHM
#    Structure in: parse and standardise SMILES, count every failure, compute a
#    fully specified descriptor block and Morgan fingerprints.
# =============================================================================

banner("OECD PRINCIPLE 2 (a) - STRUCTURE PARSING, STANDARDISATION, DESCRIPTORS")

_uncharger = rdMolStandardize.Uncharger()
_chooser = rdMolStandardize.LargestFragmentChooser()


def standardise(smiles):
    """Return (mol, canonical_smiles, reason_if_failed)."""
    if not smiles:
        return None, None, "empty cell"
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None, None, "RDKit could not parse the SMILES"
    try:
        mol = rdMolStandardize.Cleanup(mol)
        mol = _chooser.choose(mol)          # drop counter-ions / salts
        mol = _uncharger.uncharge(mol)
        Chem.SanitizeMol(mol)
    except Exception as exc:                # noqa: BLE001
        return None, None, f"standardisation failed: {exc}"
    if mol.GetNumHeavyAtoms() == 0:
        return None, None, "no heavy atoms after standardisation"
    return mol, Chem.MolToSmiles(mol), None


mols, canon, fail_reasons = [], [], []
for s in df["smiles_raw"]:
    m, c, why = standardise(s)
    mols.append(m)
    canon.append(c)
    fail_reasons.append(why)

df["mol"] = mols
df["canonical_smiles"] = canon
df["parse_failure"] = fail_reasons

n_with_smiles = int(df["smiles_raw"].notna().sum())
n_parsed = int(df["mol"].notna().sum())
step(f"SMILES cells present     : {n_with_smiles}")
step(f"parsed and standardised  : {n_parsed}")
step(f"SMILES failures          : {n_with_smiles - n_parsed}")
if n_with_smiles - n_parsed:
    bad = df[df["smiles_raw"].notna() & df["mol"].isna()]
    for _, r in bad.head(20).iterrows():
        step(f"    FAILED {r['name']}: {r['parse_failure']}")
    if len(bad) > 20:
        step(f"    ... and {len(bad) - 20} more; full list in the failures CSV")
    bad[["name", "drugbank_id", "smiles_raw", "parse_failure"]].to_csv(
        f"{CONFIG['OUT_PREFIX']}_smiles_failures.csv", index=False)
    step(f"    wrote {CONFIG['OUT_PREFIX']}_smiles_failures.csv")

# duplicate structures: average the endpoint, keep one row, report it
work = df[df["mol"].notna()].copy().reset_index(drop=True)
dups = work["canonical_smiles"].duplicated(keep=False)
n_dup_rows = int(dups.sum())
if n_dup_rows:
    step(f"duplicate structures     : {n_dup_rows} rows share a canonical SMILES "
         f"with another row ({work.loc[dups, 'canonical_smiles'].nunique()} structures)")
    agg = (work.sort_values(["canonical_smiles", "name"])
           .groupby("canonical_smiles", as_index=False)
           .agg(name=("name", "first"),
                all_names=("name", lambda s: " | ".join(sorted(set(s)))),
                drugbank_id=("drugbank_id", "first"),
                target=("target", "first"),
                moa_mechanism=("moa_mechanism", "first"),
                ther_mg=("ther_mg", "mean"),
                tox_mg=("tox_mg", "mean"),
                log_ti=("log_ti", "mean"),
                preset_split=("preset_split", "first"),
                has_carbon=("has_carbon", "first"),
                in_drugbank=("in_drugbank", "first"),
                n_merged=("name", "size")))
    agg["mol"] = [Chem.MolFromSmiles(s) for s in agg["canonical_smiles"]]
    work = agg[agg["mol"].notna()].reset_index(drop=True)
    step(f"after merging duplicates : {len(work)} unique structures")
else:
    work["all_names"] = work["name"]
    work["n_merged"] = 1

# ---- descriptor block, fully specified -------------------------------------
DESC_NAMES = [n for n, _ in Descriptors._descList
              if n not in set(CONFIG["DROP_DESCRIPTORS"])]
DESC_FUNCS = dict(Descriptors._descList)
step(f"descriptor block         : RDKit Descriptors._descList, "
     f"{len(DESC_NAMES)} descriptors, excluding {CONFIG['DROP_DESCRIPTORS']}")


# --- the four named families from Part 14 of your notebooks ------------------
# Same family names and the same column names, so you can read this against the
# notebook you already know. Two deliberate changes, both noted in the header:
#   * Part 14's molecular_volume() and surface_area() both return
#     CalcExactMolWt, which its own comment calls a placeholder. Here the real
#     quantities are computed.
#   * The 3D family needs a conformer, so it is behind a CONFIG switch.

def family_topological(mol):
    """Wiener, Zagreb, TPSA, Balaban, Kappa 1-3 (Part 14, topological cell)."""
    adj = rdmolops.GetAdjacencyMatrix(mol)
    try:
        w = float(nx.wiener_index(nx.Graph(adj)))
        if not np.isfinite(w):
            w = np.nan              # a disconnected graph has no finite index
    except Exception:                                    # noqa: BLE001
        w = np.nan
    degrees = adj.sum(axis=0)
    return {
        "WienerIndex": w,
        "ZagrebIndex": float(np.sum(degrees ** 2)),
        "TPSA_fam": float(Descriptors.TPSA(mol)),
        "BalabanIndex": float(Descriptors.BalabanJ(mol)),
        "Kappa1_fam": float(Descriptors.Kappa1(mol)),
        "Kappa2_fam": float(Descriptors.Kappa2(mol)),
        "Kappa3_fam": float(Descriptors.Kappa3(mol)),
    }


def family_lipinski(mol):
    """The six Lipinski descriptors (Part 14, Lipinski cell)."""
    return {
        "MolecularWeight": float(Descriptors.MolWt(mol)),
        "LogP": float(Descriptors.MolLogP(mol)),
        "NumHDonors_fam": float(Descriptors.NumHDonors(mol)),
        "NumHAcceptors_fam": float(Descriptors.NumHAcceptors(mol)),
        "NumRotatableBonds_fam": float(Descriptors.NumRotatableBonds(mol)),
        "NumRings": float(Descriptors.RingCount(mol)),
    }


def family_qed(mol):
    """Drug-likeness, 0 to 1 (Part 14, QED cell)."""
    try:
        return {"QED_score": float(QED.qed(mol))}
    except Exception:                                    # noqa: BLE001
        return {"QED_score": np.nan}


def family_3d(mol):
    """Volume, solvent-accessible surface area, radius of gyration."""
    out = {"MolecularVolume": np.nan, "SurfaceArea": np.nan,
           "RadiusOfGyration": np.nan}
    try:
        mh = Chem.AddHs(Chem.Mol(mol))
        if AllChem.EmbedMolecule(mh, randomSeed=SEED) != 0:
            return out                       # embedding failed, so refuse all 3
        try:
            AllChem.MMFFOptimizeMolecule(mh, maxIters=500)
        except Exception:                                # noqa: BLE001
            pass                             # unminimised geometry still usable
        out["MolecularVolume"] = float(AllChem.ComputeMolVolume(mh))
        try:
            radii = rdFreeSASA.classifyAtoms(mh)
            out["SurfaceArea"] = float(rdFreeSASA.CalcSASA(mh, radii))
        except Exception:                                # noqa: BLE001
            out["SurfaceArea"] = float(Descriptors.LabuteASA(mol))
        out["RadiusOfGyration"] = float(rdMolDescriptors.CalcRadiusOfGyration(mh))
    except Exception:                                    # noqa: BLE001
        pass
    return out


def named_families(mol):
    d = {}
    d.update(family_topological(mol))
    d.update(family_lipinski(mol))
    d.update(family_qed(mol))
    if CONFIG["COMPUTE_3D_DESCRIPTORS"]:
        d.update(family_3d(mol))
    return d


def descriptors_for(mol):
    """The full RDKit block plus the four named families, in one row."""
    out = {}
    for n in DESC_NAMES:
        try:
            v = DESC_FUNCS[n](mol)
            out[n] = float(v) if v is not None else np.nan
        except Exception:                    # noqa: BLE001
            out[n] = np.nan
    out.update(named_families(mol))
    return out


step("named families           : Topological (Wiener, Zagreb, TPSA, Balaban, "
     "Kappa1-3), Lipinski (MW, LogP, HBD, HBA, RotB, Rings), QED"
     + (", 3D (volume, SASA, radius of gyration)"
        if CONFIG["COMPUTE_3D_DESCRIPTORS"]
        else "; 3D family OFF (set COMPUTE_3D_DESCRIPTORS True to switch it on)"))


_n_named = len(named_families(work["mol"].iloc[0])) if len(work) else 0
step(f"descriptor matrix will be : {len(work)} molecules x "
     f"{len(DESC_NAMES) + _n_named} descriptors "
     f"({len(DESC_NAMES)} from the RDKit block + {_n_named} from the named "
     "families), computed per subset so nothing is calculated twice")

# ---- Morgan fingerprints and the Tanimoto matrix ---------------------------
mgen = rdFingerprintGenerator.GetMorganGenerator(
    radius=CONFIG["MORGAN_RADIUS"], fpSize=CONFIG["MORGAN_NBITS"])
work["fp"] = [mgen.GetFingerprint(m) for m in work["mol"]]
step(f"Morgan fingerprints      : radius {CONFIG['MORGAN_RADIUS']}, "
     f"{CONFIG['MORGAN_NBITS']} bits (rdFingerprintGenerator)")


def tanimoto_matrix(fps):
    n = len(fps)
    M = np.eye(n)
    for i in range(n):
        if i + 1 < n:
            sims = DataStructs.BulkTanimotoSimilarity(fps[i], list(fps[i + 1:]))
            M[i, i + 1:] = sims
            M[i + 1:, i] = sims
    return M


# ---- Bemis-Murcko scaffolds ------------------------------------------------
def scaffold_of(mol):
    try:
        s = MurckoScaffold.MurckoScaffoldSmiles(mol=mol, includeChirality=False)
        return s if s else "ACYCLIC"
    except Exception:                        # noqa: BLE001
        return "UNRESOLVED"


work["scaffold"] = [scaffold_of(m) for m in work["mol"]]
step(f"Bemis-Murcko scaffolds   : {work['scaffold'].nunique()} distinct "
     f"over {len(work)} molecules "
     f"({int((work['scaffold'] == 'ACYCLIC').sum())} acyclic)")


# =============================================================================
# 3. CONGENERIC SERIES - Tanimoto similarity matrix + hierarchical clustering
#    This produces the grouping variable used by the scaffold split (principle 2)
#    and by the conditional routing (section 9).
# =============================================================================

banner("CONGENERIC SERIES: TANIMOTO MATRIX + HIERARCHICAL CLUSTERING")

# --- the drug-likeness floor, for the plasma set only ----------------------
# Size is what actually separates the solvents and industrial poisons in this
# compilation from the drugs. See the long note in CONFIG["SCHULZ"].
if DATASET == "schulz_plasma" and CONFIG["SCHULZ"]["SUBSET"] == "drug_like":
    _floor = int(CONFIG["SCHULZ"]["MIN_HEAVY_ATOMS"])
    _hac = np.array([m.GetNumHeavyAtoms() for m in work["mol"]])
    _keep = _hac >= _floor
    _dropped = work.loc[~_keep].copy()
    _dropped_lab = _dropped[_dropped["log_ti"].notna()]
    work = work.loc[_keep].reset_index(drop=True)
    step(f"drug-likeness floor: dropped {int((~_keep).sum())} molecules with "
         f"fewer than {_floor} heavy atoms, {len(_dropped_lab)} of which carried "
         "an index")
    if len(_dropped_lab):
        for _, _r in _dropped_lab.sort_values("log_ti", ascending=False).iterrows():
            step(f"    {_r['name']}: index {_r['log_ti']:.3f}, "
                 f"{_r['mol'].GetNumHeavyAtoms()} heavy atoms, "
                 f"in DrugBank dump: {_r.get('in_drugbank')}")
    print(f"\n  CONFIG['SCHULZ']['SUBSET'] is 'drug_like'. Set it to 'all' and "
          "run again to get the sensitivity check, then compare the two with "
          "the helper at the end.")
    print("  READ THIS WHEN YOU COMPARE THEM: the molecules this floor removes "
          "are not a random subset. They are systematically smaller and simpler "
          "than the drugs, so any difference between the two runs is confounded "
          "with molecular size. It is not 'the effect of including solvents'.")
elif DATASET == "schulz_plasma":
    print("\n  CONFIG['SCHULZ']['SUBSET'] is 'all': no drug-likeness floor. "
          "This is the sensitivity run. The solvents and industrial poisons are "
          "included, and they sit outside drug-like space, so expect the "
          "applicability domain to be wider and the statistics to shift for "
          "reasons that are about size as much as about chemistry.")

labelled = work[work["log_ti"].notna()].copy().reset_index(drop=True)
unlabelled = work[work["log_ti"].isna()].copy().reset_index(drop=True)
N_LABELLED = len(labelled)
step(f"labelled molecules (modelling set) : {N_LABELLED}")
step(f"unlabelled molecules (ranking set) : {len(unlabelled)}")

if N_LABELLED < 3:
    raise SystemExit(
        f"\nSTOP. Only {N_LABELLED} molecule(s) have both a usable SMILES and a "
        "Log Therapeutic Index. Nothing can be modelled or validated from that. "
        "Fill in Minimum Therapeutic Level and Minimum Toxic Level for more drugs "
        "and run again. No model, no statistics and no ranking are produced, by "
        "design: the alternative would be to invent data."
    )

Tm = tanimoto_matrix(list(labelled["fp"]))
D = np.clip(1.0 - Tm, 0.0, 1.0)
np.fill_diagonal(D, 0.0)
D = (D + D.T) / 2.0
Z = linkage(squareform(D, checks=False), method="average")
clusters = fcluster(Z, t=1.0 - CONFIG["TANIMOTO_SERIES_CUTOFF"],
                    criterion="distance")
labelled["tanimoto_cluster"] = clusters

# series = scaffold, then split further by Tanimoto cluster
labelled["series_id"] = (labelled["scaffold"].astype(str) + "__c"
                         + labelled["tanimoto_cluster"].astype(str))
n_series = labelled["series_id"].nunique()
iu = np.triu_indices(len(Tm), k=1)
step(f"linkage                  : average, distance = 1 - Tanimoto")
step(f"series cutoff            : Tanimoto >= {CONFIG['TANIMOTO_SERIES_CUTOFF']}")
step(f"congeneric series found  : {n_series} over {N_LABELLED} labelled molecules")
if len(iu[0]):
    step(f"pairwise Tanimoto        : mean {Tm[iu].mean():.3f}, "
         f"max {Tm[iu].max():.3f}, min {Tm[iu].min():.3f}")
sizes = labelled["series_id"].value_counts()
step(f"largest series size      : {int(sizes.iloc[0])}  "
     f"(a series needs >= {CONFIG['MIN_SERIES_N']} to get its own model)")
pd.DataFrame(Tm, index=labelled["name"], columns=labelled["name"]).to_csv(
    f"{CONFIG['OUT_PREFIX']}_tanimoto_matrix.csv")
step(f"wrote {CONFIG['OUT_PREFIX']}_tanimoto_matrix.csv")
if HAVE_MPL and len(labelled) >= 3:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from scipy.cluster.hierarchy import dendrogram
        fig, ax = plt.subplots(figsize=(10, max(3, 0.28 * len(labelled))))
        dendrogram(Z, labels=list(labelled["name"]), orientation="right", ax=ax)
        ax.set_xlabel("1 - Tanimoto (average linkage)")
        ax.set_title("Congeneric series of the labelled set")
        fig.tight_layout()
        fig.savefig(f"{CONFIG['OUT_PREFIX']}_dendrogram.png", dpi=150)
        plt.close(fig)
        step(f"wrote {CONFIG['OUT_PREFIX']}_dendrogram.png")
    except Exception as exc:                 # noqa: BLE001
        step(f"dendrogram skipped ({exc})")


# =============================================================================
# 4. DRUG-LIKENESS AND THE PFIZER 3/75 TOXICITY FILTER  (deck slides 6 and 7)
#    Pfizer 3/75: ClogP > 3 AND TPSA < 75 marks elevated in vivo toxicity risk
#    (Hughes et al., Bioorg Med Chem Lett 2008;18(17):4872-5). [verify this
#    citation against the paper before quoting it in writing]
# =============================================================================

banner("DRUG-LIKENESS AND PFIZER 3/75 TOXICITY FLAGS")


def rule_flags(mol):
    """Never let one pathological molecule abort a run over 1,000 molecules."""
    def _d(fn, default=np.nan):
        try:
            return float(fn(mol))
        except Exception:                    # noqa: BLE001
            return default
    logp = _d(Descriptors.MolLogP)
    tpsa = _d(Descriptors.TPSA)
    mw = _d(Descriptors.MolWt)
    hbd = _d(Descriptors.NumHDonors, 0.0)
    hba = _d(Descriptors.NumHAcceptors, 0.0)
    rotb = _d(Descriptors.NumRotatableBonds, 0.0)
    if not (np.isfinite(logp) and np.isfinite(tpsa)):
        return {"MolLogP": logp, "TPSA": tpsa, "MolWt": mw,
                "ro5_violations": np.nan, "ro3_violations": np.nan,
                "pfizer_3_75_flag": False}
    ro5 = sum([mw > 500, logp > 5, hbd > 5, hba > 10])
    ro3 = sum([mw > 300, logp > 3, hbd > 3, hba > 3, rotb > 3])
    return {
        "MolLogP": logp, "TPSA": tpsa, "MolWt": mw,
        "ro5_violations": ro5, "ro3_violations": ro3,
        "pfizer_3_75_flag": bool(logp > 3 and tpsa < 75),
    }


for frame in (labelled, unlabelled):
    if len(frame):
        flags = pd.DataFrame([rule_flags(m) for m in frame["mol"]])
        for c in flags.columns:
            frame[c] = flags[c].values

step(f"labelled set flagged by Pfizer 3/75 : "
     f"{int(labelled['pfizer_3_75_flag'].sum())} of {len(labelled)}")
if len(unlabelled):
    step(f"ranking set flagged by Pfizer 3/75  : "
         f"{int(unlabelled['pfizer_3_75_flag'].sum())} of {len(unlabelled)}")
step(f"labelled rows with >1 Lipinski violation: "
     f"{int((labelled['ro5_violations'] > 1).sum())}")

if CONFIG["PFIZER_FILTER_TRAINING"]:
    before = len(labelled)
    labelled = labelled[~labelled["pfizer_3_75_flag"]].reset_index(drop=True)
    step(f"PFIZER_FILTER_TRAINING is on: dropped {before - len(labelled)} "
         "labelled molecules")
else:
    step("PFIZER_FILTER_TRAINING is off: no labelled molecule is deleted "
         "(the flag is carried as a column instead). At small n, deleting "
         "training rows costs more than it buys.")


# =============================================================================
# 5. OECD PRINCIPLE 2, PART B - THE SPLIT AND THE TUNED, SEEDED ALGORITHM
#    GroupKFold on the congeneric series, so one series never straddles train
#    and test. Nested tuning: the outer loop measures, the inner loop tunes.
# =============================================================================

banner("OECD PRINCIPLE 2 (b) - SCAFFOLD-GROUPED SPLIT AND NESTED TUNING")

# rebuild the descriptor matrix for the (possibly filtered) labelled set
X_all_raw = pd.DataFrame([descriptors_for(m) for m in labelled["mol"]],
                         index=labelled.index).replace([np.inf, -np.inf], np.nan)
y_all = labelled["log_ti"].to_numpy(dtype=float)
groups_all = labelled["series_id"].to_numpy()
n_groups_all = len(np.unique(groups_all))

N = len(labelled)
print(f"\n  modelling set n          : {N}")
print(f"  congeneric series groups : {n_groups_all}")
print(f"  required by CONFIG       : n >= {CONFIG['MIN_TRAIN_N']} and "
      f"groups >= {CONFIG['MIN_GROUPS']}")

# Does this dataset bring its own train/external split? Decided here, because
# the refusal check below reads differently when the split is given to us.
_preset = (labelled["preset_split"] if "preset_split" in labelled.columns
           else pd.Series([None] * len(labelled)))
use_preset = (DATASET == "curated_invitro"
              and CONFIG["CURATED"]["USE_FILE_SPLIT"]
              and _preset.notna().any())

_few_groups = n_groups_all < CONFIG["MIN_GROUPS"]
if _few_groups and use_preset and N >= CONFIG["MIN_TRAIN_N"]:
    print(f"\n  Only {n_groups_all} congeneric series across {N} molecules. For "
          "this dataset that is expected: it IS one congeneric series by "
          "design. The external statistics come from the file's own split, so "
          "the run is not stamped INDICATIVE for the series count alone. What "
          "it does mean is that nothing here says how the model behaves on a "
          "different scaffold.")
underpowered = (N < CONFIG["MIN_TRAIN_N"]) or (_few_groups and not use_preset)
if underpowered:
    msg = textwrap.dedent(f"""
        REFUSAL CHECK TRIPPED
        ---------------------
        n = {N} labelled molecules in {n_groups_all} congeneric series.
        The floor set in CONFIG is n >= {CONFIG['MIN_TRAIN_N']} in
        >= {CONFIG['MIN_GROUPS']} series.

        With n = {N} the statistics below are arithmetic, not evidence: a single
        molecule moving between folds can swing R2 or Q2 by more than the whole
        quantity you are trying to measure. No amount of tuning fixes that.

        What would fix it: more rows with BOTH Minimum Therapeutic Level and
        Minimum Toxic Level filled in. Nothing else.

        Two pieces of arithmetic that say the same thing from other directions,
        for n = {N}:
          * the common 5 observations per descriptor rule of thumb allows
            {N} / 5 = {N // 5} descriptors in total. The descriptor count this
            run actually kept is printed a few lines below; compare them.
          * the applicability domain's own warning limit is h* = 3(p+1)/n. With
            2 descriptors that is 3*3/{N} = {9.0 / max(N, 1):.2f}, and a hat
            value cannot exceed 1, so the leverage test cannot reject anything.
            An applicability domain that rejects nothing is vacuous, not passed.

        And for this endpoint specifically, the provenance problem printed in
        section 1 applies as well: on the project's own worked example the
        "Minimum Toxic Level" is the highest dose studied, which was tolerated.
        So this refusal is not only about sample size.
        """).strip()
    print("\n" + msg)
    if not CONFIG["ALLOW_UNDERPOWERED"]:
        raise SystemExit(
            "\nStopping, as CONFIG['ALLOW_UNDERPOWERED'] is False. No model was "
            "fitted and no ranking was produced. This is the intended behaviour: "
            "the script refuses rather than invents."
        )
    INDICATIVE = True
    print("\n  CONFIG['ALLOW_UNDERPOWERED'] is True, so the run continues and "
          "every number below is stamped INDICATIVE.")


def make_group_cv(n_samples, groups, wanted_folds):
    """GroupKFold where possible, LeaveOneOut where there are too few groups."""
    g = len(np.unique(groups))
    if g >= 2:
        k = int(min(wanted_folds, g))
        if k >= 2:
            return GroupKFold(n_splits=k), f"GroupKFold(n_splits={k}) on series"
    return LeaveOneOut(), "LeaveOneOut (too few series for a grouped split)"


# ---- external hold-out: whole series, never split ---------------------------
if use_preset:
    _pv = _preset.fillna("").astype(str).str.strip().str.lower().to_numpy()
    tr_idx = np.where(_pv == "training")[0]
    te_idx = np.where(_pv == "external")[0]
    has_external = len(te_idx) > 0 and len(tr_idx) >= 3
    step(f"split taken from the file's own 'set' column, not re-made: "
         f"{len(tr_idx)} training, {len(te_idx)} external")
    _other = sorted(set(_pv) - {"training", "external"})
    if _other:
        step(f"rows whose 'set' value is neither training nor external and are "
             f"therefore in NEITHER: {int(np.isin(_pv, _other).sum())} "
             f"(values seen: {_other})")
    if not has_external:
        tr_idx = np.arange(N)
        te_idx = np.array([], dtype=int)
        step("the file's split left too little on one side; falling back to no "
             "external set, and principle 4's external statistics will read "
             "NOT AVAILABLE")
else:
    has_external = n_groups_all >= 4
if (not use_preset) and has_external:
    gss = GroupShuffleSplit(n_splits=1,
                            test_size=CONFIG["EXTERNAL_TEST_FRACTION"],
                            random_state=SEED)
    tr_idx, te_idx = next(gss.split(X_all_raw, y_all, groups=groups_all))
    if len(te_idx) == 0 or len(tr_idx) < 3:
        has_external = False
        tr_idx, te_idx = np.arange(N), np.array([], dtype=int)
        step("external hold-out REFUSED: the grouped split produced an empty "
             "test set or too small a training set.")
    else:
        step(f"external hold-out: GroupShuffleSplit, "
             f"test_size={CONFIG['EXTERNAL_TEST_FRACTION']}, random_state={SEED}")
if (not use_preset) and (not has_external):
    tr_idx = np.arange(N)
    te_idx = np.array([], dtype=int)
    step(f"external hold-out REFUSED: only {n_groups_all} series, so a grouped "
         "hold-out would not be a real external set. Principle 4's external "
         "statistics will be reported as NOT AVAILABLE.")

X_tr_raw, X_te_raw = X_all_raw.iloc[tr_idx], X_all_raw.iloc[te_idx]
y_tr, y_te = y_all[tr_idx], y_all[te_idx]
g_tr = groups_all[tr_idx]
step(f"train: {len(tr_idx)} molecules in {len(np.unique(g_tr))} series | "
     f"test: {len(te_idx)} molecules in "
     f"{len(np.unique(groups_all[te_idx])) if len(te_idx) else 0} series")
if len(te_idx):
    overlap = set(np.unique(g_tr)) & set(np.unique(groups_all[te_idx]))
    if use_preset:
        step(f"series shared between train and test: {len(overlap)}. This split "
             "came from the file, so a non-zero count is the file's own choice, "
             "reported here and NOT silently repaired. Where it is non-zero the "
             "external statistics are optimistic, because a test molecule's own "
             "close analogues are in the training set. Set "
             "CONFIG['CURATED']['USE_FILE_SPLIT'] = False to re-split by series "
             "instead, at the cost of no longer matching the file.")
    else:
        step(f"series shared between train and test: {len(overlap)} "
             f"(must be 0) -> {'OK' if not overlap else 'LEAK'}")

# ---- descriptor pruning, fitted on TRAIN only ------------------------------
keep = [c for c in X_tr_raw.columns if X_tr_raw[c].notna().all()]
dropped_nan = len(X_tr_raw.columns) - len(keep)
sub = X_tr_raw[keep]
keep = [c for c in keep if sub[c].std(ddof=0) > 1e-12]
dropped_const = len(sub.columns) - len(keep)
sub = X_tr_raw[keep]
corr = sub.corr().abs().to_numpy()
drop_corr = set()
for i in range(len(keep)):
    for j in range(i + 1, len(keep)):
        if corr[i, j] > CONFIG["CORR_PRUNE_THRESHOLD"] and keep[j] not in drop_corr:
            drop_corr.add(keep[j])
FEATURES = [c for c in keep if c not in drop_corr]
step(f"descriptor pruning (train only): dropped {dropped_nan} with missing "
     f"values, {dropped_const} constant, {len(drop_corr)} with |r| > "
     f"{CONFIG['CORR_PRUNE_THRESHOLD']} -> {len(FEATURES)} descriptors kept")
if len(FEATURES) == 0:
    raise SystemExit("No usable descriptors survived pruning. Stopping.")
if len(FEATURES) > 3 * max(len(tr_idx), 1):
    step(f"WARNING: {len(FEATURES)} descriptors for {len(tr_idx)} training "
         "molecules. The model is free to fit noise; treat every statistic as "
         "decoration until n grows.")

scaler = StandardScaler().fit(X_tr_raw[FEATURES].to_numpy(dtype=float))
X_tr = scaler.transform(X_tr_raw[FEATURES].to_numpy(dtype=float))
X_te = (scaler.transform(X_te_raw[FEATURES].to_numpy(dtype=float))
        if len(te_idx) else np.empty((0, len(FEATURES))))


# ---- the model space, written out in full (principle 2: unambiguous) --------
def build_model(params):
    fam = params["family"]
    if fam == "ridge":
        return Ridge(alpha=params["alpha"], random_state=SEED)
    if fam == "svr":
        return SVR(C=params["C"], gamma=params["gamma"], epsilon=params["epsilon"],
                   kernel="rbf")
    # Optuna cannot mix types inside one categorical, so depth 0 means "None"
    # and max_features "0.5" means the float 0.5. Decoded here, in one place.
    depth = params["max_depth"]
    depth = None if depth in (0, None) else int(depth)
    mf = params["max_features"]
    mf = 0.5 if str(mf) == "0.5" else mf
    return RandomForestRegressor(
        n_estimators=params["n_estimators"],
        max_depth=depth,
        min_samples_leaf=params["min_samples_leaf"],
        max_features=mf,
        random_state=SEED, n_jobs=-1,
    )


DEFAULT_PARAMS = {"family": "ridge", "alpha": 1.0}
MODEL_SPACE_DOC = {
    "ridge": {"alpha": "log-uniform 1e-3 .. 1e3"},
    "rf": {"n_estimators": "200..800 step 100", "max_depth": "2|4|6|8|12|None",
           "min_samples_leaf": "1..5", "max_features": "sqrt | log2 | 0.5"},
    "svr": {"C": "log-uniform 1e-2 .. 1e3", "gamma": "log-uniform 1e-4 .. 1e0",
            "epsilon": "0.01 .. 0.5"},
}
print("\n  model space searched (all of it, so the algorithm is unambiguous):")
print(textwrap.indent(json.dumps(MODEL_SPACE_DOC, indent=2), "    "))
print(f"    seed fixed at {SEED} for the sampler, the split and every estimator")


def cv_predict(params, X, y, groups, wanted_folds):
    """Out-of-fold predictions under a grouped CV. Returns (pred, scheme)."""
    cv, scheme = make_group_cv(len(y), groups, wanted_folds)
    pred = np.full(len(y), np.nan)
    splitter = (cv.split(X, y, groups=groups)
                if isinstance(cv, GroupKFold) else cv.split(X))
    for tr, te in splitter:
        if len(np.unique(y[tr])) < 2:
            continue
        mdl = build_model(params).fit(X[tr], y[tr])
        pred[te] = mdl.predict(X[te])
    return pred, scheme


def q2_score(y, pred, y_train_mean):
    ok = ~np.isnan(pred)
    if ok.sum() < 3:
        return np.nan
    press = np.sum((y[ok] - pred[ok]) ** 2)
    sstot = np.sum((y[ok] - y_train_mean) ** 2)
    return np.nan if sstot <= 0 else 1.0 - press / sstot


def _suggest_params(trial):
    """The search space, written once, used by every Optuna run."""
    fam = trial.suggest_categorical("family", ["ridge", "rf", "svr"])
    if fam == "ridge":
        return {"family": "ridge",
                "alpha": trial.suggest_float("alpha", 1e-3, 1e3, log=True)}
    if fam == "svr":
        return {"family": "svr",
                "C": trial.suggest_float("C", 1e-2, 1e3, log=True),
                "gamma": trial.suggest_float("gamma", 1e-4, 1e0, log=True),
                "epsilon": trial.suggest_float("epsilon", 0.01, 0.5)}
    return {"family": "rf",
            "n_estimators": trial.suggest_int("n_estimators", 200, 800, step=100),
            "max_depth": trial.suggest_categorical(
                "max_depth", [2, 4, 6, 8, 12, 0]),           # 0 means None
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 1, 5),
            "max_features": trial.suggest_categorical(
                "max_features", ["sqrt", "log2", "0.5"])}


def select_params(X, y, g, n_trials, label):
    """
    Run the hyperparameter search on the data HANDED TO IT and nothing else.
    Keeping this in a function is what makes the nesting real: section 7 calls
    it again inside each outer fold, so the fold used to measure is never part
    of the data used to choose.
    Median pruning is genuine here: the objective reports the running Q2 after
    each inner fold and asks the pruner whether to stop, which is the only way
    an Optuna pruner ever acts. Your deck's slide 11 asks for median pruning.
    """
    if (not HAVE_OPTUNA) or len(y) < 6 or len(np.unique(y)) < 2:
        return dict(DEFAULT_PARAMS), {
            "method": "fixed documented defaults (Ridge, alpha=1.0)",
            "reason": ("optuna unavailable" if not HAVE_OPTUNA else
                       f"only {len(y)} molecules in {label}; a search here "
                       "would fit the folds rather than the chemistry"),
            "best_inner_q2": None, "best_params": dict(DEFAULT_PARAMS),
        }
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial):
        p = _suggest_params(trial)
        cv, _scheme = make_group_cv(len(y), g, CONFIG["N_INNER_FOLDS"])
        splits = (list(cv.split(X, y, groups=g)) if isinstance(cv, GroupKFold)
                  else list(cv.split(X)))
        pred = np.full(len(y), np.nan)
        for i, (tr, te) in enumerate(splits):
            if len(np.unique(y[tr])) < 2:
                continue
            pred[te] = build_model(p).fit(X[tr], y[tr]).predict(X[te])
            running = q2_score(y, pred, float(np.mean(y)))
            if running is not None and not np.isnan(running):
                trial.report(running, i)
                if trial.should_prune():
                    raise optuna.TrialPruned()
        s = q2_score(y, pred, float(np.mean(y)))
        return -1e6 if (s is None or np.isnan(s)) else s

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=SEED),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=1),
    )
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    try:
        bp = dict(study.best_params)
        fam = bp.pop("family")
        chosen = {"family": fam, **bp}
        best_val = float(study.best_value)
    except Exception:                        # every trial pruned or failed
        return dict(DEFAULT_PARAMS), {
            "method": "fixed documented defaults (Ridge, alpha=1.0)",
            "reason": f"no Optuna trial on {label} produced a usable score",
            "best_inner_q2": None, "best_params": dict(DEFAULT_PARAMS),
        }
    n_pruned = sum(1 for t in study.trials
                   if t.state == optuna.trial.TrialState.PRUNED)
    return chosen, {
        "method": f"Optuna TPESampler(seed={SEED}) + MedianPruner"
                  f"(n_startup_trials=5, n_warmup_steps=1), {n_trials} trials",
        "fitted_on": label,
        "inner_cv": f"grouped CV, up to {CONFIG['N_INNER_FOLDS']} folds, on the "
                    "congeneric series of that data only",
        "objective": "inner out-of-fold Q2",
        "trials_pruned": int(n_pruned),
        "best_inner_q2": best_val,
        "best_params": chosen,
    }


best_params, tuning_report = select_params(
    X_tr, y_tr, g_tr, CONFIG["N_OPTUNA_TRIALS"], "the full training set")

print("\n  tuning:")
print(textwrap.indent(json.dumps(tuning_report, indent=2, default=str), "    "))
print(f"  reproducibility: same file + same seed ({SEED}) + same library "
      "versions = same numbers. The versions are printed at the top of this run.")

final_model = build_model(best_params).fit(X_tr, y_tr)
step(f"final model fitted on {len(tr_idx)} training molecules: {best_params}")


# --- the five-model bake-off from Part 15 of your notebooks -----------------
# Part 15 compares Linear Regression, Ridge, Lasso, Random Forest and Gradient
# Boosting with GridSearchCV and keeps the best by MSE. Same five families and
# the same table here. The one change: it runs under the scaffold-grouped CV,
# not Part 15's random 80:20 split, so members of one congeneric series cannot
# sit on both sides of the comparison.

BAKEOFF = {
    "Linear Regression": (LinearRegression(), {}),
    "Ridge Regression": (Ridge(), {"alpha": [0.1, 1.0, 10.0, 100.0]}),
    "Lasso Regression": (Lasso(max_iter=10000),
                         {"alpha": [0.1, 1.0, 10.0, 100.0]}),
    "Random Forest": (RandomForestRegressor(random_state=SEED, n_jobs=-1),
                      {"n_estimators": [50, 100, 200],
                       "max_depth": [None, 10, 20, 30]}),
    "Gradient Boosting": (GradientBoostingRegressor(random_state=SEED),
                          {"n_estimators": [50, 100, 200],
                           "learning_rate": [0.01, 0.1, 0.2],
                           "max_depth": [3, 5, 7]}),
}

print("\n  five-model bake-off, scored by grouped out-of-fold predictions"
      f"{tag()}")
_bo_cv, _bo_scheme = make_group_cv(len(y_tr), g_tr, CONFIG["N_OUTER_FOLDS"])
if isinstance(_bo_cv, GroupKFold):
    _bo_splits = list(_bo_cv.split(X_tr, y_tr, groups=g_tr))
else:
    _bo_splits = list(_bo_cv.split(X_tr))
print(f"  CV for the bake-off: {_bo_scheme}, {len(_bo_splits)} folds")

bakeoff_rows = []
for mname, (est, grid) in BAKEOFF.items():
    try:
        # The grid is chosen INSIDE each outer fold, on inner folds of the
        # training part only. Choosing it once on all the folds and then
        # scoring on those same folds would hand the biggest grids
        # (Gradient Boosting has 27 points, Random Forest 12) a free lift and
        # make the table a contest of grid sizes rather than of models.
        oof = np.full(len(y_tr), np.nan)
        fold_params = []
        for tr, te in _bo_splits:
            if len(np.unique(y_tr[tr])) < 2:
                continue
            if grid and len(np.unique(g_tr[tr])) >= 2:
                _icv, _ = make_group_cv(len(tr), g_tr[tr], CONFIG["N_INNER_FOLDS"])
                _isp = (list(_icv.split(X_tr[tr], y_tr[tr], groups=g_tr[tr]))
                        if isinstance(_icv, GroupKFold)
                        else list(_icv.split(X_tr[tr])))
                if len(_isp) >= 2:
                    s = GridSearchCV(clone(est), grid, cv=_isp,
                                     scoring="neg_mean_squared_error",
                                     n_jobs=1).fit(X_tr[tr], y_tr[tr])
                    fold_est, p_f = s.best_estimator_, s.best_params_
                else:
                    fold_est, p_f = clone(est), {}
            else:
                fold_est, p_f = clone(est), {}
            fold_params.append(p_f)
            oof[te] = clone(fold_est).fit(X_tr[tr], y_tr[tr]).predict(X_tr[te])
        chosen_params = {"per_fold": fold_params}
        ok = ~np.isnan(oof)
        bakeoff_rows.append({
            "Model": mname,
            "best_params": json.dumps(chosen_params, default=str),
            "MeanSquaredError_oof": (float(mean_squared_error(y_tr[ok], oof[ok]))
                                     if ok.sum() else np.nan),
            "R2_oof": (float(r2_score(y_tr[ok], oof[ok]))
                       if ok.sum() >= 3 else np.nan),
            "Q2_oof": q2_score(y_tr, oof, float(np.mean(y_tr))),
            "n_scored": int(ok.sum()),
        })
    except Exception as exc:                 # noqa: BLE001
        bakeoff_rows.append({"Model": mname, "best_params": "",
                             "MeanSquaredError_oof": np.nan, "R2_oof": np.nan,
                             "Q2_oof": np.nan, "n_scored": 0,
                             "error": str(exc)[:120]})

bakeoff_df = pd.DataFrame(bakeoff_rows)
print(textwrap.indent(bakeoff_df.to_string(index=False), "    "))
bakeoff_df.to_csv(f"{CONFIG['OUT_PREFIX']}_model_performance_metrics.csv",
                  index=False)
step(f"wrote {CONFIG['OUT_PREFIX']}_model_performance_metrics.csv")
print("\n  Note: these MSE and R2 figures are OUT-OF-FOLD under the grouped CV, "
      "so they are not comparable with the in-sample figures Part 15 prints. "
      "Out-of-fold numbers are lower and more honest.")
print("  The model carried forward is the Optuna-tuned one above, not the "
      "bake-off winner, because the bake-off is a comparison and the Optuna "
      "search is nested. If a bake-off family clearly beats it, say so and I "
      "will swap the search space over.")


# =============================================================================
# 6. OECD PRINCIPLE 3 - A DEFINED DOMAIN OF APPLICABILITY
#    Three tests, all fitted on the training set only:
#      (a) percentile bounding box over the kept descriptors (deck slide 13)
#      (b) hat leverage, warning limit h* = 3(p+1)/n          (deck slide 13)
#      (c) Tanimoto similarity to the nearest training neighbour
#    A molecule outside the domain gets NO prediction. It is refused.
# =============================================================================

banner("OECD PRINCIPLE 3 - APPLICABILITY DOMAIN (and explicit refusal)")

lo_p, hi_p = CONFIG["AD_BOX_PERCENTILES"]
box_lo = np.percentile(X_tr, lo_p, axis=0)
box_hi = np.percentile(X_tr, hi_p, axis=0)
p_feat = X_tr.shape[1]
n_tr = X_tr.shape[0]
h_star = 3.0 * (p_feat + 1) / max(n_tr, 1)
XtX_inv = np.linalg.pinv(X_tr.T @ X_tr)
_rank = int(np.linalg.matrix_rank(X_tr)) if n_tr else 0
train_fps = list(labelled["fp"].iloc[tr_idx])

step(f"bounding box  : percentiles {lo_p} to {hi_p} of each of the "
     f"{p_feat} kept descriptors, on the training set")
step(f"leverage      : h* = 3(p+1)/n = 3*({p_feat}+1)/{n_tr} = {h_star:.3f}")
step(f"similarity    : nearest training neighbour Tanimoto >= "
     f"{CONFIG['TANIMOTO_AD_CUTOFF']}")
if h_star >= 1.0:
    step("NOTE: h* >= 1, which means the leverage test cannot reject anything. "
         "That happens when there are more descriptors than molecules. Read it "
         "as 'this test is switched off by the data', not as 'all is well'.")
if _rank < p_feat:
    step(f"WARNING: rank(X_train) = {_rank} < p = {p_feat}, so X'X is singular "
         "and the leverage runs through a pseudo-inverse. It then measures only "
         f"the part of a molecule that lies in the {_rank} directions the "
         "training set actually varies in, and scores a molecule that is novel "
         f"in the other {p_feat - _rank} directions as LOW leverage. Treat the "
         "leverage leg as switched off by the data; the box and the Tanimoto "
         "floor are doing the work.")


def domain_check(x_scaled, fp):
    # NaN compares False against both bounds, so without the isfinite test a
    # descriptor that could not be computed would count as INSIDE the box.
    out_of_box = [FEATURES[i] for i in range(p_feat)
                  if (not np.isfinite(x_scaled[i]))
                  or x_scaled[i] < box_lo[i] or x_scaled[i] > box_hi[i]]
    # X_tr is centred by the scaler and carries no column of ones, so the 1/n
    # term that belongs to the intercept has to be added back by hand. h* below
    # counts p+1 parameters, so leaving it out would make the test too lenient.
    h = 1.0 / max(n_tr, 1) + float(x_scaled @ XtX_inv @ x_scaled.T)
    sims = DataStructs.BulkTanimotoSimilarity(fp, train_fps)
    max_sim = float(max(sims)) if sims else 0.0
    ok_box = len(out_of_box) == 0
    ok_lev = h <= h_star
    ok_sim = max_sim >= CONFIG["TANIMOTO_AD_CUTOFF"]
    in_domain = (ok_box and ok_lev and ok_sim) if CONFIG["AD_REQUIRE_ALL"] \
        else (sum([ok_box, ok_lev, ok_sim]) >= 2)
    reasons = []
    if not ok_box:
        reasons.append(f"outside the box on {len(out_of_box)} descriptor(s): "
                       + ", ".join(out_of_box[:4])
                       + ("..." if len(out_of_box) > 4 else ""))
    if not ok_lev:
        reasons.append(f"leverage {h:.3f} > h* {h_star:.3f}")
    if not ok_sim:
        reasons.append(f"nearest training neighbour Tanimoto {max_sim:.3f} < "
                       f"{CONFIG['TANIMOTO_AD_CUTOFF']}")
    return {"in_domain": bool(in_domain), "leverage": h,
            "max_tanimoto_to_train": max_sim,
            "n_descriptors_out_of_box": len(out_of_box),
            "out_of_domain_reason": "; ".join(reasons) if reasons else ""}


if len(te_idx):
    te_dom = [domain_check(X_te[i], labelled["fp"].iloc[te_idx[i]])
              for i in range(len(te_idx))]
    n_in = sum(d["in_domain"] for d in te_dom)
    step(f"external test set: {n_in} of {len(te_idx)} molecules in domain")
else:
    te_dom = []

# --- the watch list: named molecules, followed between the two subsets ------
# These are the influential ones. Printing their domain status in every run
# turns "the solvents stretch the domain" from an argument into a number you
# can read off both runs and compare.
_watch = CONFIG["SCHULZ"]["WATCH"] if DATASET == "schulz_plasma" else []
if _watch:
    print("\n  watch list, in this run "
          f"(subset = {CONFIG['SCHULZ']['SUBSET']}):")
    _lname = labelled["name"].astype(str).str.strip().str.lower()
    _found = 0
    for _w in _watch:
        _hits = np.where(_lname.to_numpy() == _w.strip().lower())[0]
        if not len(_hits):
            print(f"    {_w:<26} not in this subset")
            continue
        _found += 1
        _i = int(_hits[0])
        _where = ("train" if _i in set(tr_idx.tolist())
                  else "external test" if _i in set(te_idx.tolist()) else "neither")
        _xr = X_all_raw.iloc[_i][FEATURES].to_numpy(dtype=float)
        if np.isnan(_xr).any():
            print(f"    {_w:<26} index {labelled['log_ti'].iloc[_i]:>7.3f}  "
                  f"{_where:<14} REFUSED, a descriptor is undefined")
            continue
        _d = domain_check(scaler.transform(_xr.reshape(1, -1))[0],
                          labelled["fp"].iloc[_i])
        print(f"    {_w:<26} index {labelled['log_ti'].iloc[_i]:>7.3f}  "
              f"{_where:<14} "
              f"{'IN domain' if _d['in_domain'] else 'OUT of domain'}  "
              f"leverage {_d['leverage']:.3f}, nearest-neighbour Tanimoto "
              f"{_d['max_tanimoto_to_train']:.3f}, "
              f"{_d['n_descriptors_out_of_box']} descriptors outside the box")
    print(f"    ({_found} of {len(_watch)} present in this subset)")


# =============================================================================
# 7. OECD PRINCIPLE 4 - GOODNESS-OF-FIT, ROBUSTNESS, PREDICTIVITY
#    Each statistic is printed with its name, its value, the threshold from your
#    flowchart, and a PASS/FAIL. Formulae are written out so they can be checked.
# =============================================================================

banner("OECD PRINCIPLE 4 - FIT, ROBUSTNESS AND PREDICTIVITY")


def r2_pearson_sq(y, p):
    ok = ~(np.isnan(y) | np.isnan(p))
    if ok.sum() < 3 or np.std(y[ok]) == 0 or np.std(p[ok]) == 0:
        return np.nan
    r, _ = pearsonr(y[ok], p[ok])
    return float(r ** 2)


def r2_determination(y, p):
    """Classic 1 - SSE/SST against the mean of y."""
    ok = ~(np.isnan(y) | np.isnan(p))
    if ok.sum() < 3:
        return np.nan
    sse = np.sum((y[ok] - p[ok]) ** 2)
    sst = np.sum((y[ok] - np.mean(y[ok])) ** 2)
    return np.nan if sst <= 0 else float(1.0 - sse / sst)


def rm2_pair(y_obs, y_pred):
    """
    Roy's rm2 metrics.
      r2   = squared Pearson correlation of observed vs predicted
      k    = sum(obs*pred)/sum(obs^2)      (regression through the origin)
      r02  = 1 - sum((pred - k*obs)^2) / sum((pred - mean(pred))^2)
      rm2  = r2 * (1 - sqrt(|r2 - r02|))
    and the primed versions with the axes swapped. Returns
    (rm2, rm2_prime, avg_rm2, delta_rm2).
    """
    ok = ~(np.isnan(y_obs) | np.isnan(y_pred))
    yo, yp = y_obs[ok], y_pred[ok]
    if len(yo) < 3 or np.std(yo) == 0 or np.std(yp) == 0:
        return (np.nan,) * 4
    r2 = r2_pearson_sq(yo, yp)
    denom_p = np.sum((yp - np.mean(yp)) ** 2)
    denom_o = np.sum((yo - np.mean(yo)) ** 2)
    if denom_p <= 0 or denom_o <= 0 or np.sum(yo ** 2) == 0 or np.sum(yp ** 2) == 0:
        return (np.nan,) * 4
    k = np.sum(yo * yp) / np.sum(yo ** 2)
    r02 = 1.0 - np.sum((yp - k * yo) ** 2) / denom_p
    k_prime = np.sum(yo * yp) / np.sum(yp ** 2)
    r02_prime = 1.0 - np.sum((yo - k_prime * yp) ** 2) / denom_o
    rm2 = r2 * (1.0 - math.sqrt(abs(r2 - r02)))
    rm2p = r2 * (1.0 - math.sqrt(abs(r2 - r02_prime)))
    return float(rm2), float(rm2p), float((rm2 + rm2p) / 2.0), float(abs(rm2 - rm2p))


def ccc(y, p):
    """Lin's concordance correlation coefficient (Chirico & Gramatica 2011)."""
    ok = ~(np.isnan(y) | np.isnan(p))
    yo, yp = y[ok], p[ok]
    if len(yo) < 3:
        return np.nan
    cov = np.mean((yo - yo.mean()) * (yp - yp.mean()))
    den = yo.var() + yp.var() + (yo.mean() - yp.mean()) ** 2
    return np.nan if den <= 0 else float(2.0 * cov / den)


def rmse(y, p):
    ok = ~(np.isnan(y) | np.isnan(p))
    return np.nan if ok.sum() == 0 else float(
        math.sqrt(np.mean((y[ok] - p[ok]) ** 2)))


def mae(y, p):
    ok = ~(np.isnan(y) | np.isnan(p))
    return np.nan if ok.sum() == 0 else float(np.mean(np.abs(y[ok] - p[ok])))


results = {}

# ---- (a) goodness-of-fit: the model against its own training data -----------
fit_pred = final_model.predict(X_tr)
results["R2_fit_train"] = r2_determination(y_tr, fit_pred)
results["RMSE_fit_train"] = rmse(y_tr, fit_pred)
results["MAE_fit_train"] = mae(y_tr, fit_pred)

# ---- (b) robustness: grouped out-of-fold CV and LOO -------------------------
#      This is the nesting, done properly: the hyperparameters are chosen again
#      from scratch inside each outer fold, so the molecules used to measure
#      were never involved in choosing. Running the search once on the whole
#      training set and then reporting its own CV score would be reporting the
#      maximum of a 60-trial search as if it were validation.
_cv_outer, oof_scheme = make_group_cv(len(y_tr), g_tr, CONFIG["N_OUTER_FOLDS"])
_outer_splits = (list(_cv_outer.split(X_tr, y_tr, groups=g_tr))
                 if isinstance(_cv_outer, GroupKFold)
                 else list(_cv_outer.split(X_tr)))
oof_pred = np.full(len(y_tr), np.nan)
_nested_choices = []
_trials_per_fold = max(10, CONFIG["N_OPTUNA_TRIALS"] // max(len(_outer_splits), 1))
for _k, (_tr, _te) in enumerate(_outer_splits):
    if len(np.unique(y_tr[_tr])) < 2:
        continue
    _p_k, _rep_k = select_params(X_tr[_tr], y_tr[_tr], g_tr[_tr],
                                 _trials_per_fold, f"outer fold {_k + 1}")
    oof_pred[_te] = (build_model(_p_k).fit(X_tr[_tr], y_tr[_tr])
                     .predict(X_tr[_te]))
    _nested_choices.append({"fold": _k + 1, "params": _p_k,
                            "inner_q2": _rep_k.get("best_inner_q2")})
results["CV_scheme"] = (f"{oof_scheme}, with the search re-run inside each of "
                        f"{len(_outer_splits)} outer folds "
                        f"({_trials_per_fold} trials per fold)")
results["Q2_grouped_CV_nested"] = q2_score(y_tr, oof_pred, float(np.mean(y_tr)))
results["Q2_grouped_CV"] = results["Q2_grouped_CV_nested"]
results["RMSE_grouped_CV"] = rmse(y_tr, oof_pred)
results["nested_fold_choices"] = _nested_choices
print("  hyperparameters chosen separately in each outer fold:")
for _c in _nested_choices:
    print(f"    fold {_c['fold']}: {_c['params']}  (inner Q2 "
          f"{_c['inner_q2'] if _c['inner_q2'] is None else round(_c['inner_q2'], 4)})")
if len({json.dumps(c["params"], sort_keys=True, default=str)
        for c in _nested_choices}) > 1:
    print("    The folds do not agree on the model. At this n that is expected, "
          "and it is itself a result: the data does not determine the model.")

loo_pred = np.full(len(y_tr), np.nan)
for tr, te in LeaveOneOut().split(X_tr):
    if len(np.unique(y_tr[tr])) < 2:
        continue
    loo_pred[te] = build_model(best_params).fit(X_tr[tr], y_tr[tr]).predict(X_tr[te])
results["Q2_LOO"] = q2_score(y_tr, loo_pred, float(np.mean(y_tr)))
rm2_loo = rm2_pair(y_tr, loo_pred)
results["avg_rm2_LOO"] = rm2_loo[2]
results["delta_rm2_LOO"] = rm2_loo[3]
results["CCC_LOO"] = ccc(y_tr, loo_pred)
results["RMSE_LOO"] = rmse(y_tr, loo_pred)

# Leave-one-SERIES-out. Plain leave-one-out holds out one molecule but leaves
# its own congeneric analogues in the training fold, which is the very leak
# your slide 9 scaffold split exists to stop. So the same four statistics are
# computed again with a whole series held out each time, and it is THESE that
# are graded against your flowchart's thresholds. The plain LOO numbers are
# kept beside them, labelled, for comparability with the flowchart's wording.
logo_pred = np.full(len(y_tr), np.nan)
if len(np.unique(g_tr)) >= 2:
    for _tr, _te in LeaveOneGroupOut().split(X_tr, y_tr, groups=g_tr):
        if len(np.unique(y_tr[_tr])) < 2:
            continue
        logo_pred[_te] = (build_model(best_params).fit(X_tr[_tr], y_tr[_tr])
                          .predict(X_tr[_te]))
    results["Q2_LOGO"] = q2_score(y_tr, logo_pred, float(np.mean(y_tr)))
    rm2_logo = rm2_pair(y_tr, logo_pred)
    results["avg_rm2_LOGO"] = rm2_logo[2]
    results["delta_rm2_LOGO"] = rm2_logo[3]
    results["CCC_LOGO"] = ccc(y_tr, logo_pred)
    results["RMSE_LOGO"] = rmse(y_tr, logo_pred)
    results["n_series_held_out_one_at_a_time"] = int(len(np.unique(g_tr)))
else:
    for k in ("Q2_LOGO", "avg_rm2_LOGO", "delta_rm2_LOGO", "CCC_LOGO",
              "RMSE_LOGO"):
        results[k] = np.nan
    step("leave-one-series-out not possible: the training set has fewer than "
         "two congeneric series")

# the internal prediction vector used from here on: the series-grouped one
# where it exists, plain LOO otherwise, and the choice is recorded
if np.isfinite(logo_pred).any():
    internal_pred = logo_pred
    results["internal_prediction_scheme"] = "leave-one-series-out"
else:
    internal_pred = loo_pred
    results["internal_prediction_scheme"] = "leave-one-molecule-out"
print("\n  Three caveats on the internal numbers, stated rather than buried:")
print("   1. The graded rows are the series-grouped ones (Q2_LOGO, "
      "avg_rm2_LOGO, delta_rm2_LOGO): one whole congeneric series is held out "
      "at a time. The plain leave-one-molecule-out numbers your flowchart "
      "names are reported too, just below, but they leave a molecule's own "
      "analogues in the training fold, so they read high.")
print("   2. Both of those use the single parameter set chosen on the whole "
      "training set. They therefore carry a little selection optimism. "
      "Q2_grouped_CV_nested above does not: it is the honest one. Where the "
      "two disagree, believe the nested one.")
print("   3. The descriptor pruning and the scaler are fitted on the whole "
      "training set, once, not inside each fold. At this n, refitting them per "
      "fold changes which descriptors survive from fold to fold and makes the "
      "folds incomparable. The cost is a small optimistic bias, named here.")

# ---- (c) y-randomisation / y-scrambling, and cRp2 ---------------------------
rng = np.random.default_rng(SEED)
_r2_fit = results.get("R2_fit_train", np.nan)
if _r2_fit is None:
    _r2_fit = np.nan

def _abs_pearson(a, b):
    """|r| between two vectors, 0 if either is constant."""
    ok = ~(np.isnan(a) | np.isnan(b))
    if ok.sum() < 3 or np.std(a[ok]) == 0 or np.std(b[ok]) == 0:
        return 0.0
    return float(abs(pearsonr(a[ok], b[ok])[0]))


# cRp2 = R * sqrt( R^2 - (mean Rr)^2 )   (Roy's corrected Rp^2, threshold 0.5)
# Two things that are easy to get wrong and are done deliberately here:
#   * R is the CORRELATION COEFFICIENT between observed and fitted values, not
#     sqrt(1 - SSE/SST). For Ridge, SVR and a random forest the fitted values
#     carry a bias and a slope away from 1, so the two differ, and 1 - SSE/SST
#     can even go negative, which would silently collapse cRp2 to zero.
#   * the term subtracted is the SQUARE OF THE MEAN of the randomised models'
#     correlation coefficients, not the mean of their squares. Those are not
#     equal (Jensen), and using the mean of squares biases cRp2 downwards by
#     the spread of the scrambled runs, which at n = 19 is large.
r_true = _abs_pearson(y_tr, fit_pred)
scr_r2, scr_r, scr_q2 = [], [], []
for _ in range(CONFIG["N_Y_SCRAMBLE"]):
    y_shuf = y_tr.copy()
    rng.shuffle(y_shuf)                      # y shuffled, X untouched
    m = build_model(best_params).fit(X_tr, y_shuf)   # refitted from scratch
    p_fit_s = m.predict(X_tr)
    scr_r2.append(r2_determination(y_shuf, p_fit_s))
    scr_r.append(_abs_pearson(y_shuf, p_fit_s))
    p_s, _ = cv_predict(best_params, X_tr, y_shuf, g_tr, CONFIG["N_OUTER_FOLDS"])
    scr_q2.append(q2_score(y_shuf, p_s, float(np.mean(y_shuf))))
scr_r2 = np.array([v for v in scr_r2 if v is not None and not np.isnan(v)])
scr_r = np.array([v for v in scr_r if v is not None and not np.isnan(v)])
scr_q2 = np.array([v for v in scr_q2 if v is not None and not np.isnan(v)])
results["mean_R2_y_scrambled"] = float(scr_r2.mean()) if scr_r2.size else np.nan
results["mean_r_y_scrambled"] = float(scr_r.mean()) if scr_r.size else np.nan
results["mean_Q2_y_scrambled"] = float(scr_q2.mean()) if scr_q2.size else np.nan
results["R_fit_pearson"] = r_true
if scr_r.size and r_true > 0:
    inner = r_true ** 2 - float(scr_r.mean()) ** 2
    results["cRp2"] = float(r_true * math.sqrt(inner)) if inner > 0 else 0.0
else:
    results["cRp2"] = np.nan
results["n_y_scramble_runs"] = int(CONFIG["N_Y_SCRAMBLE"])

# ---- (d) external predictivity ----------------------------------------------
if len(te_idx):
    # A descriptor kept because it was finite on all TRAINING molecules can
    # still be NaN on a test molecule (Gasteiger charges and the BCUT2D family
    # fail on unparameterised atoms, e.g. a platinum or lithium salt). The
    # scaler lets NaN through; predict() would raise. So guard, and refuse.
    te_nan = np.isnan(X_te).any(axis=1)
    te_pred_all = np.full(len(te_idx), np.nan, dtype=float)
    if (~te_nan).any():
        te_pred_all[~te_nan] = final_model.predict(X_te[~te_nan])
    if te_nan.any():
        step(f"{int(te_nan.sum())} external-test molecule(s) refused: a kept "
             "descriptor is undefined for them")
    in_dom_mask = np.array([d["in_domain"] for d in te_dom], dtype=bool)
    in_dom_mask &= ~te_nan
    # te_pred is the vector the model STANDS BEHIND: out-of-domain removed.
    # Every statistic that is graded against your flowchart uses this one, so
    # the model is never credited for a prediction it has just refused.
    te_pred = te_pred_all.copy()
    te_pred[~in_dom_mask] = np.nan
    results["n_external"] = int(len(te_idx))
    results["n_external_in_domain"] = int(in_dom_mask.sum())
    results["R2pred_Q2F1_in_domain"] = q2_score(y_te, te_pred, float(np.mean(y_tr)))
    rm2_te = rm2_pair(y_te, te_pred)
    results["avg_rm2_test"] = rm2_te[2]
    results["delta_rm2_test"] = rm2_te[3]
    results["CCC_test"] = ccc(y_te, te_pred)
    results["RMSE_test"] = rmse(y_te, te_pred)
    results["MAE_test"] = mae(y_te, te_pred)
    # the same five on ALL test molecules, in-domain or not, kept separately so
    # the two populations are never mixed in one table
    results["R2pred_Q2F1_all_test"] = q2_score(y_te, te_pred_all,
                                               float(np.mean(y_tr)))
    rm2_te_all = rm2_pair(y_te, te_pred_all)
    results["avg_rm2_all_test"] = rm2_te_all[2]
    results["delta_rm2_all_test"] = rm2_te_all[3]
    results["CCC_all_test"] = ccc(y_te, te_pred_all)
    results["RMSE_all_test"] = rmse(y_te, te_pred_all)
    y_overall = np.concatenate([y_tr, y_te])
    p_overall = np.concatenate([internal_pred, te_pred])
    rm2_ov = rm2_pair(y_overall, p_overall)
    results["avg_rm2_overall"] = rm2_ov[2]
    results["delta_rm2_overall"] = rm2_ov[3]
else:
    for k in ("R2pred_Q2F1_in_domain", "avg_rm2_test", "delta_rm2_test",
              "CCC_test", "RMSE_test", "MAE_test", "avg_rm2_overall",
              "delta_rm2_overall", "R2pred_Q2F1_all_test", "avg_rm2_all_test",
              "delta_rm2_all_test", "CCC_all_test", "RMSE_all_test"):
        results[k] = np.nan
    results["n_external"] = 0
    results["n_external_in_domain"] = 0
    te_pred = np.array([], dtype=float)
    te_pred_all = np.array([], dtype=float)

# ---- the verdict table, with your flowchart's thresholds --------------------
CRITERIA = [
    ("R2_fit_train",            ">", 0.60, "goodness-of-fit (Golbraikh-Tropsha)"),
    ("Q2_LOGO",                 ">", 0.50, "internal, your flowchart's Q2, with "
                                           "a whole series held out"),
    ("avg_rm2_LOGO",            ">", 0.50, "internal, your flowchart, series-grouped"),
    ("delta_rm2_LOGO",          "<", 0.20, "internal, your flowchart, series-grouped"),
    ("cRp2",                    ">", 0.50, "y-randomisation, your flowchart"),
    ("R2pred_Q2F1_in_domain",   ">", 0.50, "external, your flowchart"),
    ("avg_rm2_test",            ">", 0.50, "external, your flowchart"),
    ("delta_rm2_test",          "<", 0.20, "external, your flowchart"),
    ("avg_rm2_overall",         ">", 0.50, "overall, your flowchart"),
    ("delta_rm2_overall",       "<", 0.20, "overall, your flowchart"),
    ("CCC_test",                ">", 0.85, "Chirico & Gramatica 2011"),
]

print(f"\n  CV scheme used: {results['CV_scheme']}{tag()}")
print(f"\n  {'statistic':<26}{'value':>10}   {'threshold':<12}{'verdict':<10}note")
print("  " + "-" * 92)
verdicts = {}
for key, op, thr, note in CRITERIA:
    v = results.get(key, np.nan)
    if v is None or (isinstance(v, float) and np.isnan(v)):
        shown, verdict = "n/a", "NOT AVAIL"
    else:
        shown = f"{v:.4f}"
        ok = v > thr if op == ">" else v < thr
        verdict = "PASS" if ok else "FAIL"
        verdicts[key] = bool(ok)
    print(f"  {key:<26}{shown:>10}   {op + ' ' + str(thr):<12}{verdict:<10}{note}")

print("\n  supporting numbers (no threshold attached):")
for key in ("RMSE_fit_train", "MAE_fit_train", "R_fit_pearson", "Q2_grouped_CV",
            "Q2_grouped_CV_nested", "RMSE_grouped_CV",
            "Q2_LOO", "avg_rm2_LOO", "delta_rm2_LOO",
            "RMSE_LOO", "CCC_LOO", "RMSE_LOGO", "CCC_LOGO",
            "n_series_held_out_one_at_a_time", "mean_R2_y_scrambled",
            "mean_r_y_scrambled", "mean_Q2_y_scrambled", "n_y_scramble_runs",
            "n_external", "n_external_in_domain", "RMSE_test", "MAE_test",
            "R2pred_Q2F1_all_test", "avg_rm2_all_test", "delta_rm2_all_test",
            "CCC_all_test", "RMSE_all_test"):
    v = results.get(key, np.nan)
    shown = ("n/a" if v is None or (isinstance(v, float) and np.isnan(v))
             else (f"{v:.4f}" if isinstance(v, float) else str(v)))
    print(f"    {key:<26}{shown:>10}")

_scr_mean = results.get("mean_R2_y_scrambled", np.nan)
if not (isinstance(_scr_mean, float) and np.isnan(_scr_mean)):
    print("\n  how to read the y-scrambling: a model that has learned chemistry "
          "scores far better than its scrambled twins.")
    print(f"    real fit R2 {_r2_fit:.4f}  vs  scrambled mean R2 "
          f"{_scr_mean:.4f}  over {CONFIG['N_Y_SCRAMBLE']} runs")
    print(f"    real Q2(grouped CV) {results.get('Q2_grouped_CV', float('nan')):.4f}"
          f"  vs  scrambled mean Q2 "
          f"{results.get('mean_Q2_y_scrambled', float('nan')):.4f}")
    if _scr_mean >= _r2_fit:
        print("    The scrambled models do as well as the real one. That means "
              "the fit is coming from the number of descriptors, not from the "
              "chemistry. Treat the model as empty.")

n_not_available = sum(
    1 for key, _, _, _ in CRITERIA
    if key not in verdicts
)
model_acceptable = bool(verdicts) and all(verdicts.values()) and n_not_available == 0
print(f"\n  criteria assessed: {len(verdicts)} of {len(CRITERIA)}; "
      f"{n_not_available} could not be computed from this data")
print(f"  >>> MODEL ACCEPTABLE UNDER THE FLOWCHART'S CRITERIA: "
      f"{'YES' if model_acceptable else 'NO'}{tag()}")
if n_not_available and all(verdicts.values()):
    print("  >>> Reads NO because some criteria could not be computed at all, "
          "not because a computed one failed. An unmeasured criterion is not a "
          "passed criterion.")
if not model_acceptable:
    print("  >>> Your flowchart's NO branch loops back to the division of the "
          "dataset. At n = {} that loop cannot help: the honest next move is "
          "more labelled data, not another split.".format(len(y_tr)))
if INDICATIVE:
    print("  >>> Reminder: these are INDICATIVE numbers from an underpowered set. "
          "Do not quote them as validation.")


# =============================================================================
# 8. OECD PRINCIPLE 5 - MECHANISTIC INTERPRETATION
#    Permutation importance always; SHAP when available; plus a Hansch-style
#    look at lipophilicity, molar refractivity and polar surface area, which is
#    the classical reading your project is named after.
# =============================================================================

banner("OECD PRINCIPLE 5 - MECHANISTIC INTERPRETATION")

perm = permutation_importance(final_model, X_tr, y_tr, n_repeats=30,
                              random_state=SEED, scoring="r2")
imp = (pd.DataFrame({"descriptor": FEATURES,
                     "perm_importance_mean": perm.importances_mean,
                     "perm_importance_sd": perm.importances_std})
       .sort_values("perm_importance_mean", ascending=False)
       .reset_index(drop=True))
print(f"\n  permutation importance, 30 repeats, scoring r2, seed {SEED}{tag()}")
print(textwrap.indent(imp.head(15).to_string(index=False), "    "))
imp.to_csv(f"{CONFIG['OUT_PREFIX']}_permutation_importance.csv", index=False)
step(f"wrote {CONFIG['OUT_PREFIX']}_permutation_importance.csv")

if HAVE_SHAP:
    try:
        import shap
        if best_params.get("family") == "rf":
            expl = shap.TreeExplainer(final_model)
            sv = expl.shap_values(X_tr, check_additivity=False)
        else:
            expl = shap.Explainer(final_model.predict, X_tr)
            sv = expl(X_tr).values
        sv = np.asarray(sv)
        shap_tbl = (pd.DataFrame({"descriptor": FEATURES,
                                  "mean_abs_shap": np.abs(sv).mean(axis=0)})
                    .sort_values("mean_abs_shap", ascending=False)
                    .reset_index(drop=True))
        print(f"\n  SHAP, mean absolute value per descriptor{tag()}")
        print(textwrap.indent(shap_tbl.head(15).to_string(index=False), "    "))
        shap_tbl.to_csv(f"{CONFIG['OUT_PREFIX']}_shap_importance.csv", index=False)
        step(f"wrote {CONFIG['OUT_PREFIX']}_shap_importance.csv")
    except Exception as exc:                 # noqa: BLE001
        print(f"  SHAP skipped: {exc}. Permutation importance above stands in.")
else:
    print("  shap not installed; permutation importance above stands in.")

print("\n  Hansch-style reading (classical QSAR: activity against lipophilicity, "
      "sterics and electronics)")
hansch_rows = []
for d, meaning in (("MolLogP", "lipophilicity, Hansch pi / logP"),
                   ("MolMR", "molar refractivity, Hansch MR, a steric-polarisability term"),
                   ("TPSA", "topological polar surface area"),
                   ("MolWt", "size"),
                   ("NumHDonors", "hydrogen-bond donors"),
                   ("NumHAcceptors", "hydrogen-bond acceptors")):
    try:
        vals = np.array([DESC_FUNCS[d](m) for m in labelled["mol"].iloc[tr_idx]],
                        dtype=float)
    except Exception:                        # noqa: BLE001
        continue
    ok = ~np.isnan(vals)
    if ok.sum() < 4 or np.std(vals[ok]) == 0:
        continue
    r, p = pearsonr(vals[ok], y_tr[ok])
    hansch_rows.append({"term": d, "meaning": meaning, "pearson_r": round(r, 4),
                        "r_squared": round(r * r, 4), "p_value": round(p, 4),
                        "n": int(ok.sum())})
if hansch_rows:
    print(textwrap.indent(pd.DataFrame(hansch_rows).to_string(index=False), "    "))
    pd.DataFrame(hansch_rows).to_csv(
        f"{CONFIG['OUT_PREFIX']}_hansch_terms.csv", index=False)
    step(f"wrote {CONFIG['OUT_PREFIX']}_hansch_terms.csv")
    print(f"\n    With n = {len(y_tr)} a p-value here is a curiosity, not a "
          "finding. Six terms tested on a handful of molecules will throw up a "
          "'significant' one by chance.")
print("\n  Mechanistic honesty: the therapeutic index is a ratio of two clinical "
      "doses. It is shaped by absorption, clearance, protein binding and the "
      "receptor involved, not by structure alone. Descriptor importance here "
      "says which structural terms track the ratio in THIS set. It does not "
      "establish a mechanism.")


# =============================================================================
# 8b. THE PLOTS AND THE SAVED MODEL FROM PART 15 OF YOUR NOTEBOOKS
#     Actual vs predicted with the ideal line, a residual histogram, and a
#     feature-importance bar chart; then the model saved with joblib so you can
#     reload it later without retraining. Same three plots, same .pkl habit.
#     Difference: "actual vs predicted" here uses LEAVE-ONE-OUT predictions for
#     the training set, not in-sample ones. In-sample points sit on the ideal
#     line by construction and tell you nothing.
# =============================================================================

banner("PLOTS AND SAVED MODEL (Part 15 style)")

if HAVE_MPL:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        if HAVE_SNS:
            import seaborn as sns
            sns.set_theme(style="whitegrid")

        fig, axes = plt.subplots(1, 2, figsize=(14, 6))
        ax = axes[0]
        _sch = results.get("internal_prediction_scheme", "held-out")
        ax.scatter(y_tr, internal_pred, alpha=0.8,
                   label=f"train, {_sch} (n={len(y_tr)})")
        if len(te_idx):
            ax.scatter(y_te, te_pred_all, alpha=0.9, marker="^",
                       label=f"external test (n={len(te_idx)})")
        pts = np.concatenate([v for v in (y_tr, internal_pred,
                                          y_te if len(te_idx) else np.array([]),
                                          te_pred_all if len(te_idx)
                                          else np.array([])) if len(v)])
        pts = pts[~np.isnan(pts)]
        if len(pts):
            lo, hi = float(np.min(pts)), float(np.max(pts))
            pad = 0.05 * max(hi - lo, 1e-6)
            ax.plot([lo - pad, hi + pad], [lo - pad, hi + pad], "r--",
                    label="ideal line")
        ax.set_xlabel("Actual Log Therapeutic Index")
        ax.set_ylabel("Predicted Log Therapeutic Index")
        ax.set_title("Actual vs predicted" + (" [INDICATIVE]" if INDICATIVE else ""))
        ax.legend()

        ax = axes[1]
        resid = y_tr - internal_pred
        resid = resid[~np.isnan(resid)]
        if len(resid):
            ax.hist(resid, bins=max(5, min(20, len(resid))), alpha=0.85)
            ax.axvline(0.0, color="red", linestyle="--")
        ax.set_xlabel(f"Residual (actual - predicted, {_sch})")
        ax.set_title("Residuals")
        fig.tight_layout()
        fig.savefig(f"{CONFIG['OUT_PREFIX']}_actual_vs_predicted.png", dpi=150)
        plt.close(fig)
        step(f"wrote {CONFIG['OUT_PREFIX']}_actual_vs_predicted.png")

        top = imp.head(20).iloc[::-1]
        fig, ax = plt.subplots(figsize=(10, max(4, 0.35 * len(top))))
        ax.barh(top["descriptor"], top["perm_importance_mean"],
                xerr=top["perm_importance_sd"])
        ax.set_xlabel("drop in r2 when this descriptor is shuffled")
        ax.set_title("Feature importance (permutation)"
                     + (" [INDICATIVE]" if INDICATIVE else ""))
        fig.tight_layout()
        fig.savefig(f"{CONFIG['OUT_PREFIX']}_feature_importance.png", dpi=150)
        plt.close(fig)
        step(f"wrote {CONFIG['OUT_PREFIX']}_feature_importance.png")
    except Exception as exc:                 # noqa: BLE001
        step(f"plots skipped ({exc})")
else:
    step("matplotlib unavailable; no plots")

if CONFIG["SAVE_MODEL_PKL"]:
    try:
        bundle = {
            "model": final_model,
            "scaler": scaler,
            "features": FEATURES,
            "best_params": best_params,
            "box_lo": box_lo, "box_hi": box_hi, "h_star": h_star,
            "XtX_inv": XtX_inv,
            "train_canonical_smiles": list(
                labelled["canonical_smiles"].iloc[tr_idx]),
            "endpoint": "log10(Minimum Toxic Level / Minimum Therapeutic Level)",
            "seed": SEED, "run_utc": RUN_STAMP,
            "indicative_underpowered": bool(INDICATIVE),
            "n_train": int(len(tr_idx)),
        }
        joblib.dump(bundle, f"{CONFIG['OUT_PREFIX']}_best_model.pkl")
        step(f"wrote {CONFIG['OUT_PREFIX']}_best_model.pkl  "
             "(model + scaler + descriptor list + the domain, in one file, so a "
             "reload cannot accidentally predict without the domain check)")
    except Exception as exc:                 # noqa: BLE001
        step(f"model not saved ({exc})")


# =============================================================================
# 9. CONDITIONAL ROUTING AND THE RANKED TABLE
#    A molecule with scaffold A and target A goes to the model trained on that
#    congeneric series with that target. If no such model has enough data, it
#    goes to the global model. If it is out of domain, it is refused.
# =============================================================================

banner("CONDITIONAL ROUTING: SCAFFOLD + TARGET -> THE RIGHT MODEL")

ROUTES = {}          # (series_id, target) -> fitted local model + its own AD


def normalise_target(t):
    return "UNSPECIFIED" if t is None else str(t).strip().lower()


labelled["target_norm"] = labelled["target"].map(normalise_target)
# TRAINING ROWS ONLY. A local model built from the whole labelled set would
# have the external hold-out inside its own fitting data, its scaler and its
# bounding box, and the "series shared between train and test: 0" check earlier
# would then be true of the global model and false of the local ones.
labelled_tr = labelled.iloc[tr_idx]
route_keys = labelled_tr.groupby(["series_id", "target_norm"]).size()
step(f"candidate (series, target) pairs in the TRAINING set: {len(route_keys)}")
step(f"a pair needs >= {CONFIG['MIN_SERIES_N']} training molecules for its own model")

for (sid, tnorm), cnt in route_keys.items():
    if cnt < CONFIG["MIN_SERIES_N"]:
        continue
    sel = labelled_tr[(labelled_tr["series_id"] == sid)
                      & (labelled_tr["target_norm"] == tnorm)]
    Xl_raw = (pd.DataFrame([descriptors_for(m) for m in sel["mol"]])
              .replace([np.inf, -np.inf], np.nan)
              .reindex(columns=FEATURES))
    if Xl_raw.isna().any().any():
        continue
    yl = sel["log_ti"].to_numpy(dtype=float)
    if len(np.unique(yl)) < 2:
        continue
    sc = StandardScaler().fit(Xl_raw.to_numpy(dtype=float))
    Xl = sc.transform(Xl_raw.to_numpy(dtype=float))
    ROUTES[(sid, tnorm)] = {
        "model": build_model(best_params).fit(Xl, yl),
        "scaler": sc, "n": int(cnt),
        "fps": list(sel["fp"]),
        "box_lo": np.percentile(Xl, lo_p, axis=0),
        "box_hi": np.percentile(Xl, hi_p, axis=0),
    }

if ROUTES:
    step(f"local models built: {len(ROUTES)}")
    for (sid, tnorm), r in ROUTES.items():
        step(f"    series {sid[:40]}... | target '{tnorm}' | n={r['n']}")
else:
    step("local models built: 0. Every (series, target) pair is smaller than "
         f"{CONFIG['MIN_SERIES_N']}, so every molecule routes to the GLOBAL "
         "model. That is the routing rule working, not failing: a series with "
         "two members cannot support its own QSAR.")

# also training rows only, so a query cannot be assigned to a series by its
# similarity to a held-out molecule
series_members = {sid: list(grp["fp"]) for sid, grp
                  in labelled_tr.groupby("series_id")}


def assign_series(fp):
    """Nearest labelled series by maximum Tanimoto, if it clears the cutoff."""
    best_sid, best_sim = None, -1.0
    for sid, fps in series_members.items():
        s = max(DataStructs.BulkTanimotoSimilarity(fp, fps))
        if s > best_sim:
            best_sid, best_sim = sid, s
    if best_sim >= CONFIG["TANIMOTO_SERIES_CUTOFF"]:
        return best_sid, best_sim
    return None, best_sim


def route_and_predict(mol, fp, target, x_raw_row):
    sid, sim = assign_series(fp)
    tnorm = normalise_target(target)
    key = (sid, tnorm)
    x_glob = scaler.transform(x_raw_row.reshape(1, -1))[0]
    dom = domain_check(x_glob, fp)
    if key in ROUTES:
        r = ROUTES[key]
        xl = r["scaler"].transform(x_raw_row.reshape(1, -1))[0]
        inside_local = bool(np.all(xl >= r["box_lo"]) and np.all(xl <= r["box_hi"]))
        model_used = f"LOCAL series={sid[:30]} target={tnorm} (n={r['n']})"
        pred = float(r["model"].predict(xl.reshape(1, -1))[0])
        in_dom = dom["in_domain"] and inside_local
        if not inside_local:
            dom["out_of_domain_reason"] = (
                (dom["out_of_domain_reason"] + "; ") if dom["out_of_domain_reason"]
                else "") + "outside the local series' descriptor box"
    else:
        reason = ("no labelled series matched above Tanimoto "
                  f"{CONFIG['TANIMOTO_SERIES_CUTOFF']}" if sid is None
                  else f"series {sid[:30]} has fewer than "
                       f"{CONFIG['MIN_SERIES_N']} labelled molecules for target "
                       f"'{tnorm}'")
        model_used = f"GLOBAL ({reason})"
        pred = float(final_model.predict(x_glob.reshape(1, -1))[0])
        in_dom = dom["in_domain"]
    return {
        "assigned_series": sid or "NONE",
        "similarity_to_series": round(sim, 4),
        "target_used": tnorm,
        "model_used": model_used,
        "predicted_log_ti": pred if in_dom else np.nan,
        "prediction_withheld": not in_dom,
        "withheld_reason": "" if in_dom else
        ("REFUSED, out of applicability domain: " + dom["out_of_domain_reason"]),
        **{k: dom[k] for k in ("leverage", "max_tanimoto_to_train",
                               "n_descriptors_out_of_box")},
    }


# ---- the ranking set --------------------------------------------------------
queries = unlabelled.copy()
if CONFIG["MAX_QUERY_MOLECULES"]:
    queries = queries.head(int(CONFIG["MAX_QUERY_MOLECULES"])).copy()
step(f"ranking set: {len(queries)} molecules with a structure but no endpoint")

rows = []
if len(queries):
    Xq_full = (pd.DataFrame([descriptors_for(m) for m in queries["mol"]])
               .replace([np.inf, -np.inf], np.nan))
    Xq_raw = Xq_full.reindex(columns=FEATURES)

    # Part 14 ends with one merged master descriptor file keyed on SMILES.
    # Same thing here, in one pass rather than four CSVs and a merge, with the
    # endpoint column included where it is known.
    try:
        lab_block = X_all_raw.copy()
        lab_block.insert(0, "SMILES", list(labelled["canonical_smiles"]))
        lab_block.insert(1, "Name", list(labelled["name"]))
        lab_block.insert(2, "Activity_log_TI", list(labelled["log_ti"]))
        lab_block.insert(3, "set", "labelled")
        q_block = Xq_full.copy()
        q_block.insert(0, "SMILES", list(queries["canonical_smiles"]))
        q_block.insert(1, "Name", list(queries["name"]))
        q_block.insert(2, "Activity_log_TI", np.nan)
        q_block.insert(3, "set", "unlabelled")
        master = pd.concat([lab_block, q_block], ignore_index=True, sort=False)
        master.to_csv(f"{CONFIG['OUT_PREFIX']}_descriptors_master.csv",
                      index=False)
        step(f"wrote {CONFIG['OUT_PREFIX']}_descriptors_master.csv "
             f"({master.shape[0]} molecules x {master.shape[1]} columns) - this "
             "is the equivalent of Part 14's merged master file")
    except Exception as exc:                 # noqa: BLE001
        step(f"master descriptor file not written ({exc})")

    n_desc_fail = 0
    for i in range(len(queries)):
        q = queries.iloc[i]
        xrow = Xq_raw.iloc[i].to_numpy(dtype=float)
        if np.isnan(xrow).any():
            n_desc_fail += 1
            rows.append({
                "name": q["name"], "drugbank_id": q.get("drugbank_id"),
                "canonical_smiles": q["canonical_smiles"],
                "scaffold": q["scaffold"], "target_used": normalise_target(q["target"]),
                "model_used": "NONE", "predicted_log_ti": np.nan,
                "prediction_withheld": True,
                "withheld_reason": "REFUSED: one or more descriptors could not "
                                   "be computed for this structure",
                "pfizer_3_75_flag": bool(q.get("pfizer_3_75_flag", False)),
                "ro5_violations": q.get("ro5_violations"),
            })
            continue
        out = route_and_predict(q["mol"], q["fp"], q["target"], xrow)
        rows.append({
            "name": q["name"], "drugbank_id": q.get("drugbank_id"),
            "canonical_smiles": q["canonical_smiles"], "scaffold": q["scaffold"],
            "pfizer_3_75_flag": bool(q.get("pfizer_3_75_flag", False)),
            "ro5_violations": q.get("ro5_violations"), **out,
        })
    if n_desc_fail:
        step(f"{n_desc_fail} query molecules refused because a descriptor "
             "could not be computed")

ranked = pd.DataFrame(rows)
banner("FINAL RANKED TABLE - HIGHEST PREDICTED LOG THERAPEUTIC INDEX FIRST")
print("  endpoint ranked on: "
      + ("CLINICAL log10(toxic mg / therapeutic mg), single dose, healthy "
         "subjects, oral or IV" if DATASET == "leaderboard"
         else "PLASMA log10(toxic mg/L / therapeutic mg/L), concentrations in "
              "plasma or serum, NOT doses" if DATASET == "schulz_plasma"
         else "IN VITRO log10(off-target nM / on-target nM), one congeneric "
              "series")
      + f"\n  dataset           : {DATASET}"
      + "\n  These two endpoints are different quantities. A number from one "
        "cannot be compared with a number from the other.")

if len(ranked) == 0:
    print("  No molecule to rank: every structure in the workbook already "
          "carries an endpoint, or none could be parsed.")
else:
    scored = ranked[~ranked["prediction_withheld"]].copy()
    refused = ranked[ranked["prediction_withheld"]].copy()
    scored = scored.sort_values("predicted_log_ti", ascending=False).reset_index(
        drop=True)
    scored.insert(0, "rank", np.arange(1, len(scored) + 1))
    print(f"  molecules in the ranking set : {len(ranked)}")
    print(f"  predicted (in domain)        : {len(scored)}")
    print(f"  refused (out of domain etc.) : {len(refused)}{tag()}")
    if len(scored):
        cols = ["rank", "name", "predicted_log_ti", "model_used",
                "max_tanimoto_to_train", "pfizer_3_75_flag", "scaffold"]
        show = (scored.reindex(columns=cols)
                .head(CONFIG["TOP_N_PRINT"]).copy())
        show["predicted_log_ti"] = pd.to_numeric(
            show["predicted_log_ti"], errors="coerce").round(4)
        show["scaffold"] = show["scaffold"].astype(str).str.slice(0, 28)
        show["model_used"] = show["model_used"].astype(str).str.slice(0, 34)
        print("\n" + textwrap.indent(show.to_string(index=False), "  "))
        if len(scored) > CONFIG["TOP_N_PRINT"]:
            print(f"\n  ... {len(scored) - CONFIG['TOP_N_PRINT']} more rows in "
                  "the CSV.")
    if len(refused):
        print(f"\n  first 10 refusals, with the reason:")
        rr = refused.reindex(columns=["name", "withheld_reason"]).head(10).copy()
        rr["withheld_reason"] = rr["withheld_reason"].astype(str).str.slice(0, 95)
        print(textwrap.indent(rr.to_string(index=False), "  "))

    scored.to_csv(f"{CONFIG['OUT_PREFIX']}_ranked_predictions.csv", index=False)
    refused.to_csv(f"{CONFIG['OUT_PREFIX']}_refused_predictions.csv", index=False)
    step(f"wrote {CONFIG['OUT_PREFIX']}_ranked_predictions.csv "
         f"({len(scored)} rows)")
    step(f"wrote {CONFIG['OUT_PREFIX']}_refused_predictions.csv "
         f"({len(refused)} rows)")

# the labelled set itself, with its LOO prediction, for inspection
insp = labelled.iloc[tr_idx][["name", "canonical_smiles", "scaffold", "series_id",
                              "target", "ther_mg", "tox_mg", "log_ti",
                              "pfizer_3_75_flag"]].copy()
insp["log_ti_predicted_LOO"] = loo_pred
insp["log_ti_predicted_heldout_series"] = logo_pred
insp["residual"] = insp["log_ti"] - internal_pred
insp["all_names_merged"] = list(labelled["all_names"].iloc[tr_idx]) \
    if "all_names" in labelled.columns else ""
insp.to_csv(f"{CONFIG['OUT_PREFIX']}_training_set_loo.csv", index=False)
step(f"wrote {CONFIG['OUT_PREFIX']}_training_set_loo.csv")

# =============================================================================
# 10. SCORE YOUR OWN CSV OF NEW COMPOUNDS  (Part 15's "Testing Unknown Dataset")
#     Part 15 loads unknown.csv, scales it and predicts. Same step here, with
#     two additions: the descriptors are recomputed from the SMILES rather than
#     trusted from the file, and the applicability domain and the routing are
#     applied, so an unknown compound that is nothing like the training set is
#     refused instead of being given a confident-looking number.
# =============================================================================

if CONFIG["UNKNOWN_CSV"]:
    banner("10. SCORING YOUR UNKNOWN COMPOUND CSV")
    try:
        new_df = pd.read_csv(CONFIG["UNKNOWN_CSV"])
        smi_col = next((c for c in new_df.columns
                        if c.strip().lower() in ("smiles", "canonical_smiles",
                                                 "smile")), None)
        if smi_col is None:
            raise ValueError(
                f"no SMILES column in {CONFIG['UNKNOWN_CSV']}; columns are "
                f"{list(new_df.columns)}")
        name_col = next((c for c in new_df.columns
                         if c.strip().lower() in ("name", "drug", "drug name",
                                                  "compound", "id")), None)
        step(f"read {CONFIG['UNKNOWN_CSV']}: {len(new_df)} rows, "
             f"SMILES column '{smi_col}'")
        out_rows = []
        for i in range(len(new_df)):
            smi = new_df.iloc[i][smi_col]
            nm = (str(new_df.iloc[i][name_col]) if name_col
                  else f"row_{i + 1}")
            m, cano, why = standardise(None if pd.isna(smi) else str(smi))
            if m is None:
                out_rows.append({"name": nm, "input_smiles": smi,
                                 "predicted_log_ti": np.nan,
                                 "prediction_withheld": True,
                                 "withheld_reason": f"REFUSED: {why}"})
                continue
            d = descriptors_for(m)
            xrow = np.array([d.get(f, np.nan) for f in FEATURES], dtype=float)
            if np.isnan(xrow).any():
                out_rows.append({"name": nm, "input_smiles": smi,
                                 "canonical_smiles": cano,
                                 "predicted_log_ti": np.nan,
                                 "prediction_withheld": True,
                                 "withheld_reason": "REFUSED: a descriptor "
                                                    "could not be computed"})
                continue
            fp = mgen.GetFingerprint(m)
            res = route_and_predict(m, fp, None, xrow)
            out_rows.append({"name": nm, "input_smiles": smi,
                             "canonical_smiles": cano,
                             "scaffold": scaffold_of(m),
                             **rule_flags(m), **res})
        new_out = pd.DataFrame(out_rows)
        scored_new = (new_out[~new_out["prediction_withheld"]]
                      .sort_values("predicted_log_ti", ascending=False)
                      .reset_index(drop=True))
        if len(scored_new):
            scored_new.insert(0, "rank", np.arange(1, len(scored_new) + 1))
            cols = [c for c in ("rank", "name", "predicted_log_ti", "model_used",
                                "max_tanimoto_to_train", "pfizer_3_75_flag")
                    if c in scored_new.columns]
            print(textwrap.indent(
                scored_new[cols].head(CONFIG["TOP_N_PRINT"]).to_string(
                    index=False), "  "))
        print(f"\n  predicted {len(scored_new)} of {len(new_out)}; "
              f"{int(new_out['prediction_withheld'].sum())} refused{tag()}")
        new_out.to_csv(f"{CONFIG['OUT_PREFIX']}_unknown_predictions.csv",
                       index=False)
        step(f"wrote {CONFIG['OUT_PREFIX']}_unknown_predictions.csv")
    except Exception as exc:                 # noqa: BLE001
        print(f"  could not score {CONFIG['UNKNOWN_CSV']}: {exc}")
else:
    print("\n  (Section 10 skipped: set CONFIG['UNKNOWN_CSV'] to a CSV with a "
          "SMILES column to score your own new compounds, as Part 15 does.)")


# machine-readable summary of the whole run
summary = {
    "run_utc": RUN_STAMP,
    "dataset": DATASET,
    "endpoint": ("log10(Minimum Toxic Level mg / Minimum Therapeutic Level mg), "
                 "single dose, healthy subjects, oral or IV"
                 if DATASET == "leaderboard"
                 else "log10(toxic mg/L / therapeutic mg/L), plasma or serum "
                      "concentrations, not doses"
                 if DATASET == "schulz_plasma"
                 else "log10(off-target nM / on-target nM), in vitro, one "
                      "congeneric series"),
    "endpoint_units": ("mg of dose" if DATASET == "leaderboard"
                       else "mg/L plasma or serum" if DATASET == "schulz_plasma"
                       else "nM (the endpoint itself is a dimensionless log10 "
                            "ratio)"),
    "split_source": ("the file's own 'set' column" if use_preset
                     else "GroupShuffleSplit on congeneric series"),
    "workbook": os.path.abspath(XLSX),
    "sheet": CONFIG["SHEET_NAME"],
    "seed": SEED,
    "indicative_underpowered": bool(INDICATIVE),
    "versions": {"numpy": np.__version__, "pandas": pd.__version__,
                 "rdkit": Chem.rdBase.rdkitVersion},
    "counts": {
        "rows_with_a_name": int(len(df)),
        "rows_with_smiles": int(n_with_smiles),
        "smiles_parsed": int(n_parsed),
        "unique_structures": int(len(work)),
        "labelled": int(len(labelled)),
        "congeneric_series": int(n_groups_all),
        "train": int(len(tr_idx)), "external_test": int(len(te_idx)),
        "ranking_set": int(len(ranked)),
    },
    "descriptors_kept": FEATURES,
    "tuning": tuning_report,
    "applicability_domain": {
        "box_percentiles": list(CONFIG["AD_BOX_PERCENTILES"]),
        "h_star": h_star,
        "tanimoto_cutoff": CONFIG["TANIMOTO_AD_CUTOFF"],
        "require_all_three": CONFIG["AD_REQUIRE_ALL"],
    },
    "statistics": {k: (None if isinstance(v, float) and np.isnan(v) else v)
                   for k, v in results.items()},
    "criteria_verdicts": verdicts,
    "model_acceptable": model_acceptable,
    "n_local_models": len(ROUTES),
    "steps": LOG,
}
with open(f"{CONFIG['OUT_PREFIX']}_run_summary.json", "w") as fh:
    json.dump(summary, fh, indent=2, default=str)

# =============================================================================
# 11. THE SENSITIVITY COMPARISON
#     Run the plasma endpoint twice, once with SUBSET = "drug_like" and once
#     with "all", and this prints the two side by side from their saved
#     summaries. Two runs rather than one, because the split, the scaler, the
#     descriptor pruning and the tuning all depend on which molecules are in,
#     so a second model cannot honestly be bolted onto the first run's
#     preprocessing.
# =============================================================================

if DATASET == "schulz_plasma":
    banner("11. SENSITIVITY: DRUG-LIKE SUBSET vs EVERYTHING")
    _pair = {}
    for _sub in ("drug_like", "all"):
        _f = f"qsar_oecd_schulz_plasma_{_sub}_run_summary.json"
        if os.path.exists(_f):
            try:
                with open(_f) as _fh:
                    _pair[_sub] = json.load(_fh)
            except Exception as _e:              # noqa: BLE001
                print(f"  could not read {_f}: {_e}")
    if len(_pair) < 2:
        _have = ", ".join(_pair) or "neither"
        _missing = [s for s in ("drug_like", "all") if s not in _pair]
        print(f"  only {_have} has been run so far. To get the comparison, set")
        print(f"    CONFIG['SCHULZ']['SUBSET'] = '{_missing[0]}'")
        print("  and run the notebook again. Both summaries are then read from "
              "disk and printed here, with no need to keep anything in memory.")
    else:
        _keys = ["R2_fit_train", "Q2_grouped_CV_nested", "Q2_LOGO",
                 "avg_rm2_LOGO", "delta_rm2_LOGO", "cRp2",
                 "R2pred_Q2F1_in_domain", "avg_rm2_test", "CCC_test",
                 "RMSE_test", "n_external", "n_external_in_domain"]
        print(f"  {'statistic':<26}{'drug_like':>14}{'all':>14}   difference")
        print("  " + "-" * 74)
        print(f"  {'molecules (labelled)':<26}"
              f"{_pair['drug_like']['counts']['labelled']:>14}"
              f"{_pair['all']['counts']['labelled']:>14}")
        for _k in _keys:
            _a = _pair["drug_like"]["statistics"].get(_k)
            _b = _pair["all"]["statistics"].get(_k)
            _fmt = lambda v: ("n/a" if v is None else
                              f"{v:.4f}" if isinstance(v, float) else str(v))
            _d = (f"{_b - _a:+.4f}" if isinstance(_a, (int, float))
                  and isinstance(_b, (int, float)) else "")
            print(f"  {_k:<26}{_fmt(_a):>14}{_fmt(_b):>14}   {_d}")
        print("\n  HOW TO READ THIS. The molecules in 'all' but not in "
              "'drug_like' are systematically smaller and simpler than the "
              "drugs: 2 to 7 heavy atoms against 10 and up. So a difference "
              "between these columns is confounded with molecular size and is "
              "NOT 'the effect of including solvents'. Read it as: the model "
              "behaves differently on a chemically wider set, for reasons that "
              "are about size at least as much as about what the molecules are "
              "used for.")
        print("  The watch list printed in section 6 of each run says, per "
              "molecule, whether it was inside the domain in that run. That is "
              "the part of this comparison that carries real information.")


banner("DONE - WHAT EACH OECD PRINCIPLE WAS SATISFIED BY", char="-")
print(textwrap.dedent(f"""
    1  defined endpoint      section 1: log10(toxic/therapeutic), units stated,
                              n = {len(labelled)} counted, species/route gap flagged
    2  unambiguous algorithm sections 2 and 5: standardisation, named descriptor
                              block, Morgan fingerprints, full model space printed,
                              seed {SEED}, GroupKFold on congeneric series
    3  applicability domain  section 6: percentile box + leverage h* = {h_star:.3f}
                              + Tanimoto floor; out-of-domain predictions refused
    4  fit/robust/predictive section 7: R2, Q2(LOO), grouped-CV Q2, rm2 and
                              delta rm2, cRp2 from {CONFIG['N_Y_SCRAMBLE']} scrambles,
                              R2pred, CCC, RMSE, MAE, each with a PASS/FAIL
    5  mechanistic reading   section 8: permutation importance, SHAP, Hansch terms

    files written in {os.getcwd()}:
      {CONFIG['OUT_PREFIX']}_ranked_predictions.csv      the ranking you asked for
      {CONFIG['OUT_PREFIX']}_refused_predictions.csv     every refusal, with its reason
      {CONFIG['OUT_PREFIX']}_descriptors_master.csv      Part 14's merged master file
      {CONFIG['OUT_PREFIX']}_model_performance_metrics.csv  Part 15's bake-off table
      {CONFIG['OUT_PREFIX']}_best_model.pkl              model + scaler + domain
      {CONFIG['OUT_PREFIX']}_training_set_loo.csv        the 19, with LOO residuals
      {CONFIG['OUT_PREFIX']}_tanimoto_matrix.csv
      {CONFIG['OUT_PREFIX']}_permutation_importance.csv
      {CONFIG['OUT_PREFIX']}_hansch_terms.csv
      {CONFIG['OUT_PREFIX']}_run_summary.json            every step and statistic
      {CONFIG['OUT_PREFIX']}_actual_vs_predicted.png     Part 15's two plots
      {CONFIG['OUT_PREFIX']}_feature_importance.png      Part 15's bar chart
      {CONFIG['OUT_PREFIX']}_dendrogram.png              the congeneric series
      {CONFIG['OUT_PREFIX']}_shap_importance.csv         (if shap ran)
      {CONFIG['OUT_PREFIX']}_smiles_failures.csv         (if any SMILES failed)
      {CONFIG['OUT_PREFIX']}_unknown_predictions.csv     (if you set UNKNOWN_CSV)

    where this departs from your two example notebooks, and why:
      * Part 15's random 80:20 train_test_split -> a scaffold-grouped split.
        A random split lets one congeneric series sit on both sides and inflates
        R2. Your slide 9 is about exactly this.
      * Part 15's GridSearchCV -> nested Optuna (your slide 11), so the fold
        used to measure is never the fold used to tune. The five-model GridSearchCV
        bake-off is still run and reported, for comparability with Part 15.
      * Part 14 has no applicability domain; one is added, with refusal (OECD 3).
      * Part 15 reports MSE and R2 only; rm2, delta rm2, cRp2, CCC and Q2 are
        added, with your flowchart's thresholds (OECD 4, your slides 12 and 14).
      * Part 14's molecular_volume() and surface_area() both return
        CalcExactMolWt, a placeholder its own comment admits; real volume and
        solvent-accessible surface area are computed instead.
      * pip install rdkit-pypi -> pip install rdkit (the maintained wheel).

    your workbook was NOT modified.
""").strip())
if INDICATIVE:
    print(f"\n  FINAL REMINDER: this run was underpowered (n = {len(labelled)}). "
          "The machinery is right; the data is not yet enough. Every statistic "
          "above is INDICATIVE.")
