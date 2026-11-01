# A reproducible QSAR workflow

One Colab notebook, built from the whiteboard, that fits a therapeutic-index QSAR model and
regenerates every number it prints.

| file | what it is |
|---|---|
| `reproducible_qsar_workflow.ipynb` | the notebook. Self-contained: open in Colab, Runtime → Run all |
| `build_notebook.py` | generates the notebook from `tools/*.py`. `--check` fails if the two have drifted |
| `tools/*.py` | the code the notebook runs. Single source of truth, embedded into the notebook by the generator |
| `EXAMPLE-RUN.md` | the printed output of one full execution, so the numbers can be read without running it |
| `WHITEBOARD_MAPPING.md` | every labelled card on the board, and which section implements it |

## Running it

Open the notebook in Colab (File → Upload notebook, or straight from GitHub) and choose
Runtime → Run all. It takes roughly eleven minutes, needs no API key, no mounted drive and no
uploaded file, and writes its outputs to `qsar_outputs/`, offered as a zip download at the end.

Nothing is cached and no result is hard-coded. Section 3 pulls live from the public ChEMBL
REST API, section 15 prints the SHA-256 of the curated table next to the ChEMBL release it was
built from, and the same section recomputes every reported external metric from the stored
predictions and raises if any of them disagrees.

## Editing it

The module files under `tools/` are the real code. The notebook contains a copy of each one in
a `%%writefile` cell, with its SHA-256 recorded in section 0 and re-checked in section 1, so a
stale copy cannot pass unnoticed. After editing a module:

```sh
./build_notebook.py            # regenerate the notebook
./build_notebook.py --check    # confirm notebook and modules agree
```

## What it covers

Eighteen sections, §0 to §17, carrying the board's four checkpoints: provenance and ingestion,
schema, pre-processing, descriptor selection, four modelling tiers (Hansch LFER, Free–Wilson,
classical 2D QSAR, machine learning), internal and external validation, applicability domain,
interpretation, verification and export. Section 2 names the board stages it does *not*
implement and why. Section 17 lists every decision made on the reader's behalf.

## What it is not

The target variable is the difference of two *in vitro* binding affinities, measured in
displacement assays. It carries no dose, no exposure and no information about any individual.
It is not a clinical therapeutic index and cannot be used to compare medicines in people. It
ranks analogues inside one chemical series during design, and that is its whole scope.
