# Standalone Datamol inspection and frozen QSAR replay

Open [assay_qsar_datamol_standalone.ipynb](assay_qsar_datamol_standalone.ipynb) to read the executed local outputs, or use [Colab](https://colab.research.google.com/github/DhruvMenon2003/drug-hansch-space/blob/main/notebooks/qsar/chembl3855278/assay_qsar_datamol_standalone.ipynb). The Colab link tracks this repository's public `main` branch; immutable commit-pinned links accompany the publication handoff. No Drive access, private-file sharing, site policy change or new public service is needed.

## Run and inspect

1. Use a fresh Python 3.12 CPU notebook runtime. Read the setup cell before running it: it installs pinned official PyPI dependencies, may build a source dependency, and may require a kernel restart.
2. Run setup, then the remaining cells in order. Setup downloads a manifest and 45 public files from frozen model commit `6d07e2ab78b54cc6aeb44523101a4672aa159705`, verifying their SHA-256 hashes before use. The manifest hash is `cfb8b096f3c00c2be092993bbbfd90f1a15d8cbdcda6fb3f910dc508360f2cf9`.
3. Inspect source pKi and derived Ki, the five explicitly matched descriptors, property flags and 33 descriptive clusters. `CLUSTER_ID` changes the displayed group only. These inspection steps never change eligibility, labels, the 57/23 split or fitted model.
4. Read held-out predictions and baseline comparison; download new inspection CSV and model CSV/JSON outputs from the runtime Files panel. Outputs go to a separate run directory. Automatic XLSX regeneration is not included; the existing [checked static workbook](exports/assay_qsar_pilot_public.xlsx) is unchanged.

The model is a weak reproducibility pilot, not a validated predictor: Ridge held-out R² is −0.052 versus −0.077 for the training mean. A tiny improvement does not establish useful predictive skill. The notebook preserves the original source-mapping and applicability-domain limitations.

## What was verified

- Exact notebook SHA-256 and code-source hash are recorded in [datamol_publication_manifest.json](datamol_publication_manifest.json).
- All nine ordinary Python cells executed in a fresh tested local environment; dependency `pip check` passed. Stored notebook outputs and static grids come from that execution.
- Independent replay exercised the actual download function with mocked network responses for the manifest plus all 45 exact frozen files, verified every hash, and preserved the original model data, split, coefficients and predictions.
- The public manifest was fetched live. A complete live 45-file fetch and actual Google Colab runtime execution were **not** verified; local execution is not a Colab browser pass.
- The notebook was independently reviewed for source attribution, scientific boundaries, identity/row alignment and private-path leakage. No original frozen-model file or its manifest was edited.

## Sources and reuse

Adapted from Patrick Walters' [Datamol tutorial](https://github.com/PatWalters/practical_cheminformatics_tutorials/blob/370dc66428819e06a2c87a859fab122b77b22f5b/datamol/datamol_1.ipynb), MIT, copyright 2022 Patrick Walters. Its full copyright and permission notice is embedded in the notebook. The D2 cohort replaces the tutorial's hERG example; flags annotate rather than filter, and clustering is only exploratory. Datamol 0.13.0 is Apache-2.0; the original model retains `useful_rdkit_utils` 2.0.1. Tested dependency pins are in the setup cell.

ChEMBL source and derived data retain the separate [CC BY-SA attribution](DATA_LICENSE.md). Neither tutorial adaptation nor data reuse changes the existing repository code license. No upstream EXE, DLL, JAR or arbitrary repository script is installed or run by this notebook.
