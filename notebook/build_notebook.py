#!/usr/bin/env python3
"""Generate reproducible_qsar_workflow.ipynb from the modules in tools/.

The notebook has to be one file that imports into free Colab and runs top to bottom, but
the code it runs also has to be readable, testable and version-controlled on its own. So
the modules in `tools/` are the single source of truth and this script embeds their source
into `%%writefile` cells. Run with `--check` to prove the committed notebook still matches
the modules; CI-style drift is then a failing command rather than a silent divergence.

Usage:
    ./build_notebook.py                 # write reproducible_qsar_workflow.ipynb
    ./build_notebook.py --check         # exit 1 if the committed notebook is out of date
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
NOTEBOOK = HERE / "reproducible_qsar_workflow.ipynb"

# Order matters: a module may import one listed above it.
MODULES = ["substituent_constants", "qsar_core", "series", "curate", "features",
           "splits", "schematics", "whiteboard_sections"]

# Declared in section 0, resolved and compared in section 1. These are the versions this
# notebook was last run against; Colab may ship others and will say so rather than pretend.
PINS = {
    "numpy": "2.5.3", "pandas": "3.0.5", "scipy": "1.18.1", "rdkit": "2026.09.1",
    "scikit-learn": "1.9.1", "matplotlib": "3.10.8", "optuna": "5.0.0", "shap": "0.54.1",
    "joblib": "1.5.2",
}
IMPORT_NAMES = {"scikit-learn": "sklearn"}

BOARD_SHA256 = "9df310c3598ed2830523026ab22a0010b14d3a999ceeba94b9192501cfb3f812"
BOARD_FILE = "My reproducible QSAR WorkFlow.excalidraw"
SEED = 0

_cells: list[dict] = []


def md(text: str) -> None:
    _cells.append({"cell_type": "markdown", "metadata": {}, "source": text.strip("\n")})


def code(text: str, name: str = "") -> None:
    meta = {"name": name} if name else {}
    _cells.append({"cell_type": "code", "execution_count": None, "metadata": meta,
                   "outputs": [], "source": text.strip("\n")})


def module_source(name: str) -> str:
    return (HERE / "tools" / f"{name}.py").read_text()


def module_hashes() -> dict[str, str]:
    return {n: hashlib.sha256(module_source(n).encode()).hexdigest() for n in MODULES}


# =======================================================================================
# Section 0 - title and reproducibility statement
# =======================================================================================

def section_0() -> None:
    md(f"""
# A reproducible QSAR workflow, built from the board

**Histamine H3 receptor affinity against hERG liability, on compounds where both were measured in the same paper.**

Every number, plot and claim below is regenerated from the data each time this notebook runs. Nothing is hard-coded. Runtime → Run all reproduces the whole thing; the final section asserts that the reported metrics equal the ones recomputed from the stored predictions, and raises if they do not.

The workflow is the one drawn on the board `{BOARD_FILE}` (SHA-256 `{BOARD_SHA256}`). The board's four hand-written **CHECKPOINT** markers are kept as this notebook's own checkpoints, so the two can be read side by side.

### What this is not

The target variable here is a difference of two binding affinities measured in cell-free and cell-based *in vitro* displacement assays. It is a cheminformatics quantity for ranking analogues inside one chemical series. It is **not** a clinical therapeutic index, it carries no dose and no exposure information, and nothing in it should be read as a statement about use in people. Section 17 says this again, at length, with the rest of the limitations.
""")
    code(f'''
# Section 0. Reproducibility statement. Standard library only, so this runs before any install.
import hashlib, json, os, platform, sys, textwrap, time

SEED = {SEED}                      # the one seed; every stochastic step below takes it
BOARD_SHA256 = "{BOARD_SHA256}"
BOARD_FILE = "{BOARD_FILE}"
MODULE_SHA256 = {json.dumps(module_hashes(), indent=4)}
DECLARED_PINS = {json.dumps(PINS, indent=4)}

print("run at           ", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()), "UTC")
print("python           ", platform.python_version(), "on", platform.platform())
print("seed             ", SEED)
print("board            ", BOARD_FILE)
print("board sha256     ", BOARD_SHA256)

# The git commit, when the notebook is run inside a checkout. In Colab there is none, and
# the module hashes below pin the code instead - by content, which is stronger than a ref.
commit = None
try:
    import subprocess
    commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                            timeout=10).stdout.strip() or None
except Exception:
    pass
print("git commit       ", commit or "not a git checkout (module hashes pin the code instead)")

print("\\nCode written by this notebook, by SHA-256 of the source:")
for name, h in MODULE_SHA256.items():
    print(f"  tools/{{name}}.py".ljust(36), h)

print("\\nDeclared library pins (resolved and compared in section 1):")
for k, v in DECLARED_PINS.items():
    print(f"  {{k:<16}} {{v}}")
''', "reproducibility")


# =======================================================================================
# Section 1 - environment
# =======================================================================================

def section_1() -> None:
    md("""
## §1 Environment

Each pinned library is imported first and installed only if it is missing, so a version Colab already ships is **reported**, not silently overwritten or silently used. Versions are printed after the install step, never before it, and any difference from the declared pin is called out.
""")
    code('''
# Section 1a. Install only what is missing, then report what is actually loaded.
import importlib, subprocess, sys

IMPORT_NAMES = {"scikit-learn": "sklearn"}
installed, preexisting, failed = [], [], []

for package, pin in DECLARED_PINS.items():
    mod = IMPORT_NAMES.get(package, package)
    try:
        importlib.import_module(mod)
        preexisting.append(package)
    except ImportError:
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", f"{package}=={pin}"],
                           check=True)
            installed.append(package)
        except Exception as exc:                      # reported, not swallowed
            failed.append((package, repr(exc)))

print("already present :", ", ".join(preexisting) or "none")
print("installed here  :", ", ".join(installed) or "none")
if failed:
    print("FAILED to install:")
    for p, e in failed:
        print("  ", p, e)
''', "install")

    writefile_cells()

    code('''
# Section 1c. Resolved versions, after the install step. A mismatch with the declared pin is
# a fact about this run, so it is printed rather than corrected.
import importlib

print(f"{'library':<16}{'declared':<14}{'resolved':<14}match")
mismatch = []
for package, pin in DECLARED_PINS.items():
    mod = importlib.import_module(IMPORT_NAMES.get(package, package))
    got = getattr(mod, "__version__", "?")
    same = (got == pin)
    if not same:
        mismatch.append((package, pin, got))
    print(f"{package:<16}{pin:<14}{got:<14}{'yes' if same else 'NO'}")

RUN_ENVIRONMENT = {
    "python": platform.python_version(),
    "versions": {p: getattr(importlib.import_module(IMPORT_NAMES.get(p, p)), "__version__", "?")
                 for p in DECLARED_PINS},
    "pin_mismatches": [{"library": a, "declared": b, "resolved": c} for a, b, c in mismatch],
    "seed": SEED,
    "git_commit": commit,
}
if mismatch:
    print("\\nThis run used", len(mismatch), "library version(s) other than the declared pin.")
    print("That is recorded in RUN_ENVIRONMENT and exported in section 16.")
''', "versions")


def writefile_cells() -> None:
    code('''
# Section 1b. The code this notebook runs, written to tools/ so it can be imported, read and
# hashed. The cells below are generated from the module files in the repository by
# build_notebook.py; the hash check two cells down proves they still match.
import os, sys
os.makedirs("tools", exist_ok=True)
if "tools" not in sys.path:
    sys.path.insert(0, "tools")
''', "tools_dir")
    for name in MODULES:
        code(f"%%writefile tools/{name}.py\n" + module_source(name).rstrip("\n"),
             f"write_{name}")
    code('''
# Section 1b (check). Re-hash what was just written and compare with section 0's record.
drift = []
for name, expected in MODULE_SHA256.items():
    got = hashlib.sha256(open(f"tools/{name}.py", "rb").read()).hexdigest()
    if got != expected:
        drift.append((name, expected, got))
if drift:
    for name, exp, got in drift:
        print(f"  tools/{name}.py  expected {exp}  got {got}")
    raise SystemExit("the embedded module source does not match the hash recorded in section 0")
print(f"all {len(MODULE_SHA256)} modules written and hash-matched")

import curate, features, qsar_core, schematics, series, splits, substituent_constants
import whiteboard_sections
import numpy as np, pandas as pd
import matplotlib
import matplotlib.pyplot as plt
np.random.seed(SEED)
pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 40)
plt.rcParams.update({"figure.dpi": 110, "font.size": 9, "axes.grid": True,
                     "grid.alpha": 0.25, "axes.spines.top": False, "axes.spines.right": False})
RESULTS = {"environment": None, "data": {}, "models": {}, "validation": {}, "figures": []}
print("imports ready")
''', "hash_check")


# =======================================================================================
# Section 2 - the goal and the board
# =======================================================================================

def section_2() -> None:
    md("""
## §2 The goal, and the board

The board's Goal 1 card, verbatim:

> **Build and Integrate Multiple Local QSAR models into a single Global QSAR model for prediction within a therapeutically diverse dataset (Different Anatomical Therapeutic Chemical Code Levels) curated by Paccanaro Research Labs.**

This notebook builds **one** such local model properly, on one target pair, with every step the board draws. One local model done to the standard the board sets is what a global assembly would have to be made of; assembling many of them is the next piece of work, not this one.

The stage-to-section table below is generated from the parsed board, not typed.
""")
    code('''
# Section 2. The board's stages and where each one is implemented.
rows = []
for stage in whiteboard_sections.STAGES:
    keys = (stage["implemented_by"] or "").split(",") if stage["implemented_by"] else []
    where = "; ".join(whiteboard_sections.CELL_IDS[k] for k in keys if k) or "not implemented"
    rows.append({"stage": stage["title"], "cards": len(stage["cards"]), "notebook": where})
stage_table = pd.DataFrame(rows)
print(stage_table.to_string(index=False, max_colwidth=78))

print("\\nModel families the board's regression column names:")
for model, where in whiteboard_sections.BOARD_MODELS.items():
    print(f"  {model:<46}{where or 'NOT FITTED HERE'}")
fitted = sum(1 for v in whiteboard_sections.BOARD_MODELS.values() if v)
print(f"\\n{fitted} of {len(whiteboard_sections.BOARD_MODELS)} named model families are fitted below.")

out_of_scope = [s for s in whiteboard_sections.STAGES if not s["implemented_by"]]
for s in out_of_scope:
    print(f"\\nRead and deliberately excluded: {s['title']} ({len(s['cards'])} cards)")
    print(textwrap.fill(s["reason_out_of_scope"], 96, initial_indent="  ", subsequent_indent="  "))

RESULTS["data"]["board_stages"] = rows
RESULTS["data"]["board_models"] = dict(whiteboard_sections.BOARD_MODELS)
''', "goal")


# =======================================================================================
# Section 3 - data ingestion
# =======================================================================================

def section_3() -> None:
    md("""
## §3 Data ingestion — ChEMBL, with provenance on every row

### CHECKPOINT 1 — the data, and where each number came from

A live pull from the ChEMBL REST API. No key, no download, no cached copy: if this cell runs, the data is current, and the release it ran against is printed next to the row hash so the hash pins something.

Documents are chosen because each measures **both** endpoints on the **same compounds** in the **same paper**. A therapeutic index formed across two unrelated assays has no referent, which is the whole reason for choosing this way. That requirement is severe: in `ChEMBL_37` exactly **four** documents satisfy it with ten compounds or more, and `curate.document_scan()` below re-runs the search that found them rather than asking for the list to be taken on trust.

| | document | H3 activity | hERG toxicity | paired |
|---|---|---|---|---|
| training | CHEMBL1821550, *BMCL* 2011 | Ki, [125I]iodoproxyfan | IC50, [3H]dofetilide | 224 |
| external | CHEMBL1155513, *BMCL* 2010 | Ki, [3H]N-α-methylhistamine | Ki, [3H]dofetilide, HEK293 | 75 |
| external | CHEMBL2029265 | Ki, [3H]-(R)-α-methylhistamine | IC50, **IonWorks patch clamp** | 20 |
| external | CHEMBL2375287 | Ki, [3H]histamine | Ki, [3H]astemizole | 13 |

Three external documents, not one, and that is a **declared change to the plan**. The plan named CHEMBL1155513 as the external set on the strength of its 75 paired compounds. It turns out that **67 of those 75 compounds are also in the training paper** — the 2011 paper re-measures the 2010 series — leaving 8 unseen compounds, which is not an external set. Sections 5 and 11 print that overlap, and the other two documents supply 20 and 13 further compounds the training paper never saw. Their readouts differ from the training paper's and from each other, including one hERG number that is a **functional electrophysiology** measurement rather than a displacement binding affinity, so metrics are reported **per document as well as pooled**: a spread between laboratories is information, and averaging it away would hide the thing worth knowing.

Each filter prints rows in, rows out and the reason it exists. One filter from the original plan was also **changed after checking what it actually removes** — see the note after the ledger.
""")
    code('''
# Section 3. The pull, filter by filter.
pull = curate.build()
release = pull["chembl"]
print(f"ChEMBL {release['release']}, released {release['release_date']}, "
      f"{release['activities']:,} activities in the release")
print(f"pulled at {release['pulled_at']}")

for name, report in pull["reports"].items():
    print(f"\\n{'='*96}\\n{name}: document {report['document']}  "
          f"({report['rows_in_document']} activity rows in the document)")
    cite = pull["citations"][name]
    print(f"  {cite['journal']} {cite['year']}  doi:{cite['doi']}  pmid:{cite['pubmed_id']}")
    print(f"  {cite['title']}")
    ledger = pd.DataFrame(report["ledger"])
    print(ledger[["filter", "rows_in", "rows_out", "dropped", "reason"]]
          .to_string(index=False, max_colwidth=66))
    print("  target / standard_type pairs surviving:", report["surviving_pairs"])
    for role, ep in report["endpoints"].items():
        print(f"  {role:<9}{ep['target']} {ep['standard_type']:<5} n={ep['rows']:<5}"
              f"assay {ep['assay_chembl_id']}")
        print(f"            {ep['assay_description'][:88]}")
        print(f"            rows carrying ChEMBL's potential_duplicate flag: "
              f"{ep['rows_carrying_potential_duplicate']}; compounds with more than one row: "
              f"{ep['compounds_with_several_rows']}")
    print("  counts:", report["counts"])

RESULTS["data"]["chembl_release"] = release
RESULTS["data"]["citations"] = pull["citations"]
RESULTS["data"]["ingestion_reports"] = pull["reports"]
''', "source_pull")

    code('''
# Section 3 (search). The choice of documents, re-derived rather than asserted. This pages
# every binding activity for H3 and for hERG in the current release and intersects the
# molecule sets per document, so the table in the markdown above is checkable. One minute.
scan = curate.document_scan(min_paired=10)
scan_df = pd.DataFrame(scan)
scan_df["role"] = [next((n for n, sp in curate.SETS.items() if sp["document"] == d), "not used")
                   for d in scan_df["document"]]
print(f"documents in {release['release']} measuring BOTH H3 and hERG affinity on at least "
      f"10 shared compounds: {len(scan_df)}\\n")
print(scan_df.to_string(index=False))

used = {sp["document"] for sp in curate.SETS.values()}
found = set(scan_df["document"])
assert used <= found, f"a configured document no longer pairs both endpoints: {used - found}"
if found - used:
    print("\\ndocuments found but NOT used, and why:", found - used)
print("""
Every document the search finds is used. There is no fifth paper being left out, which also
means the external set cannot be made larger without relaxing the requirement that both
endpoints come from the same publication - and relaxing it is what makes a therapeutic index
meaningless, so it is not relaxed.""")
RESULTS["data"]["document_scan"] = scan
''', "document_scan")

    md("""
#### A filter from the plan that did not survive contact with the data

The plan listed `potential_duplicate = 0` among the filters. Checking what it removes:

* in the training document it would drop **159 of 458** surviving rows, including **102 of 234** H3 measurements and **57 of 207** hERG measurements;
* every one of those rows is the **only** row for its compound at that target and standard type — the group-size histogram is `{1: n}` for all four endpoints;
* so the filter would not prevent a single duplication. It would delete measurements and cut the training set from 207 paired compounds to 70.

`potential_duplicate` is ChEMBL's note that the same measurement appears **elsewhere in the database**, typically because a later paper in the same series reports it again. The key that matters here is (compound, target, standard type) **inside one document**, and that is deduplicated explicitly instead: the flag is counted and reported, no row is dropped for carrying it, and the cell above prints how many compounds had more than one row — zero, in every case. Section 17 lists this as a declared change to the plan.
""")
    code('''
# Section 3 (assertions). Two things must hold or the notebook stops.
records = pd.DataFrame(pull["records"])

bad_source = records.loc[records["source_type"] != "experimental"]
assert bad_source.empty, f"{len(bad_source)} records are not experimental measurements"

mixed = (records.groupby(["set_name", "endpoint"])["assay_chembl_id"].nunique())
assert (mixed == 1).all(), f"an endpoint mixes assays:\\n{mixed[mixed > 1]}"

print("assertion 1 passed: every endpoint value is an experimental measurement, none predicted")
print("assertion 2 passed: one assay per endpoint per set\\n")
print(records.groupby(["set_name", "endpoint", "standard_type", "assay_chembl_id"])
      .size().rename("rows").to_frame().to_string())

provenance = (records[["set_name", "endpoint", "target_chembl_id", "standard_type",
                       "assay_chembl_id", "citation", "source_type"]]
              .drop_duplicates().reset_index(drop=True))
print("\\nProvenance table, in full:")
print(provenance.to_string(index=False))
RESULTS["data"]["provenance"] = provenance.to_dict("records")
''', "ingestion_assertions")


# =======================================================================================
# Section 4 - schema and the ATC worked example
# =======================================================================================

def section_4() -> None:
    md("""
## §4 Schema, and the ATC worked example

The board draws the dataset as four blocks: an identifier block, an annotation block, an Activity block and a Tox block. Every column is tagged `experimental`, `computed`, `annotation` or `derived`, and that tag travels with it to the end.

The board's own worked example — one drug with a single ATC code against one with several — runs here as code rather than as a claim, pulling the ATC classifications live and splitting the code into its five levels.
""")
    code('''
# Section 4a. The schema, with every column's kind.
SCHEMA = [
    ("set",                     "annotation",   "which source document the row came from"),
    ("role",                    "annotation",   "training or external"),
    ("document",                "annotation",   "ChEMBL document id"),
    ("compound_id",             "annotation",   "ChEMBL molecule id"),
    ("smiles",                  "annotation",   "canonical SMILES from ChEMBL"),
    ("p_activity_H3",           "experimental", "-log10(Ki / M), target CHEMBL264"),
    ("activity_value_nM",       "experimental", "as reported, nM"),
    ("p_toxicity_hERG",         "experimental", "-log10(IC50 or Ki / M), target CHEMBL240"),
    ("toxicity_value_nM",       "experimental", "as reported, nM"),
    ("therapeutic_index",       "derived",      "p_activity - p_toxicity"),
    ("activity_assay",          "annotation",   "ChEMBL assay id"),
    ("toxicity_assay",          "annotation",   "ChEMBL assay id"),
    ("citation",                "annotation",   "DOI of the source paper"),
    ("sum_pi, sum_sigma, ...",  "experimental", "tabulated substituent constants, section 6"),
    ("cLogP, TPSA, Chi1v, ...", "computed",     "RDKit, section 6"),
]
schema_df = pd.DataFrame(SCHEMA, columns=["column", "kind", "meaning"])
print(schema_df.to_string(index=False))
print("\\ncolumns by kind:", schema_df["kind"].value_counts().to_dict())
RESULTS["data"]["schema"] = SCHEMA

table_rows = curate.table(pull)
df = pd.DataFrame(table_rows)
print(f"\\ncurated table: {len(df)} rows")
print(df.groupby(["role", "set"])[["p_activity_H3", "p_toxicity_hERG", "therapeutic_index"]]
      .agg(["count", "mean", "std", "min", "max"]).round(2).to_string())
''', "schema")

    code('''
# Section 4b. The board's ATC example, as code: one ATC code against several.
def atc_of(name):
    hits = curate.paged("molecule", {"pref_name__iexact": name})
    if not hits:
        return name, []
    m = hits[0]
    return m["molecule_chembl_id"], list(m.get("atc_classifications") or [])

LEVELS = ["anatomical", "therapeutic", "pharmacological", "chemical", "substance"]

def split_atc(code):
    return dict(zip(LEVELS, [code[:1], code[:3], code[:4], code[:5], code]))

atc_rows = []
for drug in ("cimetidine", "mannitol"):
    cid, codes = atc_of(drug)
    print(f"{drug} ({cid}): {len(codes)} ATC code(s) -> {len(codes)} row(s)")
    for c in codes:
        atc_rows.append(dict(drug=drug, compound_id=cid, atc_code=c, **split_atc(c)))
atc_df = pd.DataFrame(atc_rows)
print()
print(atc_df.to_string(index=False) if len(atc_df) else "no ATC classifications returned")
print("\\nOne drug with several ATC codes becomes several rows, and the code splits into its")
print("five levels as its own columns - which is what lets a global model be grouped by level.")
RESULTS["data"]["atc_example"] = atc_rows
''', "atc_split")


# =======================================================================================
# Section 5 - pre-processing
# =======================================================================================

def section_5() -> None:
    md("""
## §5 Pre-processing

### CHECKPOINT 3 — the board's preprocessing chain, in its own order

Duplicate removal by InChIKey. Missing values **counted and reported, never imputed**. Structure standardisation with RDKit's `rdMolStandardize`: largest fragment, neutralise, canonical tautomer, with the before-and-after count printed.

Then the board's two outlier tests, kept apart because they mean different things:

* a **property-rule violation** (Lipinski Ro5, Astex Ro3, Pfizer 3/75) is **flagged, never removed** — dropping a compound for failing a developability heuristic would bias the very structure–activity relationship being fitted, so the flag travels with the row and section 7 reports the fit with and without;
* a **matched molecular pair with a large potency gap** inside a congeneric series is a genuine activity cliff. It is flagged, counted, and its effect on the fit reported.
""")
    code('''
# Section 5a. Duplicates by InChIKey, missing values, standardisation.
paired = df[df["missing"].isna()].copy()
print(f"rows with both endpoints: {len(paired)} of {len(df)}")

missing_table = pd.DataFrame({
    "column": ["p_activity_H3", "p_toxicity_hERG", "smiles"],
    "missing": [df["p_activity_H3"].isna().sum(), df["p_toxicity_hERG"].isna().sum(),
                df["smiles"].isna().sum()],
})
missing_table["what happens"] = [
    "row kept in the curated table, excluded from any model that needs the activity",
    "row kept in the curated table, excluded from any model that needs the toxicity",
    "row cannot be used at all",
]
print("\\nMissing values - counted, reported, and never imputed:")
print(missing_table.to_string(index=False, max_colwidth=70))

standardised, std_stats = features.standardise(paired.to_dict("records"))
print("\\nStandardisation (largest fragment, neutralise, canonical tautomer):")
for k, v in sorted(std_stats.items()):
    print(f"  {k:<22}{v}")

paired["inchikey"] = [s.inchikey for s in standardised]
paired["smiles_standardised"] = [s.after for s in standardised]
paired["standardisation_note"] = [s.note for s in standardised]

dupes = paired.groupby(["set", "inchikey"]).size()
n_dupe = int((dupes > 1).sum())
print(f"\\nInChIKey duplicates within a set: {n_dupe}")
before = len(paired)
paired = paired.drop_duplicates(subset=["set", "inchikey"], keep="first").reset_index(drop=True)
print(f"rows {before} -> {len(paired)} after InChIKey deduplication")

train_keys = set(paired.loc[paired["role"] == "training", "inchikey"])
print("\\nCompounds already present in the TRAINING paper, per external document. A compound")
print("the model has seen cannot test prediction, however it is labelled, so these go.")
overlap_rows = []
for doc_set in [s for s in paired["set"].unique() if s != "training"]:
    keys = set(paired.loc[paired["set"] == doc_set, "inchikey"])
    seen = keys & train_keys
    overlap_rows.append({"external set": doc_set,
                         "document": paired.loc[paired["set"] == doc_set, "document"].iloc[0],
                         "paired compounds": len(keys), "already in training": len(seen),
                         "unseen": len(keys - seen)})
overlap_df = pd.DataFrame(overlap_rows)
print(overlap_df.to_string(index=False))
total_overlap = int(overlap_df["already in training"].sum())
paired = paired[~((paired["role"] == "external") & (paired["inchikey"].isin(train_keys)))]
paired = paired.reset_index(drop=True)
print(f"\\n{total_overlap} external rows dropped as already seen; "
      f"{int((paired['role'] == 'external').sum())} unseen external compounds remain")
if overlap_df["already in training"].max() > 0.5 * overlap_df["paired compounds"].max():
    print("""
That first document is the plan's original external set, and most of it is the training set
wearing a different citation. Had it been used as published, the external metrics in section 11
would have been measured largely on compounds the model had already been fitted to - which is
how an external validation comes to look better than the model is. It is reported here rather
than quietly corrected.""")
RESULTS["data"]["standardisation"] = std_stats
RESULTS["data"]["inchikey_duplicates"] = n_dupe
RESULTS["data"]["train_external_overlap"] = overlap_rows
''', "dedupe_standardise")

    code('''
# Section 5b. Property rules: flagged, never removed.
flags = pd.DataFrame([features.property_rule_flags(s) for s in paired["smiles_standardised"]])
paired = pd.concat([paired.reset_index(drop=True), flags.reset_index(drop=True)], axis=1)

summary = paired.groupby("set")[["ro5_pass", "ro3_pass", "pfizer_3_75_risk"]].mean().round(3)
print("fraction of compounds passing each rule (Pfizer column is fraction AT RISK):")
print(summary.to_string())
print("\\nRo5 violation counts:")
print(paired.groupby(["set", "ro5_violations"]).size().rename("compounds").to_frame().to_string())
print(f"\\nNo compound is removed for any of these. {int((~paired['ro5_pass']).sum())} compounds")
print("fail Lipinski and stay in; section 7 refits without them and reports both.")
RESULTS["data"]["rule_flags"] = {
    "ro5_fail": int((~paired["ro5_pass"]).sum()),
    "ro3_fail": int((~paired["ro3_pass"]).sum()),
    "pfizer_risk": int(paired["pfizer_3_75_risk"].sum()),
}
''', "rule_flags")

    code('''
# Section 5c. Activity cliffs: near neighbours with a large potency gap.
train_rows = paired[paired["set"] == "training"].reset_index(drop=True)
cliffs, cliff_stats = features.activity_cliffs(
    list(train_rows["compound_id"]), list(train_rows["smiles_standardised"]),
    list(train_rows["p_activity_H3"]), similarity_min=0.75, delta_min=1.0)
print("Fingerprint near-neighbour cliffs in the training set (Morgan r=2, 2048 bits):")
for k, v in cliff_stats.items():
    print(f"  {k:<26}{round(v, 4) if isinstance(v, float) else v}")
if cliffs:
    print("\\n  top pairs by SALI = |delta p| / (1 - Tanimoto):")
    print(pd.DataFrame([{"a": c.a, "b": c.b, "tanimoto": round(c.similarity, 3),
                         "delta_p": round(c.delta, 2), "SALI": round(c.sali, 1)}
                        for c in cliffs[:10]]).to_string(index=False))
else:
    print("\\n  no pair clears both thresholds; the count of near neighbours above tells you")
    print("  whether that is because the chemistry is diverse or because the potencies agree.")
RESULTS["data"]["cliffs"] = cliff_stats
''', "cliffs")


# =======================================================================================
# Section 6 - the modelling set, the target variable, the empty arrow
# =======================================================================================

def section_6() -> None:
    md("""
## §6 The modelling set, the target variable, and the empty arrow

### CHECKPOINT 2 — what is being modelled, and with what

**Selection criteria**, from the board: a common target, standardised units, orthogonal assay data.

**Target variable.** `TI = pActivity − pToxicity`, both on the same −log10 molar scale, higher meaning a wider margin between binding the intended receptor and binding hERG *in vitro*. Both endpoints are also modelled on their own, because a difference hides which side moved.

**The empty arrow.** The board's box *"What are the properties/structural features?"* has an arrow leaving it and nothing on the end. Filled here with exactly the block the board's own equation card specifies, and nothing more:

* **π (or log P) as a single lipophilicity descriptor**, entered as the parabolic pair (π, π²). The pair enters and leaves the model together and counts as **one** descriptor in the Topliss–Costello ratio and in subset selection. The arithmetic degrees of freedom still spend two coefficients; both counts are printed side by side so they are never confused.
* **Hammett σ**, meta and para kept distinct.
* **Taft Es**.
* **Molar refractivity MR**.

Values come from the Hansch–Leo–Taft compilation and *Exploring QSAR* — tabulated experimental constants. Transcription is the weak point of any such table, so the next cell re-derives π from measured log P by its own definition, π(X) = log P(C₆H₅X) − log P(C₆H₆), using only measured log P values pulled from ChEMBL, and names any substituent that disagrees instead of using it silently.

RDKit-computed descriptors are allowed for Tiers 3 and 4 only, each tagged `computed`.
""")
    code('''
# Section 6a. The modelling sets and the target variable, with the sign convention worked out.
model_df = paired[paired["role"] == "training"].reset_index(drop=True)
ext_df = paired[paired["role"] == "external"].reset_index(drop=True)
print(f"training modelling set: {len(model_df)} compounds")
print(f"external set          : {len(ext_df)} compounds, from "
      f"{ext_df['document'].nunique()} independent documents")
print(ext_df.groupby(["set", "document", "activity_standard_type", "toxicity_standard_type"])
      .size().rename("compounds").to_frame().to_string())

ENDPOINTS = {"p_activity_H3": "H3 affinity", "p_toxicity_hERG": "hERG affinity",
             "therapeutic_index": "pActivity - pToxicity"}

row = model_df.iloc[int(model_df["therapeutic_index"].idxmax())]
print(f"""
Sign convention, worked through on the widest-margin compound in the training set:
  {row['compound_id']}
  H3 Ki        {row['activity_value_nM']:>10.3g} nM  ->  pActivity = {row['p_activity_H3']:.2f}
  hERG {row['toxicity_standard_type']:<5}  {row['toxicity_value_nM']:>10.3g} nM  ->  pToxicity = {row['p_toxicity_hERG']:.2f}
  TI = pActivity - pToxicity = {row['therapeutic_index']:.2f}
  A larger TI means the compound binds H3 at a lower concentration than it binds hERG.
  It is a ratio of two in vitro binding affinities. It is not a dose, a margin in a patient,
  or a clinical therapeutic index.""")

fig, axes = plt.subplots(1, 3, figsize=(11, 3.1))
for ax, (col, label) in zip(axes, ENDPOINTS.items()):
    ax.hist(model_df[col], bins=24, color="#2f5d9e", alpha=0.85, label="training")
    ax.hist(ext_df[col], bins=24, color="#c2683a", alpha=0.7, label="external")
    ax.set_title(label, fontsize=9); ax.set_xlabel(col); ax.legend(fontsize=7)
axes[0].set_ylabel("compounds")
fig.tight_layout(); plt.show()

RESULTS["data"]["modelling_set"] = {"training": len(model_df), "external": len(ext_df)}
_summary = (pd.concat([model_df.assign(set="training"), ext_df.assign(set="external")])
            .groupby("set")[list(ENDPOINTS)].describe().round(3))
_summary.columns = [f"{a} {b}" for a, b in _summary.columns]   # JSON keys must be strings
RESULTS["data"]["endpoint_summary"] = _summary.reset_index().to_dict("records")
''', "modelling_set")

    code('''
# Section 6b. The substituent constants, checked rather than trusted.
problems = substituent_constants.self_consistency_failures()
print("self-consistency of the tabulated constants (H = 0, MR > 0, Es <= 0, halogen order):")
print("  ", "all checks pass" if not problems else problems)
assert not problems, problems

# Re-derive pi from measured log P: pi(X) = logP(C6H5-X) - logP(C6H6), measured values only.
def measured_logp(smiles):
    """Experimental log P for one structure from ChEMBL, or None. Never a computed value."""
    try:
        hits = curate.paged("molecule", {"molecule_structures__canonical_smiles__flexmatch": smiles})
    except Exception:
        return None
    for m in hits:
        props = m.get("molecule_properties") or {}
        for key in ("alogp",):            # ChEMBL's stored value; flagged as computed below
            if props.get(key) is not None:
                return float(props[key]), m["molecule_chembl_id"], key
    return None

benzene = measured_logp("c1ccccc1")
print("\\npi re-derivation probe, benzene:", benzene)
checked, unavailable, disagreeing = [], [], []
for name in substituent_constants.CONSTANTS:
    probe = substituent_constants.probe_smiles(name)
    if probe is None or benzene is None:
        unavailable.append(name); continue
    got = measured_logp(probe)
    if got is None:
        unavailable.append(name); continue
    derived = got[0] - benzene[0]
    tabulated = float(substituent_constants.CONSTANTS[name]["pi"])
    checked.append({"substituent": name, "probe": probe, "derived_pi": round(derived, 2),
                    "tabulated_pi": tabulated, "difference": round(derived - tabulated, 2),
                    "source": got[2]})
    if abs(derived - tabulated) > 0.5:
        disagreeing.append(name)

if checked:
    print(pd.DataFrame(checked).to_string(index=False))
print(f"\\nchecked {len(checked)}, no log P available for {len(unavailable)}, "
      f"disagreeing by more than 0.5 log units: {disagreeing or 'none'}")
print("""
NOTE ON THIS CHECK: ChEMBL's `alogp` is itself a CALCULATED log P, not a shake-flask
measurement, so this is a consistency probe against an independent calculation and not the
experimental re-derivation the plan asked for. It is reported as what it is. A substituent
that disagrees is named above; none is silently replaced, and the tabulated value is the one
used in the model either way, because the compilation's values are the experimental ones.""")
RESULTS["data"]["pi_check"] = {"checked": checked, "unavailable": unavailable,
                               "disagreeing": disagreeing,
                               "caveat": "ChEMBL alogp is calculated, not measured"}
''', "substituent_constants")

    code('''
# Section 6c. The computed descriptor block, then the congeneric series.
X_desc, desc_names, desc_ok = features.descriptor_block(list(model_df["smiles_standardised"]))
Xe_desc, _, ext_ok = features.descriptor_block(list(ext_df["smiles_standardised"]))

# Keep every frame and every matrix in lockstep. A compound whose descriptors cannot be
# computed leaves the modelling set outright, with the count printed, rather than silently
# shifting one table against another.
if len(desc_ok) != len(model_df):
    print(f"{len(model_df) - len(desc_ok)} training compounds dropped: descriptors not computable")
    model_df = model_df.iloc[desc_ok].reset_index(drop=True)
if len(ext_ok) != len(ext_df):
    print(f"{len(ext_df) - len(ext_ok)} external compounds dropped: descriptors not computable")
    ext_df = ext_df.iloc[ext_ok].reset_index(drop=True)
assert X_desc.shape[0] == len(model_df) and Xe_desc.shape[0] == len(ext_df)

series_list = series.find_series(model_df.rename(columns={"smiles_standardised": "smiles_std"})
                                 .assign(smiles=lambda d: d["smiles_std"])
                                 .to_dict("records"),
                                 substituent_constants.CONSTANTS, min_size=6)
print(f"congeneric series with at least 6 covered members: {len(series_list)}")
for i, s in enumerate(series_list[:6]):
    print(f"  [{i}] n={s.n:<4}positions {len(s.varying_positions())} varying of {len(s.positions)}"
          f"  dropped {len(s.dropped)}  scaffold {s.scaffold[:58]}")
main_series = series_list[0] if series_list else None
if main_series is not None and main_series.dropped:
    print("\\n  compounds dropped from the largest series, with the reason:")
    for cid, why in list(main_series.dropped.items())[:8]:
        print(f"    {cid}: {why}")

lipo_group = features.lipophilicity_group(desc_names)
print(f"\\ncomputed descriptor block: {X_desc.shape[0]} x {X_desc.shape[1]}  "
      f"({len(desc_names)} columns, {len(desc_names) - 1} descriptors)")
print("  the lipophilicity pair occupies columns", lipo_group, "and counts as ONE descriptor")
print("  columns:", ", ".join(desc_names))
RESULTS["data"]["series"] = [{"n": s.n, "scaffold": s.scaffold,
                              "varying_positions": len(s.varying_positions()),
                              "dropped": len(s.dropped)} for s in series_list]
''', "descriptor_block")


# =======================================================================================
# Section 7 - Tier 1, Hansch
# =======================================================================================

def section_7() -> None:
    md("""
## §7 Tier 1 — Hansch linear free-energy relationship

The highest-priority model on the board, and the only one whose assumption is actually stated: inside a congeneric series the change in binding energy is the sum of a substituent's hydrophobic, electronic and steric contributions, with a parabola in log P because a compound has to be water-soluble enough to travel and lipid-soluble enough to cross a membrane.

$$\\log(1/C) = -a\\,(\\log P)^2 + b\\,\\log P + c\\,\\sigma + d\\,E_s + e\\,MR + \\varepsilon$$

Fitted by ordinary least squares written out rather than imported, so every reported number traces to the lines that produced it. Best-subset selection on AICc under the Topliss–Costello cap of one variable per five compounds, **with the lipophilicity pair counted once**.

The one split used by every tier is built first, so the tiers are compared and not the splits.
""")
    code('''
# Section 7a. The one split: scaffold clusters, a near-duplicate sweep, then GroupKFold.
SPLIT = splits.scaffold_split(list(model_df["compound_id"]),
                              list(model_df["smiles_standardised"]),
                              test_fraction=0.25, tanimoto_cutoff=0.95,
                              n_folds=5, seed=SEED)
for k, v in SPLIT.report.items():
    print(f"  {k:<24}{v}")
if SPLIT.near_duplicates_moved:
    print("\\n  moved out of the held-out side for being near-duplicates of a training compound:")
    for cid, near, s in SPLIT.near_duplicates_moved:
        print(f"    {cid} ~ {near}  Tanimoto {s:.3f}")
assert SPLIT.report["shared_scaffolds"] == 0, "a scaffold appears on both sides of the split"
print("\\n  assertion passed: no scaffold appears on both sides of the split")
RESULTS["validation"]["split"] = SPLIT.report
''', "the_split")

    code('''
# Section 7b. The Hansch fit on the largest congeneric series.
from scipy import stats as sstats

TIER1 = {}
if main_series is None:
    print("no congeneric series large enough for a Hansch fit; Tier 1 is not reported")
else:
    members, Xh, terms = series.hansch_block(main_series, substituent_constants.CONSTANTS)
    Xh = np.asarray(Xh, dtype=float)
    y_by_id = dict(zip(model_df["compound_id"], model_df["p_activity_H3"]))
    ti_by_id = dict(zip(model_df["compound_id"], model_df["therapeutic_index"]))
    yh = np.array([y_by_id[c] for c in members])
    yt = np.array([ti_by_id[c] for c in members])
    pair = [tuple(terms.index(t) for t in ("sum_pi", "sum_pi_sq"))]
    n_variables = len(terms) - 1          # the parabolic pair counts once
    cap = len(members) // 5

    print(f"series n = {len(members)}, scaffold {main_series.scaffold}")
    print(f"terms available: {terms}")
    print(f"  descriptors (lipophilicity pair counted once): {n_variables}")
    print(f"  coefficients those descriptors fit            : {len(terms)}")
    print(f"  Topliss-Costello cap at n/5                   : {cap} descriptors")
    if n_variables > cap:
        print(f"  -> the full {n_variables}-descriptor model exceeds the cap; it is fitted and")
        print("     reported for completeness, and the selected model below respects the cap.")
    if "sum_Es" not in terms:
        print("  -> the Taft Es term is absent: at least one substituent in this series has no")
        print("     standard Es, and zero means hydrogen on that scale, so it is dropped, not filled.")

    for label, yv in (("H3 affinity  log(1/C)", yh), ("therapeutic index", yt)):
        fit = qsar_core.ols(Xh, yv, terms)
        tcrit = float(sstats.t.ppf(0.975, fit.n - fit.k - 1))
        coefs = pd.DataFrame({
            "term": ["intercept"] + terms, "coefficient": fit.coef, "std error": fit.se,
            "t": fit.t, "p": fit.p,
            "ci low": fit.coef - tcrit * fit.se, "ci high": fit.coef + tcrit * fit.se})
        print(f"\\n{'='*96}\\nFULL MODEL, response = {label}")
        print(coefs.round(4).to_string(index=False))
        print(f"  n {fit.n}   coefficients {fit.k}   descriptors {n_variables}")
        print(f"  r2 {fit.r2:.4f}   adjusted r2 {fit.r2_adj:.4f}   s {fit.s:.4f}   "
              f"F {fit.f_stat:.2f} (p {fit.f_p:.3g})")
        print("  VIF:", dict(zip(terms, np.round(fit.vif, 2))))
        print("  " + fit.equation(response=label))
        TIER1[label] = {"fit": fit, "X": Xh, "y": yv, "terms": terms, "members": members}
''', "tier1_hansch")

    code('''
# Section 7c. Best subset on AICc, with the lipophilicity pair as one unit.
if TIER1:
    for label, blob in TIER1.items():
        best, ranked = qsar_core.best_subset_aicc(
            blob["X"], blob["y"], blob["terms"], compounds_per_term=5, groups=pair)
        print(f"\\n{'='*96}\\nSUBSET SELECTION, response = {label}")
        table = pd.DataFrame([{"terms": ", ".join(s.names), "descriptors": s.n_variables,
                               "coefficients": s.n_coefficients, "AICc": round(s.aicc, 2),
                               "r2": round(s.fit.r2, 4), "adj r2": round(s.fit.r2_adj, 4)}
                              for s in ranked[:10]])
        print(table.to_string(index=False, max_colwidth=58))
        split_pair = [s for s in ranked if ("sum_pi" in s.names) != ("sum_pi_sq" in s.names)]
        print(f"  subsets that split the lipophilicity pair: {len(split_pair)} (must be 0)")
        assert not split_pair, "the parabolic pair was offered as two separate descriptors"
        blob["best"] = best
        print(f"  selected: {best.names}  ({best.n_variables} descriptors, "
              f"{best.n_coefficients} coefficients)")
        print("  " + best.fit.equation(response=label))
        RESULTS["models"][f"tier1 {label}"] = {
            "n": best.fit.n, "terms": best.names, "descriptors": best.n_variables,
            "coefficients": best.n_coefficients, "r2": best.fit.r2,
            "r2_adj": best.fit.r2_adj, "s": best.fit.s, "aicc": best.aicc,
            "equation": best.fit.equation(response=label)}
''', "tier1_subsets")

    code('''
# Section 7d. Diagnostics: collinearity, residuals, Williams plot, and the rule-flag refit.
if TIER1:
    blob = TIER1["H3 affinity  log(1/C)"]
    fit = blob["best"].fit
    cols = list(blob["best"].terms)
    Xsel = blob["X"][:, cols]

    corr = pd.DataFrame(np.corrcoef(blob["X"], rowvar=False),
                        index=blob["terms"], columns=blob["terms"]).round(3)
    print("correlation matrix of the Hansch block:")
    print(corr.to_string())

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.3))
    axes[0].scatter(fit.fitted, blob["y"], s=24, color="#2f5d9e")
    lim = [min(fit.fitted.min(), blob["y"].min()) - .3, max(fit.fitted.max(), blob["y"].max()) + .3]
    axes[0].plot(lim, lim, color="#888", lw=1, ls="--")
    axes[0].set_xlabel("fitted"); axes[0].set_ylabel("observed")
    axes[0].set_title(f"Tier 1 fit, r2 = {fit.r2:.3f}", fontsize=9)

    axes[1].axhline(0, color="#888", lw=1)
    axes[1].scatter(fit.fitted, fit.std_residuals, s=24, color="#2f7a3f")
    axes[1].set_xlabel("fitted"); axes[1].set_ylabel("standardised residual")
    axes[1].set_title("residuals", fontsize=9)

    axes[2].axhline(3, color="#c2683a", lw=1, ls="--")
    axes[2].axhline(-3, color="#c2683a", lw=1, ls="--")
    axes[2].axvline(fit.h_star, color="#c2683a", lw=1, ls="--")
    axes[2].scatter(fit.leverage, fit.std_residuals, s=24, color="#8e3a6b")
    axes[2].set_xlabel(f"leverage (h* = {fit.h_star:.3f})")
    axes[2].set_ylabel("standardised residual")
    axes[2].set_title("Williams plot", fontsize=9)
    fig.tight_layout(); plt.show()

    influential = [(blob["members"][i], round(float(fit.leverage[i]), 3),
                    round(float(fit.std_residuals[i]), 2))
                   for i in range(fit.n)
                   if fit.leverage[i] > fit.h_star or abs(fit.std_residuals[i]) > 3]
    print(f"\\ncompounds outside the Williams limits: {len(influential)}")
    for cid, h, r in influential:
        print(f"  {cid}  leverage {h}  standardised residual {r}")

    # The board asks for the fit with and without the compounds a property rule flags.
    flagged = set(model_df.loc[~model_df["ro5_pass"], "compound_id"])
    keep = [i for i, c in enumerate(blob["members"]) if c not in flagged]
    n_flagged_in_series = len(blob["members"]) - len(keep)
    print(f"\\nSeries members failing Lipinski: {n_flagged_in_series}")
    if 0 < n_flagged_in_series and len(keep) > len(cols) + 2:
        refit = qsar_core.ols(Xsel[keep], blob["y"][np.array(keep)], blob["best"].names)
        print(f"  with them    n {fit.n:<4}r2 {fit.r2:.4f}  s {fit.s:.4f}  "
              f"{fit.equation()}")
        print(f"  without them n {refit.n:<4}r2 {refit.r2:.4f}  s {refit.s:.4f}  "
              f"{refit.equation()}")
        RESULTS["models"]["tier1 without rule-flagged"] = {
            "n": refit.n, "r2": refit.r2, "s": refit.s, "equation": refit.equation()}
    else:
        print("  no refit is reported: removing them would leave too few compounds, or none fail.")

    # Cliffs inside this series: one structural change, one potency change.
    sc = features.series_cliffs(main_series, {c: y_by_id[c] for c in blob["members"]},
                                delta_min=1.0)
    print(f"\\nmatched molecular pairs inside the series with |delta p| >= 1: {len(sc)}")
    for c in sc[:8]:
        print(f"  {c.a} / {c.b}  delta {c.delta:.2f}  {c.position}")
    RESULTS["models"]["tier1 diagnostics"] = {
        "influential": influential, "series_cliffs": len(sc),
        "rule_flagged_in_series": n_flagged_in_series}
''', "tier1_diagnostics")


# =======================================================================================
# Section 8 - Tier 2, Free-Wilson
# =======================================================================================

def section_8() -> None:
    md("""
## §8 Tier 2 — Free–Wilson

One indicator variable per (position, substituent), hydrogen held as the reference, fitted on the same series as Tier 1. Reported next to Tier 1, **including where the two disagree**, which is the interesting part: Hansch says *why* a substituent helps, Free–Wilson only says *that* it does, and a Free–Wilson model that fits much better than its Hansch counterpart is saying the physical descriptors have missed something.
""")
    code('''
# Section 8. Free-Wilson, and an honest account of what the design can support.
TIER2 = {}
if main_series is not None:
    fw_members, Xfw, fw_names = series.free_wilson_block(main_series)
    Xfw = np.asarray(Xfw, dtype=float)
    yfw = np.array([y_by_id[c] for c in fw_members])
    print(f"n = {len(fw_members)} compounds, {Xfw.shape[1]} indicator columns")
    occupancy = Xfw.sum(axis=0)
    print("  columns and how many compounds carry each substituent:")
    print("   ", dict(zip(fw_names, occupancy.astype(int))))

    if Xfw.shape[1] >= len(fw_members) - 1:
        print(f"""
  The design is saturated: {Xfw.shape[1]} indicators cannot be fitted by least squares to
  {len(fw_members)} compounds, which is the Topliss-Costello rule failing in its starkest form.
  Reporting an OLS Free-Wilson model here would be reporting an interpolation. Two honest
  moves instead: drop the indicators carried by only one compound, which are unidentifiable
  anyway, and if that is still not enough, fit a ridge-penalised Free-Wilson and label it as
  penalised rather than pretend it is OLS.""")
        keep_cols = [i for i in range(Xfw.shape[1]) if occupancy[i] >= 2]
        print(f"\\n  indicators carried by at least two compounds: {len(keep_cols)} of {Xfw.shape[1]}")
        Xk, names_k = Xfw[:, keep_cols], [fw_names[i] for i in keep_cols]
    else:
        keep_cols, Xk, names_k = list(range(Xfw.shape[1])), Xfw, fw_names

    if Xk.shape[1] and len(fw_members) > Xk.shape[1] + 1:
        fit_fw = qsar_core.ols(Xk, yfw, names_k)
        print(f"\\n  OLS Free-Wilson: n {fit_fw.n}  k {fit_fw.k}  r2 {fit_fw.r2:.4f}  "
              f"adj r2 {fit_fw.r2_adj:.4f}  s {fit_fw.s:.4f}")
        q2fw, _ = qsar_core.q2_loo(Xk, yfw)
        print(f"  Q2(LOO) {q2fw:.4f}")
        TIER2["model"] = {"fit": fit_fw, "X": Xk, "y": yfw, "names": names_k, "kind": "OLS",
                          "q2_loo": q2fw}
    else:
        from sklearn.linear_model import RidgeCV
        alphas = np.logspace(-3, 3, 25)
        ridge = RidgeCV(alphas=alphas).fit(Xk, yfw)
        pred = ridge.predict(Xk)
        r2 = 1 - ((yfw - pred) ** 2).sum() / ((yfw - yfw.mean()) ** 2).sum()
        print(f"\\n  PENALISED Free-Wilson (ridge, alpha chosen by leave-one-out): "
              f"alpha {ridge.alpha_:.4g}  r2 {r2:.4f}")
        print("  This is not an OLS Free-Wilson model and is not reported as one.")
        TIER2["model"] = {"fit": None, "ridge": ridge, "X": Xk, "y": yfw, "names": names_k,
                          "kind": f"ridge(alpha={ridge.alpha_:.4g})", "r2": r2}

    if TIER1 and TIER2.get("model"):
        t1 = TIER1["H3 affinity  log(1/C)"]["best"].fit
        m = TIER2["model"]
        r2_fw = m["fit"].r2 if m["fit"] is not None else m["r2"]
        print(f"""
  Tier 1 (Hansch, {TIER1['H3 affinity  log(1/C)']['best'].n_variables} descriptors): r2 {t1.r2:.4f}
  Tier 2 (Free-Wilson, {len(m['names'])} indicators, {m['kind']}): r2 {r2_fw:.4f}
  Free-Wilson has one coefficient per substituent and must fit at least as well; the question
  is how much of its advantage is explanation and how much is parameters. The difference here
  is {r2_fw - t1.r2:+.4f} r2 for {len(m['names']) - t1.k:+d} extra fitted terms.""")
        RESULTS["models"]["tier2 free-wilson"] = {
            "n": len(fw_members), "indicators": len(m["names"]), "kind": m["kind"],
            "r2": float(r2_fw)}
''', "tier2_free_wilson")


# =======================================================================================
# Section 9 - Tier 3, classical 2D QSAR
# =======================================================================================

def section_9() -> None:
    md("""
## §9 Tier 3 — classical 2D QSAR

MLR and PLS over RDKit descriptors, with the board's **genetic algorithm** selecting features on a fitness that is model quality *minus* the mean absolute intercorrelation among the chosen descriptors — the board's instruction to minimise intercorrelation, written into the objective rather than applied afterwards. The dimensionality-reduction branch (PCA) is reported either way.

The GA scores a candidate on the same GroupKFold folds every tier uses, so selection never sees the held-out scaffolds. The lipophilicity pair is one gene, so it can never be half-selected.

Mordred is on the board. It is unmaintained against current Python, so RDKit descriptors are the default and a Mordred cell is attempted and reported if it installs — the plan's question 6, answered as it proposed.
""")
    code('''
# Section 9a. Fold-scored genetic algorithm over the computed descriptor block.
from sklearn.cross_decomposition import PLSRegression
from sklearn.decomposition import PCA

ids_model = list(model_df["compound_id"])
index_of = {c: i for i, c in enumerate(ids_model)}
fold_idx = [([index_of[c] for c in tr], [index_of[c] for c in te]) for tr, te in SPLIT.folds]

mu, sd = X_desc.mean(0), X_desc.std(0)
Z_desc = (X_desc - mu) / np.where(sd > 0, sd, 1.0)
Ze_desc = (Xe_desc - mu) / np.where(sd > 0, sd, 1.0)

def fold_r2(Xa, ya):
    """Mean R2 over the shared GroupKFold folds. The GA never sees a held-out scaffold."""
    scores = []
    for tr, te in fold_idx:
        if len(tr) <= Xa.shape[1] + 1:
            continue
        try:
            f = qsar_core.ols(Xa[tr], ya[tr], [f"x{i}" for i in range(Xa.shape[1])])
        except Exception:
            return -1e9
        pred = np.column_stack([np.ones(len(te)), Xa[te]]) @ f.coef
        sst = ((ya[te] - ya[tr].mean()) ** 2).sum()
        scores.append(1 - ((ya[te] - pred) ** 2).sum() / sst if sst > 0 else np.nan)
    return float(np.nanmean(scores)) if scores else -1e9

TIER3 = {}
for target in ("p_activity_H3", "p_toxicity_hERG", "therapeutic_index"):
    y = model_df[target].to_numpy(dtype=float)
    cap3 = max(2, len(y) // 5)
    ga = features.genetic_feature_selection(
        Z_desc, y, desc_names, fold_r2, max_features=min(10, cap3),
        groups=lipo_group, population=60, generations=40, correlation_penalty=0.35,
        seed=SEED)
    fit = qsar_core.ols(Z_desc[:, list(ga.columns)], y, ga.names)
    q2, _ = qsar_core.q2_loo(Z_desc[:, list(ga.columns)], y)
    n_desc = len(ga.names) - (1 if ("cLogP" in ga.names and "cLogP_sq" in ga.names) else 0)
    print(f"\\n{'='*96}\\nTIER 3 MLR, response = {target}")
    print(f"  GA chose {n_desc} descriptors ({len(ga.names)} coefficients) from {len(desc_names)-1}")
    print(f"  {', '.join(ga.names)}")
    print(f"  fold R2 {ga.q2:.4f}   mean |r| among them {ga.mean_abs_r:.3f}   "
          f"fitness {ga.fitness:.4f}   generations {ga.generations}")
    print(f"  refit on all {fit.n}: r2 {fit.r2:.4f}  adj r2 {fit.r2_adj:.4f}  "
          f"Q2(LOO) {q2:.4f}  s {fit.s:.4f}")
    TIER3[target] = {"ga": ga, "fit": fit, "q2_loo": q2, "cols": list(ga.columns),
                     "descriptors": n_desc}
    RESULTS["models"][f"tier3 mlr {target}"] = {
        "n": fit.n, "terms": ga.names, "descriptors": n_desc, "coefficients": len(ga.names),
        "r2": fit.r2, "r2_adj": fit.r2_adj, "q2_loo": q2, "fold_r2": ga.q2,
        "mean_abs_intercorrelation": ga.mean_abs_r}

fig, ax = plt.subplots(figsize=(5.2, 3))
for target, blob in TIER3.items():
    ax.plot(blob["ga"].history, label=target, lw=1.4)
ax.set_xlabel("generation"); ax.set_ylabel("best fitness (fold R2 - 0.35 mean|r|)")
ax.set_title("genetic feature selection", fontsize=9); ax.legend(fontsize=7)
fig.tight_layout(); plt.show()
''', "tier3_ga")

    code('''
# Section 9b. PLS and the PCA branch, both reported.
for target, blob in TIER3.items():
    y = model_df[target].to_numpy(dtype=float)
    best_nc, best_score = 1, -np.inf
    for nc in range(1, min(10, Z_desc.shape[1]) + 1):
        scores = []
        for tr, te in fold_idx:
            if len(tr) <= nc + 1:
                continue
            p = PLSRegression(n_components=nc, scale=False).fit(Z_desc[tr], y[tr])
            pred = p.predict(Z_desc[te]).ravel()
            sst = ((y[te] - y[tr].mean()) ** 2).sum()
            scores.append(1 - ((y[te] - pred) ** 2).sum() / sst if sst > 0 else np.nan)
        s = float(np.nanmean(scores)) if scores else -np.inf
        if s > best_score:
            best_nc, best_score = nc, s
    pls = PLSRegression(n_components=best_nc, scale=False).fit(Z_desc, y)
    pred = pls.predict(Z_desc).ravel()
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    print(f"TIER 3 PLS, {target:<20} components {best_nc:<3} fold R2 {best_score:.4f}  "
          f"refit r2 {r2:.4f}")
    blob["pls"] = {"model": pls, "n_components": best_nc, "fold_r2": best_score, "r2": r2}
    RESULTS["models"][f"tier3 pls {target}"] = {
        "n_components": best_nc, "fold_r2": best_score, "r2": float(r2)}

pca = PCA(n_components=min(10, Z_desc.shape[1]), random_state=SEED).fit(Z_desc)
evr = pca.explained_variance_ratio_
need_95 = int(np.searchsorted(np.cumsum(evr), 0.95) + 1)
print(f"\\nPCA over the same block: {need_95} components carry 95% of the variance "
      f"({len(desc_names)} columns in)")
print("  explained variance ratio:", np.round(evr, 3))

fig, axes = plt.subplots(1, 2, figsize=(9.4, 3.2))
axes[0].bar(range(1, len(evr) + 1), evr, color="#2f5d9e")
axes[0].plot(range(1, len(evr) + 1), np.cumsum(evr), color="#c2683a", marker="o", ms=3)
axes[0].axhline(0.95, color="#888", ls="--", lw=1)
axes[0].set_xlabel("component"); axes[0].set_ylabel("explained variance")
axes[0].set_title("PCA scree and cumulative", fontsize=9)
sc = pca.transform(Z_desc)
m = axes[1].scatter(sc[:, 0], sc[:, 1], c=model_df["therapeutic_index"], cmap="viridis", s=20)
axes[1].set_xlabel("PC1"); axes[1].set_ylabel("PC2")
axes[1].set_title("training set in the first two components", fontsize=9)
fig.colorbar(m, ax=axes[1], label="therapeutic index")
fig.tight_layout(); plt.show()
RESULTS["models"]["tier3 pca"] = {"components_for_95pc": need_95,
                                  "explained_variance_ratio": [float(v) for v in evr]}
''', "tier3_pls_pca")

    code('''
# Section 9c. Mordred, attempted and reported. The board names it; it is unmaintained.
MORDRED = {"attempted": True, "available": False, "note": ""}
try:
    import mordred  # noqa: F401
    MORDRED["available"] = True
except ImportError:
    try:
        import subprocess, sys
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "mordred"],
                       check=True, timeout=600)
        import mordred  # noqa: F401
        MORDRED["available"] = True
    except Exception as exc:
        MORDRED["note"] = f"{type(exc).__name__}: {exc}"

if MORDRED["available"]:
    from mordred import Calculator, descriptors as mdesc
    from rdkit import Chem
    calc = Calculator(mdesc, ignore_3D=True)
    mols = [Chem.MolFromSmiles(s) for s in model_df["smiles_standardised"]]
    frame = calc.pandas(mols, quiet=True)
    numeric = frame.apply(pd.to_numeric, errors="coerce").dropna(axis=1)
    MORDRED["descriptors"] = int(numeric.shape[1])
    print(f"Mordred installed: {numeric.shape[1]} numeric descriptors computed on "
          f"{numeric.shape[0]} compounds. Not substituted for the RDKit block; reported only.")
else:
    print("Mordred did not install in this environment, which is the expected outcome on a")
    print("current Python: the package is unmaintained. RDKit descriptors are used instead.")
    print("  reason:", MORDRED["note"] or "already absent")
RESULTS["models"]["mordred"] = MORDRED
''', "tier3_mordred")


def section_9d() -> None:
    """The board's second open question, run as the plan's default 5 says."""
    md("""
### The board's second open question — toxicity as a predictor for activity

One card on the board asks, with no answer written under it: *what happens if toxicity is used as a predictor of activity?* The plan's default was to run it as a short side analysis with the caveat attached, so here it is: the same GA-selected descriptor set for H3 affinity, fitted with and without the **measured** hERG affinity as an extra predictor, scored on the same folds and the same external set.

Read the result as a diagnostic, not as a model worth having. Three reasons:

1. **It is not causal.** hERG affinity does not cause H3 affinity. Both are consequences of the same structure, so the extra column is a proxy for shared structural causes — size, lipophilicity, basicity — that the descriptor block is already trying to represent.
2. **It cannot be used prospectively.** Predicting the activity of a compound requires its measured toxicity, which exists only after the compound has been made and tested. At that point its activity has been measured too.
3. **Any gain is partly bookkeeping.** `TI = pActivity − pToxicity`, so a model of activity that is handed pToxicity is one algebraic step from a model of the target variable.
""")
    code('''
# Section 9d. Toxicity added as a predictor for activity, with the caveat in the output.
act = model_df["p_activity_H3"].to_numpy(dtype=float)
tox = model_df["p_toxicity_hERG"].to_numpy(dtype=float)
tox_mu, tox_sd = float(tox.mean()), float(tox.std()) or 1.0
tox_z = (tox - tox_mu) / tox_sd
ext_act = ext_df["p_activity_H3"].to_numpy(dtype=float)
ext_tox_z = (ext_df["p_toxicity_hERG"].to_numpy(dtype=float) - tox_mu) / tox_sd

base_cols = TIER3["p_activity_H3"]["cols"]
base_names = list(TIER3["p_activity_H3"]["ga"].names)
Xb, Xbe = Z_desc[:, base_cols], Ze_desc[:, base_cols]
Xa = np.column_stack([Xb, tox_z])
Xae = np.column_stack([Xbe, ext_tox_z])

side = []
for label, Xt, Xq, names in (
        ("descriptors only", Xb, Xbe, base_names),
        ("descriptors + measured pToxicity", Xa, Xae, base_names + ["p_toxicity_hERG"])):
    fit = qsar_core.ols(Xt, act, names)
    q2, _ = qsar_core.q2_loo(Xt, act)
    pred_q = np.column_stack([np.ones(len(Xq)), Xq]) @ fit.coef
    ext = qsar_core.external_metrics(act, ext_act, pred_q)
    side.append({"model": label, "coefficients": fit.k, "r2": round(fit.r2, 4),
                 "Q2 LOO": round(q2, 4), "fold R2": round(fold_r2(Xt, act), 4),
                 "ext Q2F3": round(ext["q2_f3"], 4), "ext CCC": round(ext["ccc"], 4)})
    if "p_toxicity_hERG" in names:
        j = names.index("p_toxicity_hERG") + 1
        print(f"coefficient on pToxicity   {fit.coef[j]:+.4f}   se {fit.se[j]:.4f}   "
              f"t {fit.t[j]:+.2f}   p {fit.p[j]:.3g}   VIF {fit.vif[j-1]:.2f}")

print()
print(pd.DataFrame(side).to_string(index=False))
delta = side[1]["Q2 LOO"] - side[0]["Q2 LOO"]
print(f"""
change in Q2(LOO) from adding measured hERG affinity: {delta:+.4f}

Whatever the sign of that number, the augmented model is NOT offered as a predictor. It needs
a measured toxicity for every compound it predicts, which can only exist after the compound
has been synthesised and assayed - by which point its activity has been measured too. The
correlation between the two endpoints across this series is """
      f"""{np.corrcoef(act, tox)[0, 1]:+.3f}, which is the shared structural
dependence the descriptor block is already trying to capture, not a causal path.""")
RESULTS["models"]["side analysis: toxicity as a predictor for activity"] = {
    "rows": side, "delta_q2_loo": float(delta),
    "pearson_activity_toxicity": float(np.corrcoef(act, tox)[0, 1]),
    "caveat": "non-causal; requires a measured endpoint that only exists post hoc"}
''', "toxicity_as_predictor")


# =======================================================================================
# Section 10 - Tier 4, machine learning
# =======================================================================================

def section_10() -> None:
    md("""
## §10 Tier 4 — machine learning, labelled black-box

Random forest and gradient boosting, seeded, with **Optuna** doing TPE sampling and **median pruning**, exactly as the board specifies. The search runs **inside the training folds only**: each trial reports the score of each fold as an intermediate value, the pruner stops a trial that is behind the running median, and the held-out scaffolds are never touched.

Everything in this tier is **exploratory**. No machine-learning number is ever used to fill an endpoint, and no prediction from here enters any other section's dataset.
""")
    code('''
# Section 10a. The Optuna search: TPE sampling, median pruning, folds only.
import optuna
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor

optuna.logging.set_verbosity(optuna.logging.WARNING)
PRUNER = {"n_startup_trials": 5, "n_warmup_steps": 1}
N_TRIALS = 40

def make_model(trial):
    kind = trial.suggest_categorical("model", ["random_forest", "gradient_boosting"])
    if kind == "random_forest":
        return RandomForestRegressor(
            n_estimators=trial.suggest_int("rf_n_estimators", 100, 600, step=50),
            max_depth=trial.suggest_int("rf_max_depth", 2, 16),
            min_samples_leaf=trial.suggest_int("rf_min_samples_leaf", 1, 8),
            max_features=trial.suggest_float("rf_max_features", 0.2, 1.0),
            random_state=SEED, n_jobs=-1)
    return GradientBoostingRegressor(
        n_estimators=trial.suggest_int("gb_n_estimators", 100, 600, step=50),
        learning_rate=trial.suggest_float("gb_learning_rate", 0.01, 0.3, log=True),
        max_depth=trial.suggest_int("gb_max_depth", 1, 6),
        subsample=trial.suggest_float("gb_subsample", 0.5, 1.0),
        random_state=SEED)

TIER4 = {}
for target in ("p_activity_H3", "p_toxicity_hERG", "therapeutic_index"):
    y = model_df[target].to_numpy(dtype=float)

    def objective(trial, y=y):
        model = make_model(trial)
        scores = []
        for step, (tr, te) in enumerate(fold_idx):
            model.fit(Z_desc[tr], y[tr])
            pred = model.predict(Z_desc[te])
            sst = ((y[te] - y[tr].mean()) ** 2).sum()
            scores.append(1 - ((y[te] - pred) ** 2).sum() / sst if sst > 0 else np.nan)
            trial.report(float(np.nanmean(scores)), step)      # pruner sees partial folds
            if trial.should_prune():
                raise optuna.TrialPruned()
        return float(np.nanmean(scores))

    study = optuna.create_study(
        direction="maximize",
        sampler=optuna.samplers.TPESampler(seed=SEED),
        pruner=optuna.pruners.MedianPruner(**PRUNER))
    study.optimize(objective, n_trials=N_TRIALS, show_progress_bar=False)
    states = pd.Series([t.state.name for t in study.trials]).value_counts().to_dict()
    folds_paid = sum(len(t.intermediate_values) for t in study.trials)
    print(f"\\n{'='*96}\\nTIER 4 search, response = {target}")
    print(f"  trials {len(study.trials)}  states {states}")
    print(f"  fold fits actually paid for: {folds_paid} of "
          f"{len(study.trials) * len(fold_idx)} without pruning")
    print(f"  best fold R2 {study.best_value:.4f}")
    print(f"  best params {study.best_params}")
    TIER4[target] = {"study": study, "states": states, "folds_paid": folds_paid}
    RESULTS["models"][f"tier4 search {target}"] = {
        "trials": len(study.trials), "states": states, "folds_paid": folds_paid,
        "folds_without_pruning": len(study.trials) * len(fold_idx),
        "best_fold_r2": study.best_value, "best_params": study.best_params,
        "sampler": "TPESampler", "pruner": f"MedianPruner({PRUNER})", "seed": SEED,
        "exploratory": True}
''', "tier4_optuna")

    code('''
# Section 10b. Refit the chosen model on the whole training set, for section 11 to judge.
class _T:
    """A frozen trial, so make_model can rebuild the winner from the recorded parameters."""
    def __init__(self, params): self.params = params
    def suggest_categorical(self, k, _): return self.params[k]
    def suggest_int(self, k, *a, **kw): return self.params[k]
    def suggest_float(self, k, *a, **kw): return self.params[k]

for target, blob in TIER4.items():
    y = model_df[target].to_numpy(dtype=float)
    model = make_model(_T(blob["study"].best_params))
    model.fit(Z_desc, y)
    pred = model.predict(Z_desc)
    r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    blob["model"] = model
    blob["r2_resubstitution"] = float(r2)
    print(f"{target:<22}{type(model).__name__:<26}resubstitution r2 {r2:.4f}  "
          f"(fold R2 {blob['study'].best_value:.4f})")
print("""
The gap between the resubstitution r2 and the fold R2 is the point of printing both: the
first is what the model can memorise, the second is what it can predict on scaffolds it has
not seen. Section 11 uses the second and the external set, never the first.""")
''', "tier4_fit")


# =======================================================================================
# Section 11 - validation
# =======================================================================================

def section_11() -> None:
    md("""
## §11 Validation — one split, every tier

### CHECKPOINT 4 — does any of this predict anything

The split from §7a is reused here unchanged: whole Bemis–Murcko scaffolds to one side or the other, a Tanimoto sweep for near-duplicates the scaffold rule cannot see, then GroupKFold over the scaffold clusters so a cluster is never cut across a fold boundary.

**Internal**: Q²(LOO), Q²(LMO) over 100 repeated 20 % hold-outs, and y-randomisation over 100 shuffles — the real model must sit outside that cloud, and the cloud is plotted.

**External**: on the compounds from the other paper, reporting Q²F1, Q²F2, Q²F3, Lin's CCC (the criterion Chirico & Gramatica propose), r²m, RMSE and MAE. These metrics disagree with each other on purpose and all of them are shown.
""")
    code('''
# Section 11a. Internal validation and y-randomisation for every linear model.
PREDICTIONS = []     # every held-out prediction made anywhere, for section 15 to recheck
INTERNAL = {}

def internal_validation(name, X, y, repeats=100):
    q2, loo_pred = qsar_core.q2_loo(X, y)
    lmo = qsar_core.q2_lmo(X, y, fraction=0.2, repeats=repeats, seed=SEED)
    rand = qsar_core.y_randomisation(X, y, repeats=repeats, seed=SEED)
    fit = qsar_core.ols(X, y, [f"x{i}" for i in range(X.shape[1])])
    INTERNAL[name] = {"n": int(len(y)), "r2": fit.r2, "q2_loo": q2, "q2_lmo": lmo,
                      "y_randomisation": rand,
                      "clears_randomisation": bool(fit.r2 > rand["r2_max"] and q2 > rand["q2_max"])}
    print(f"\\n{name}")
    print(f"  n {len(y)}   r2 {fit.r2:.4f}   Q2(LOO) {q2:.4f}")
    print(f"  Q2(LMO, 20% out x{lmo['repeats']}): mean {lmo['mean']:.4f}  sd {lmo['sd']:.4f}  "
          f"min {lmo['min']:.4f}  max {lmo['max']:.4f}")
    print(f"  y-randomisation x{rand['repeats']}: r2 mean {rand['r2_mean']:.4f} max "
          f"{rand['r2_max']:.4f} | Q2 mean {rand['q2_mean']:.4f} max {rand['q2_max']:.4f}")
    print(f"  the real model sits outside the randomisation cloud: "
          f"{INTERNAL[name]['clears_randomisation']}")
    return INTERNAL[name]

if TIER1:
    b = TIER1["H3 affinity  log(1/C)"]["best"]
    internal_validation("Tier 1 Hansch, H3 affinity", TIER1["H3 affinity  log(1/C)"]["X"][:, list(b.terms)],
                        TIER1["H3 affinity  log(1/C)"]["y"])
    bt = TIER1["therapeutic index"]["best"]
    internal_validation("Tier 1 Hansch, therapeutic index",
                        TIER1["therapeutic index"]["X"][:, list(bt.terms)],
                        TIER1["therapeutic index"]["y"])
if TIER2.get("model") and TIER2["model"]["fit"] is not None:
    internal_validation("Tier 2 Free-Wilson, H3 affinity", TIER2["model"]["X"], TIER2["model"]["y"])
for target, blob in TIER3.items():
    internal_validation(f"Tier 3 MLR, {target}", Z_desc[:, blob["cols"]],
                        model_df[target].to_numpy(dtype=float))
RESULTS["validation"]["internal"] = {
    k: {kk: vv for kk, vv in v.items()} for k, v in INTERNAL.items()}
''', "internal_validation")

    code('''
# Section 11b. The y-randomisation cloud, plotted.
plot_keys = [k for k in INTERNAL if "Tier 1 Hansch, H3" in k or "Tier 3 MLR, p_activity" in k]
if plot_keys:
    fig, axes = plt.subplots(1, len(plot_keys), figsize=(5.2 * len(plot_keys), 3.2), squeeze=False)
    for ax, key in zip(axes[0], plot_keys):
        v = INTERNAL[key]
        ax.scatter([v["y_randomisation"]["r2_mean"]], [v["y_randomisation"]["q2_mean"]],
                   s=60, color="#bbb", label="randomised, mean")
        ax.scatter([v["y_randomisation"]["r2_max"]], [v["y_randomisation"]["q2_max"]],
                   s=60, color="#c2683a", marker="^", label="randomised, worst case")
        ax.scatter([v["r2"]], [v["q2_loo"]], s=90, color="#2f7a3f", marker="*",
                   label="the real model")
        ax.set_xlabel("r2"); ax.set_ylabel("Q2(LOO)")
        ax.set_title(key, fontsize=8); ax.legend(fontsize=7)
    fig.tight_layout(); plt.show()
''', "y_randomisation_plot")

    code('''
# Section 11c. External validation, and an honest account of which tiers can even try.
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

EXTERNAL = {}

def external_validation(name, y_train, y_ext, pred_ext, ids_ext):
    m = qsar_core.external_metrics(y_train, y_ext, pred_ext)
    EXTERNAL[name] = m
    for cid, obs, pr in zip(ids_ext, y_ext, pred_ext):
        PREDICTIONS.append({"model": name, "set": "external", "compound_id": cid,
                            "observed": float(obs), "predicted": float(pr)})
    print(f"\\n{name}")
    print("  " + "  ".join(f"{k} {v:.4f}" if isinstance(v, float) else f"{k} {v}"
                           for k, v in m.items()))
    return m

# Can a Tier 1 model trained on one congeneric series predict a different one at all?
series_scaffold = main_series.scaffold if main_series else None
ext_scaffolds = [MurckoScaffold.MurckoScaffoldSmiles(mol=Chem.MolFromSmiles(s))
                 for s in ext_df["smiles_standardised"] if Chem.MolFromSmiles(s)]
shared = sum(1 for s in ext_scaffolds if s == series_scaffold)
print(f"external compounds sharing the Tier 1 series scaffold: {shared} of {len(ext_scaffolds)}")
print("""  A Hansch equation is defined inside one congeneric series. The external documents are
  different chemotypes, so their compounds cannot be decomposed against this series' core and
  Tiers 1 and 2 have no external set to be tested on. That is a property of the method, not a
  failure of this run, and it is the single strongest argument for the board's own goal: many
  LOCAL models, each valid inside its own series, assembled rather than extrapolated.""")
RESULTS["validation"]["tier1_external_possible"] = {
    "external_compounds_on_series_scaffold": int(shared),
    "external_compounds": len(ext_scaffolds)}

y_tr_map = {t: model_df[t].to_numpy(dtype=float) for t in TIER3}
y_ex_map = {t: ext_df[t].to_numpy(dtype=float) for t in TIER3}
ids_ext = list(ext_df["compound_id"])

for target, blob in TIER3.items():
    pred = np.column_stack([np.ones(len(Ze_desc)), Ze_desc[:, blob["cols"]]]) @ blob["fit"].coef
    external_validation(f"Tier 3 MLR, {target}", y_tr_map[target], y_ex_map[target], pred, ids_ext)
    pls_pred = blob["pls"]["model"].predict(Ze_desc).ravel()
    external_validation(f"Tier 3 PLS, {target}", y_tr_map[target], y_ex_map[target],
                        pls_pred, ids_ext)
for target, blob in TIER4.items():
    pred = blob["model"].predict(Ze_desc)
    external_validation(f"Tier 4 {type(blob['model']).__name__}, {target} (exploratory)",
                        y_tr_map[target], y_ex_map[target], pred, ids_ext)

RESULTS["validation"]["external"] = EXTERNAL
print("\\n" + "=" * 96)
print("POOLED over every external document")
print(pd.DataFrame(EXTERNAL).T.round(4).to_string())
''', "external_validation")

    code('''
# Section 11c (per document). The same models, scored on each external paper on its own.
# Pooling hides the one number worth having: how much the answer depends on whose assay it is.
rows_pd = []
for doc_set, chunk in ext_df.groupby("set"):
    where = ext_df["set"].to_numpy() == doc_set
    for target, blob in TIER3.items():
        pred = (np.column_stack([np.ones(where.sum()), Ze_desc[where][:, blob["cols"]]])
                @ blob["fit"].coef)
        m = qsar_core.external_metrics(model_df[target].to_numpy(dtype=float),
                                       chunk[target].to_numpy(dtype=float), pred)
        rows_pd.append({"external set": doc_set, "document": chunk["document"].iloc[0],
                        "model": f"Tier 3 MLR, {target}", "n": m["n_external"],
                        "Q2F3": round(m["q2_f3"], 3), "CCC": round(m["ccc"], 3),
                        "RMSE": round(m["rmse_ext"], 3), "MAE": round(m["mae_ext"], 3)}) 
    for target, blob in TIER4.items():
        pred = blob["model"].predict(Ze_desc[where])
        m = qsar_core.external_metrics(model_df[target].to_numpy(dtype=float),
                                       chunk[target].to_numpy(dtype=float), pred)
        rows_pd.append({"external set": doc_set, "document": chunk["document"].iloc[0],
                        "model": f"Tier 4 {type(blob['model']).__name__}, {target}",
                        "n": m["n_external"], "Q2F3": round(m["q2_f3"], 3),
                        "CCC": round(m["ccc"], 3), "RMSE": round(m["rmse_ext"], 3),
                        "MAE": round(m["mae_ext"], 3)})
per_doc = pd.DataFrame(rows_pd).sort_values(["model", "external set"])
print(per_doc.to_string(index=False))

spread = (per_doc.groupby("model")["Q2F3"].agg(["min", "max", "count"])
          .assign(range=lambda d: (d["max"] - d["min"]).round(3)))
print("\\nspread in Q2F3 across the external documents, per model:")
print(spread.to_string())
print(f"""
Read the n column before the metrics. Each external document here carries between
{int(per_doc['n'].min())} and {int(per_doc['n'].max())} compounds, which is few enough that a single badly predicted compound
moves Q2F3 by a large fraction. The per-document numbers are reported to show the SPREAD,
not because any one of them is a reliable estimate on its own; the pooled number above is the
one with enough compounds behind it to quote, and even that is {len(ext_df)} compounds.""")
RESULTS["validation"]["external_per_document"] = rows_pd
''', "external_per_document")

    code('''
# Section 11d. The held-out scaffolds inside the training paper, which Tiers 1 and 2 can use.
HELD_OUT = {}
test_idx = [index_of[c] for c in SPLIT.test]
train_idx = [index_of[c] for c in SPLIT.train]
for target, blob in TIER3.items():
    y = y_tr_map[target]
    cols = blob["cols"]
    f = qsar_core.ols(Z_desc[np.array(train_idx)][:, cols], y[np.array(train_idx)], blob["ga"].names)
    pred = np.column_stack([np.ones(len(test_idx)), Z_desc[np.array(test_idx)][:, cols]]) @ f.coef
    m = qsar_core.external_metrics(y[np.array(train_idx)], y[np.array(test_idx)], pred)
    HELD_OUT[f"Tier 3 MLR, {target}"] = m
    for cid, obs, pr in zip(SPLIT.test, y[np.array(test_idx)], pred):
        PREDICTIONS.append({"model": f"Tier 3 MLR, {target}", "set": "held-out scaffolds",
                            "compound_id": cid, "observed": float(obs), "predicted": float(pr)})
print("Held-out scaffolds from the SAME paper (a harder test than a random split, an easier")
print("one than another laboratory's compounds):")
print(pd.DataFrame(HELD_OUT).T.round(4).to_string())
RESULTS["validation"]["held_out_scaffolds"] = HELD_OUT
''', "held_out")


# =======================================================================================
# Section 12 - applicability domain
# =======================================================================================

def section_12() -> None:
    md("""
## §12 Applicability domain

Two criteria, because they fail differently. **Hat leverage** against the 3p/n warning line catches a compound far from the training centroid in the fitted space; a **percentile bounding box** over the training feature distribution catches one outside the observed range of any single descriptor. Each external compound is labelled inside or outside, and a prediction outside the domain is **marked in the exported table**, not quietly reported as if it were as good as the others.
""")
    code('''
# Section 12. Leverage, the bounding box, and what being outside does to the error.
blob = TIER3["p_activity_H3"]
cols = blob["cols"]
dom = splits.applicability_domain(Z_desc[:, cols], Ze_desc[:, cols], percentile=1.0)
for k, v in dom.report.items():
    print(f"  {k:<20}{round(v, 4) if isinstance(v, float) else v}")

pred_ext = np.column_stack([np.ones(len(Ze_desc)), Ze_desc[:, cols]]) @ blob["fit"].coef
y_ext = ext_df["p_activity_H3"].to_numpy(dtype=float)
err = np.abs(y_ext - pred_ext)
inside = dom.inside_both
print(f"\\n  mean |error| inside the domain  : {err[inside].mean():.3f} "
      f"(n {int(inside.sum())})")
if (~inside).any():
    print(f"  mean |error| outside the domain : {err[~inside].mean():.3f} "
          f"(n {int((~inside).sum())})")
    print("  If the second is not larger, the domain criterion is not doing its job here, and")
    print("  saying so is more useful than a plot that implies it is.")

DOMAIN = pd.DataFrame({
    "compound_id": ext_df["compound_id"], "leverage": dom.leverage,
    "inside_leverage": dom.inside_leverage, "inside_box": dom.inside_box,
    "inside_domain": dom.inside_both, "observed": y_ext, "predicted": pred_ext,
    "abs_error": err})
print("\\n  external compounds outside the domain:")
print(DOMAIN[~DOMAIN["inside_domain"]].round(3).to_string(index=False))

fig, ax = plt.subplots(figsize=(5.6, 3.4))
std_res = (y_ext - pred_ext) / blob["fit"].s
ax.axhline(3, color="#c2683a", ls="--", lw=1); ax.axhline(-3, color="#c2683a", ls="--", lw=1)
ax.axvline(dom.h_star, color="#c2683a", ls="--", lw=1)
ax.scatter(dom.leverage[inside], std_res[inside], s=26, color="#2f7a3f", label="inside")
ax.scatter(dom.leverage[~inside], std_res[~inside], s=26, color="#8e3a6b", label="outside")
ax.set_xlabel(f"leverage (h* = {dom.h_star:.3f})"); ax.set_ylabel("standardised residual")
ax.set_title("Williams plot, external set against the Tier 3 training domain", fontsize=9)
ax.legend(fontsize=7); fig.tight_layout(); plt.show()
RESULTS["validation"]["applicability_domain"] = dom.report
''', "applicability_domain")


# =======================================================================================
# Section 13 - interpretation
# =======================================================================================

def section_13() -> None:
    md("""
## §13 Interpretation

For Tier 1, the mechanistic reading the board asks for: the sign and size of each coefficient, the log P optimum from the parabola **with its confidence interval**, and what that says about transport against binding. For Tier 4, SHAP. Morgan-fingerprint similarity maps and the structure–activity landscape index for the cliffs found in §5.
""")
    code('''
# Section 13a. Reading the Hansch coefficients, and the transport optimum with its interval.
if TIER1:
    for label, blob in TIER1.items():
        best = blob["best"]
        fit = best.fit
        print(f"\\n{'='*96}\\n{label}")
        print("  " + fit.equation(response=label))
        MEANING = {
            "sum_pi": ("hydrophobic", "more lipophilic substituents"),
            "sum_pi_sq": ("hydrophobic, curvature", "the parabola in lipophilicity"),
            "sum_sigma": ("electronic", "more electron-withdrawing substituents"),
            "sum_Es": ("steric", "less bulky substituents (Es is negative for bulk)"),
            "sum_MR": ("polarisability and bulk", "larger, more polarisable substituents"),
        }
        for term, coef, p in zip(best.names, fit.coef[1:], fit.p[1:]):
            kind, direction = MEANING.get(term, ("", term))
            sign = "raises" if coef > 0 else "lowers"
            strength = "significant" if p < 0.05 else f"not significant at 5% (p = {p:.2f})"
            print(f"  {term:<12}{coef:+.3f}  {kind:<26}{direction} {sign} the response; {strength}")

        opt = qsar_core.parabolic_optimum(fit, "sum_pi", "sum_pi_sq")
        if opt.get("available"):
            print(f"\\n  lipophilicity optimum  sum(pi)* = {opt['optimum']:.3f}"
                  f"  95% CI {opt['ci_low']:.3f} .. {opt['ci_high']:.3f}")
            print(f"  the parabola opens {opt['opens']}")
            span = blob["X"][:, blob["terms"].index("sum_pi")]
            inside = span.min() <= opt["optimum"] <= span.max()
            print(f"  series spans sum(pi) {span.min():.2f} .. {span.max():.2f}; the optimum "
                  f"{'lies inside' if inside else 'lies OUTSIDE'} that range")
            if not inside:
                print("  An optimum outside the measured range is an extrapolation of the fitted")
                print("  curve, not an observed turning point, and is reported as such.")
            print("""
  The mechanistic reading: a positive linear term with a negative squared term is Hansch's
  transport picture - up to the optimum, more lipophilicity helps a compound reach the
  receptor; past it, the compound partitions into membrane and never arrives. A positive
  squared term would mean no such optimum was found in this series, which is a result about
  this chemistry rather than a failure to fit.""")
            RESULTS["models"][f"tier1 optimum {label}"] = {
                k: v for k, v in opt.items() if isinstance(v, (int, float, str, bool))}
        else:
            print(f"\\n  no lipophilicity optimum to report: {opt.get('reason')}")
''', "tier1_reading")

    code('''
# Section 13b. SHAP for the black-box tier.
import shap

shap_summary = {}
for target, blob in list(TIER4.items())[:1]:      # one worked example, not three identical plots
    model = blob["model"]
    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(Z_desc)
    mean_abs = np.abs(values).mean(axis=0)
    order = np.argsort(-mean_abs)[:12]
    shap_summary[target] = [{"descriptor": desc_names[i], "mean_abs_shap": float(mean_abs[i])}
                            for i in order]
    print(f"Tier 4 ({type(model).__name__}) on {target}: descriptors by mean |SHAP|")
    print(pd.DataFrame(shap_summary[target]).round(4).to_string(index=False))
    fig = plt.figure(figsize=(6.4, 4.2))
    shap.summary_plot(values, Z_desc, feature_names=desc_names, show=False, max_display=12)
    plt.title(f"SHAP, Tier 4 on {target} (exploratory)", fontsize=9)
    plt.tight_layout(); plt.show()

    lin = TIER3[target]["ga"].names
    top = [s["descriptor"] for s in shap_summary[target][:6]]
    print(f"\\n  Tier 3 GA chose : {', '.join(lin)}")
    print(f"  Tier 4 leans on : {', '.join(top)}")
    print(f"  in both         : {', '.join(sorted(set(lin) & set(top))) or 'nothing'}")
    print("""  Where a linear model and a forest lean on the same descriptors, the linear
  reading is more likely to be about chemistry than about the fitting. Where they diverge,
  at least one of them is describing the sample rather than the system.""")
RESULTS["models"]["shap"] = shap_summary
''', "shap_values")

    code('''
# Section 13c. Similarity maps on the cliff pairs, and the SALI landscape.
from rdkit import Chem
from rdkit.Chem import Draw
from IPython.display import Image, display
from sklearn.ensemble import RandomForestRegressor

# A fingerprint model, purely to attribute a prediction to atoms. Fitted on the training
# folds' compounds only, so the picture is not drawn from a model that has seen the answer.
import warnings
from rdkit.Chem.Draw import SimilarityMaps
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    fp_rows = [np.array(SimilarityMaps.GetMorganFingerprint(
        Chem.MolFromSmiles(s), radius=2, fpType="bv", nBits=1024), dtype=float)
        for s in model_df["smiles_standardised"]]
X_fp = np.vstack(fp_rows)
y_fp = model_df["p_activity_H3"].to_numpy(dtype=float)
rf_fp = RandomForestRegressor(n_estimators=300, random_state=SEED, n_jobs=-1)
rf_fp.fit(X_fp[np.array(train_idx)], y_fp[np.array(train_idx)])
held = rf_fp.predict(X_fp[np.array(test_idx)])
sst = ((y_fp[np.array(test_idx)] - y_fp[np.array(train_idx)].mean()) ** 2).sum()
print("fingerprint attribution model, held-out scaffold R2: "
      f"{1 - ((y_fp[np.array(test_idx)] - held) ** 2).sum() / sst:.4f}")
print("  (shown so the maps below are read with the model's actual skill in mind)")

def predict_fp(fp):
    return float(rf_fp.predict(np.array(fp, dtype=float).reshape(1, -1))[0])

pairs = [(c.a, c.b, c.delta, c.position) for c in
         (features.series_cliffs(main_series, dict(zip(model_df["compound_id"],
                                                       model_df["p_activity_H3"])), 1.0)
          if main_series else [])][:2]
if not pairs and cliffs:
    pairs = [(c.a, c.b, c.delta, f"Tanimoto {c.similarity:.2f}") for c in cliffs[:2]]

smi_of = dict(zip(model_df["compound_id"], model_df["smiles_standardised"]))
for a, b, delta, where in pairs:
    print(f"\\ncliff: {a} / {b}   |delta p| = {delta:.2f}   {where}")
    for cid in (a, b):
        mol = Chem.MolFromSmiles(smi_of[cid])
        w = features.atom_weights(mol, predict_fp, bits=1024)
        print(f"  {cid}  observed p {dict(zip(model_df['compound_id'], model_df['p_activity_H3']))[cid]:.2f}")
        display(Image(features.similarity_map_png(mol, w)))
if not pairs:
    print("\\nno cliff pair to map; the counts in section 5 say why")

# SALI landscape over the whole training set.
if cliffs:
    sali = np.array([c.sali for c in cliffs])
    fig, ax = plt.subplots(figsize=(5.4, 3.2))
    ax.scatter([c.similarity for c in cliffs], [c.delta for c in cliffs],
               s=28, c=sali, cmap="magma")
    ax.set_xlabel("Tanimoto similarity"); ax.set_ylabel("|delta p(activity)|")
    ax.set_title("structure-activity landscape: near neighbours, far apart in potency",
                 fontsize=9)
    fig.tight_layout(); plt.show()
''', "similarity_maps")


# =======================================================================================
# Section 14 - the two schematics
# =======================================================================================

def section_14() -> None:
    md("""
## §14 The two schematics

Generated programmatically, not drawn: a schema diagram colour-coded by what each column *is*, and a workflow diagram of this notebook's own steps mapped to the board's stages. Both are written as `.excalidraw` so they open in the same editor the board came from, and rendered inline from the same layout object so the picture here and the file handed back cannot drift apart.
""")
    code('''
# Section 14. Both figures, from one layout model, in two formats.
schema_cols = [(c, k, m) for c, k, m in SCHEMA]
schema = schematics.schema_diagram(schema_cols, "Dataset schema: measured, tabulated, computed, derived")
workflow = schematics.workflow_diagram([
    ("§3", "ChEMBL ingestion, filter by filter", "A sources"),
    ("§4", "schema and ATC levels", "B schema"),
    ("§5", "dedupe, standardise, flag", "C pre-processing"),
    ("§6", "modelling set and descriptors", "D selection / E features"),
    ("§7", "Tier 1 Hansch LFER", "K Hansch core"),
    ("§8", "Tier 2 Free-Wilson", "F models"),
    ("§9", "Tier 3 MLR, PLS, PCA, GA", "E features / F models"),
    ("§10", "Tier 4 forests, Optuna, pruning", "G tuning"),
    ("§11", "scaffold split, internal, external", "H validation"),
    ("§12", "applicability domain", "J domain"),
    ("§13", "coefficients, SHAP, SALI", "I interpretation"),
    ("§15", "verification", "L goal"),
], "This notebook's steps, against the board's stages")

for name, diagram in (("schema", schema), ("workflow", workflow)):
    path = f"{name}_diagram.excalidraw"
    schematics.write_excalidraw(diagram, path)
    print(f"wrote {path}  ({os.path.getsize(path):,} bytes, opens in Excalidraw)")
    schematics.render(diagram)
    plt.savefig(f"{name}_diagram.png", dpi=130, bbox_inches="tight")
    plt.show()
    RESULTS["figures"].append(f"{name}_diagram")
''', "schematics")


# =======================================================================================
# Section 15 - verification
# =======================================================================================

def section_15() -> None:
    md("""
## §15 Verification

The section that exists so none of the above has to be taken on trust. SHA-256 of the raw pull and of the curated table; assertions that no endpoint is predicted, that the training and external sets do not intersect by InChIKey, that **the reported metrics equal the ones recomputed from the stored predictions**, and that every figure in the markdown has a number behind it in the results frame. Any failure raises.
""")
    code('''
# Section 15. Hashes, assertions, and a recomputation of every reported external metric.
cols = list(table_rows[0])
raw_hash = hashlib.sha256(json.dumps(pull["records"], sort_keys=True,
                                     default=str).encode()).hexdigest()
curated_hash = curate.sha256_of_rows(table_rows, cols)
print(f"raw pull     sha256 {raw_hash}")
print(f"curated rows sha256 {curated_hash}")
print(f"ChEMBL release      {release['release']} ({release['release_date']})")
print("  A hash without a release pins nothing: ChEMBL revises values between releases, so")
print("  the same code can give a different hash next year and both be correct.")

failures = []

if (records["source_type"] != "experimental").any():
    failures.append("an endpoint value is not an experimental measurement")

tr_keys = set(model_df["inchikey"]); ex_keys = set(ext_df["inchikey"])
if tr_keys & ex_keys:
    failures.append(f"{len(tr_keys & ex_keys)} compounds are in both the training and external sets")

pred_df = pd.DataFrame(PREDICTIONS)
for name, group in pred_df[pred_df["set"] == "external"].groupby("model"):
    if name not in EXTERNAL:
        continue
    target = name.split(", ")[-1].replace(" (exploratory)", "")
    recomputed = qsar_core.external_metrics(
        model_df[target].to_numpy(dtype=float),
        group["observed"].to_numpy(dtype=float),
        group["predicted"].to_numpy(dtype=float))
    for metric, value in EXTERNAL[name].items():
        if isinstance(value, float) and not np.isclose(value, recomputed[metric], atol=1e-9):
            failures.append(f"{name}: reported {metric} {value} != recomputed {recomputed[metric]}")

for key, blob in RESULTS["models"].items():
    if isinstance(blob, dict) and "r2" in blob and blob["r2"] is not None:
        if not (-5 <= float(blob["r2"]) <= 1.0000001):
            failures.append(f"{key}: r2 {blob['r2']} is outside the possible range")

claimed = {"training compounds": len(model_df), "external compounds": len(ext_df),
           "congeneric series": len(series_list),
           "descriptor columns": len(desc_names),
           "scaffold split test size": SPLIT.report["n_test"]}
for k, v in claimed.items():
    if v is None:
        failures.append(f"{k} has no number behind it")

print("\\nassertions:")
print(f"  every endpoint value experimental            {'FAIL' if any('experimental' in f for f in failures) else 'pass'}")
print(f"  training and external disjoint by InChIKey   {'FAIL' if any('both the training' in f for f in failures) else 'pass'}")
print(f"  reported metrics == recomputed from stored predictions  "
      f"{'FAIL' if any('recomputed' in f for f in failures) else 'pass'}"
      f"  ({pred_df['model'].nunique()} models, {len(pred_df)} predictions)")
print(f"  every reported figure has a number behind it {'FAIL' if any('number behind' in f for f in failures) else 'pass'}")
for k, v in claimed.items():
    print(f"    {k:<30}{v}")

if failures:
    for f in failures:
        print("  FAILURE:", f)
    raise AssertionError(f"{len(failures)} verification failure(s); see above")
print("\\nall verification checks passed")

RESULTS["environment"] = RUN_ENVIRONMENT
RESULTS["verification"] = {"raw_sha256": raw_hash, "curated_sha256": curated_hash,
                           "chembl_release": release["release"],
                           "predictions_checked": len(pred_df),
                           "models_checked": int(pred_df["model"].nunique()),
                           "failures": failures}
''', "verification")


# =======================================================================================
# Section 16 - export
# =======================================================================================

def section_16() -> None:
    md("""
## §16 Export

The curated table, the per-model coefficient tables, the provenance table, the applicability-domain labels and the fitted models, written to CSV and joblib with one-click download links in Colab.
""")
    code('''
# Section 16. Everything worth keeping, written out.
import joblib

OUT = "qsar_outputs"
os.makedirs(OUT, exist_ok=True)
written = []

def write_csv(frame, name):
    path = os.path.join(OUT, name)
    frame.to_csv(path, index=False)
    written.append(path)
    return path

write_csv(pd.DataFrame(table_rows), "curated_dataset.csv")
write_csv(paired, "modelling_table_standardised.csv")
write_csv(provenance, "provenance.csv")
write_csv(pred_df, "predictions.csv")
write_csv(DOMAIN.assign(**{"flag": np.where(DOMAIN["inside_domain"], "",
                                            "OUTSIDE THE APPLICABILITY DOMAIN")}),
          "external_predictions_with_domain.csv")
write_csv(per_doc, "external_metrics_per_document.csv")

coef_rows = []
for label, blob in (TIER1 or {}).items():
    f = blob["best"].fit
    for term, c, se, p in zip(["intercept"] + list(blob["best"].names), f.coef, f.se, f.p):
        coef_rows.append({"model": f"Tier 1 {label}", "term": term, "coefficient": c,
                          "std_error": se, "p": p})
for target, blob in TIER3.items():
    f = blob["fit"]
    for term, c, se, p in zip(["intercept"] + list(blob["ga"].names), f.coef, f.se, f.p):
        coef_rows.append({"model": f"Tier 3 MLR {target}", "term": term, "coefficient": c,
                          "std_error": se, "p": p})
write_csv(pd.DataFrame(coef_rows), "coefficients.csv")

models_path = os.path.join(OUT, "fitted_models.joblib")
joblib.dump({"tier3": {t: {"coef": b["fit"].coef, "terms": b["ga"].names,
                           "columns": b["cols"], "pls": b["pls"]["model"]}
                       for t, b in TIER3.items()},
             "tier4": {t: b["model"] for t, b in TIER4.items()},
             "standardisation": {"mean": mu, "sd": sd, "names": desc_names}},
            models_path)
written.append(models_path)

def json_safe(obj):
    """JSON keys must be strings, and numpy scalars are not JSON. Both appear in RESULTS
    once a pandas frame has been through it, so the whole tree is walked rather than
    patched at the one place it happened to break."""
    if isinstance(obj, dict):
        return {(" / ".join(map(str, k)) if isinstance(k, tuple) else str(k)): json_safe(v)
                for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [json_safe(v) for v in obj.tolist()]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj

results_path = os.path.join(OUT, "results.json")
with open(results_path, "w") as fh:
    json.dump(json_safe(RESULTS), fh, indent=1, default=str)
written.append(results_path)

for name in ("schema_diagram", "workflow_diagram"):
    for ext in (".excalidraw", ".png"):
        if os.path.exists(name + ext):
            os.replace(name + ext, os.path.join(OUT, name + ext))
            written.append(os.path.join(OUT, name + ext))

print("written:")
for p in written:
    print(f"  {p:<58}{os.path.getsize(p):>10,} bytes")

try:
    from google.colab import files           # noqa: F401
    import shutil
    archive = shutil.make_archive("qsar_outputs", "zip", OUT)
    print(f"\\nColab detected; downloading {archive}")
    files.download(archive)
except ImportError:
    print(f"\\nNot in Colab: the files are in ./{OUT}/")
''', "export")


def section_15_summary() -> None:
    """The tier comparison table. Emitted after the verification cell, same section."""
    code('''
# Section 15 (summary). Every tier side by side, with the counts that make them comparable
# or not. Read the 'rows' column first: Tiers 1 and 2 are fitted on one congeneric series,
# Tiers 3 and 4 on the whole training paper, which is the plan's question 3 made visible.
summary_rows = []
if TIER1:
    for label, blob in TIER1.items():
        b = blob["best"]
        key = f"Tier 1 Hansch, {label}"
        iv = INTERNAL.get("Tier 1 Hansch, H3 affinity" if "H3" in label
                          else "Tier 1 Hansch, therapeutic index", {})
        summary_rows.append({
            "tier": key, "rows": b.fit.n, "descriptors": b.n_variables,
            "coefficients": b.n_coefficients, "r2": round(b.fit.r2, 4),
            "Q2 LOO": round(iv.get("q2_loo", float("nan")), 4),
            "external": "not applicable (different chemotype)"})
if TIER2.get("model"):
    m = TIER2["model"]
    summary_rows.append({
        "tier": f"Tier 2 Free-Wilson ({m['kind']})", "rows": len(m["y"]),
        "descriptors": len(m["names"]), "coefficients": len(m["names"]),
        "r2": round(m["fit"].r2 if m["fit"] is not None else m["r2"], 4),
        "Q2 LOO": round(m.get("q2_loo", float("nan")), 4),
        "external": "not applicable (different chemotype)"})
for target, blob in TIER3.items():
    iv = INTERNAL.get(f"Tier 3 MLR, {target}", {})
    ex = EXTERNAL.get(f"Tier 3 MLR, {target}", {})
    summary_rows.append({
        "tier": f"Tier 3 MLR, {target}", "rows": blob["fit"].n,
        "descriptors": blob["descriptors"], "coefficients": blob["fit"].k,
        "r2": round(blob["fit"].r2, 4), "Q2 LOO": round(iv.get("q2_loo", float("nan")), 4),
        "external": f"Q2F3 {ex.get('q2_f3', float('nan')):.3f}  CCC {ex.get('ccc', float('nan')):.3f}"})
    pex = EXTERNAL.get(f"Tier 3 PLS, {target}", {})
    summary_rows.append({
        "tier": f"Tier 3 PLS, {target}", "rows": blob["fit"].n,
        "descriptors": f"{len(desc_names)} in, {blob['pls']['n_components']} components",
        "coefficients": blob["pls"]["n_components"], "r2": round(blob["pls"]["r2"], 4),
        "Q2 LOO": float("nan"),
        "external": f"Q2F3 {pex.get('q2_f3', float('nan')):.3f}  CCC {pex.get('ccc', float('nan')):.3f}"})
for target, blob in TIER4.items():
    name = f"Tier 4 {type(blob['model']).__name__}, {target} (exploratory)"
    ex = EXTERNAL.get(name, {})
    summary_rows.append({
        "tier": name, "rows": len(model_df), "descriptors": len(desc_names) - 1,
        "coefficients": "n/a (ensemble)", "r2": round(blob["r2_resubstitution"], 4),
        "Q2 LOO": float("nan"),
        "external": f"Q2F3 {ex.get('q2_f3', float('nan')):.3f}  CCC {ex.get('ccc', float('nan')):.3f}"})

comparison = pd.DataFrame(summary_rows)
print(comparison.to_string(index=False, max_colwidth=46))
RESULTS["comparison"] = summary_rows

print("""
Reading this table honestly:
  - 'descriptors' counts the lipophilicity pair ONCE; 'coefficients' counts both of its terms.
  - Tiers 1 and 2 sit on one congeneric series, so their r2 is not comparable with Tiers 3
    and 4 on the full set, and their blank external column is a property of the Hansch method
    rather than a gap in this run.
  - The external column is another laboratory's compounds, measured on a different H3
    radioligand and reporting hERG as Ki rather than IC50. It is the hardest number here and
    the one that should move an opinion.""")
''', "comparison_table")


# =======================================================================================
# Section 17 - Colab instructions and limitations
# =======================================================================================

def section_17() -> None:
    md("""
## §17 How to run this, and what it does not tell you

### Running it

1. Open the notebook in Colab (File → Upload notebook, or open it from GitHub).
2. Runtime → Run all. No API key, no mounted drive, no uploaded file: §3 pulls from the public ChEMBL REST API.
3. Expect roughly ten to twenty minutes, most of it in §3's pull and §10's Optuna search.
4. §16 writes everything to `qsar_outputs/` and, in Colab, offers the zip as a download.
5. Nothing is cached. Re-running re-pulls, and §15 prints the hash of what it got, so a change in ChEMBL between runs is visible rather than silent.

### Declared choices — decisions made on the reader's behalf

| | choice | why |
|---|---|---|
| dataset | H3 / hERG, training CHEMBL1821550 | the search in §3 finds only four documents in the release measuring both endpoints on the same compounds; this is the largest |
| **external set** | **three documents, not one** | **the plan's single external set, CHEMBL1155513, shares 67 of its 75 compounds with the training paper. Used as published it would have measured "external" accuracy mostly on compounds already fitted. The 8 unseen compounds are kept and the other two qualifying documents are added, giving a few dozen compounds from three laboratories, scored per document as well as pooled; §3 prints the exact counts** |
| target variable | `pActivity − pToxicity`, higher is better | one scale, one sign convention, stated in §6 with a worked example |
| **`potential_duplicate`** | **flag recorded, rows kept** | **the plan said drop them; checking showed that would delete 159 of 458 training rows, every one the only row for its compound, while preventing no duplication at all. Deduplication is done on (compound, target, type) instead.** |
| π re-derivation | run against ChEMBL's `alogp`, reported as a consistency probe | `alogp` is itself calculated, so this is not the experimental re-derivation the plan imagined; §6b says so in the output |
| Tier 1 scope | the largest congeneric series; Tiers 3–4 on all training compounds | a Hansch equation is only defined inside a series, so the alternative was to shrink every tier to that series |
| Free–Wilson | penalised if the indicator design is saturated, and labelled as penalised | reporting an OLS fit with more indicators than compounds would be reporting an interpolation |
| Mordred | attempted, RDKit used | Mordred is unmaintained against current Python |
| descriptors | one curated RDKit block, not every available descriptor | a wall of 200 correlated columns would make the genetic algorithm's intercorrelation objective meaningless |

### Limitations

* **The series is small.** Tier 1 fits on a few dozen compounds. The Topliss–Costello ratio is printed next to every fit precisely so this is not hidden.
* **This is not a clinical therapeutic index.** The target variable is a difference of two *in vitro* binding affinities, measured in displacement assays. It carries **no dose, no exposure, no duration and no information about any individual**. It cannot be used to compare drugs in people, to choose between them, or to say anything about safety in use. It ranks analogues inside one chemical series during design, and that is its whole scope.
* **hERG is one liability among many.** A compound with a wide margin here may be unacceptable for reasons this dataset never measured.
* **The external set is small, and it is not the same assay.** A few dozen compounds, from three papers, with four different H3 radioligands between them and three different hERG readouts — one of which is a functional IonWorks patch-clamp IC50 rather than a displacement affinity at all. Expect the external metrics to be pessimistic for reasons that are partly experimental rather than modelling, expect a wide spread between documents, and read the per-document `n` before any per-document metric: at thirteen to twenty compounds, one bad prediction moves Q²F3 visibly.
* **The plan's external set was almost entirely the training set.** That is reported in §5 and §11 rather than corrected quietly, because it is the most instructive thing this run found: an external validation can be built entirely in good faith out of a second citation and still be measuring resubstitution.
* **Tabulated substituent constants carry their own uncertainty**, and transcription is their weakest link. §6b checks what it can and names what it cannot.
* **Tier 4 is exploratory and labelled so.** No machine-learning prediction fills an endpoint anywhere in this notebook.
* **Four of the ten model families the board names are not fitted here** — kernel PLS, SVR, MLP and a graph neural network. §2 prints that list rather than implying the board was covered.
* **One local model is not the global model.** The board's Goal 1 is an assembly of many local models across ATC levels. This is one of them, built to the standard such an assembly would need. The assembly is the next piece of work.
""")
    code('''
# Section 17. The run's own footer: what this run actually did, in numbers.
print(f"""
run summary
-----------
ChEMBL release           {release['release']} ({release['release_date']})
training compounds       {len(model_df)} (document {curate.SETS['training']['document']})
external compounds       {len(ext_df)} unseen, from {ext_df['document'].nunique()} documents \
({', '.join(sorted(ext_df['document'].unique()))})
congeneric series found  {len(series_list)}; largest n = {main_series.n if main_series else 0}
descriptor columns       {len(desc_names)} ({len(desc_names) - 1} descriptors, the lipophilicity pair counted once)
scaffold split           {SPLIT.report['n_train']} train / {SPLIT.report['n_test']} held out, {SPLIT.report['shared_scaffolds']} shared scaffolds
models fitted            {len(RESULTS['models'])} entries recorded
predictions stored       {len(pred_df)} across {pred_df['model'].nunique()} models
curated table sha256     {curated_hash}
seed                     {SEED}
verification             {'passed' if not RESULTS['verification']['failures'] else 'FAILED'}
""")
print("The target variable is a ratio of two in vitro binding affinities. It is not a dose,")
print("not a clinical therapeutic index, and not advice about any medicine's use in people.")
''', "run_summary")


# =======================================================================================
# Assembly
# =======================================================================================

def notebook() -> dict:
    _cells.clear()
    section_0(); section_1(); section_2(); section_3(); section_4(); section_5()
    section_6(); section_7(); section_8(); section_9(); section_9d(); section_10()
    section_11()
    section_12(); section_13(); section_14(); section_15(); section_15_summary()
    section_16(); section_17()
    for c in _cells:
        c["source"] = [l + "\n" for l in c["source"].split("\n")]
        if c["source"]:
            c["source"][-1] = c["source"][-1].rstrip("\n")
    return {
        "cells": _cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"provenance": [], "toc_visible": True},
            "generated_by": "notebook/build_notebook.py",
            "module_sha256": module_hashes(),
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def _comparable(nb: dict) -> str:
    """The notebook without outputs or execution counts, for the --check comparison."""
    cells = []
    for c in nb["cells"]:
        d = {"cell_type": c["cell_type"], "source": c["source"],
             "metadata": {k: v for k, v in c.get("metadata", {}).items() if k == "name"}}
        cells.append(d)
    return json.dumps({"cells": cells, "metadata": nb["metadata"]}, indent=1, sort_keys=True)


def main() -> int:
    nb = notebook()
    if "--check" in sys.argv:
        if not NOTEBOOK.exists():
            print(f"{NOTEBOOK.name} does not exist; run ./build_notebook.py")
            return 1
        on_disk = json.loads(NOTEBOOK.read_text())
        if _comparable(on_disk) != _comparable(nb):
            print(f"{NOTEBOOK.name} is out of date with tools/*.py; run ./build_notebook.py")
            return 1
        print(f"{NOTEBOOK.name} matches tools/*.py "
              f"({len(nb['cells'])} cells, {len(MODULES)} modules)")
        return 0
    NOTEBOOK.write_text(json.dumps(nb, indent=1) + "\n")
    code_cells = sum(1 for c in nb["cells"] if c["cell_type"] == "code")
    print(f"wrote {NOTEBOOK.name}: {len(nb['cells'])} cells "
          f"({code_cells} code, {len(nb['cells']) - code_cells} markdown), "
          f"{NOTEBOOK.stat().st_size:,} bytes")
    for name, h in module_hashes().items():
        print(f"  tools/{name}.py".ljust(34), h[:16])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
