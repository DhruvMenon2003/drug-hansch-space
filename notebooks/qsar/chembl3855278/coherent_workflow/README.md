# Reproducible human D2 QSAR workflow

`coherent_d2_qsar.ipynb` is a single, linear notebook for auditing and reproducing the original 80-compound human D2 binding pilot (assay CHEMBL3855278). All scientific code is visible in the notebook. It does not execute a downloaded model script.

## Run

In Colab, select Runtime → Change runtime type → Runtime version 2026.07 (Python 3.12), CPU. Otherwise use a fresh Python 3.12 kernel. Run the cells from the top. The setup installs the embedded, tested dependency lock from official PyPI when needed and retrieves immutable, hash-verified public input files. Expand the collapsed setup cell to inspect the pins. Colab can preload NumPy. If installation is needed, setup installs the pinned packages and deliberately stops before data loading or modeling. Choose Runtime → Restart session and then Run all. On the next run, setup checks both installed and already-loaded scientific versions; stale in-memory versions stop execution.

The final cell lists exported files and creates a results ZIP. In Colab, open the Files panel, refresh it, and download the ZIP. The bundle contains predictions, features, metrics, split assignments, diagnostic plots, model parameters, manifests and a replay receipt; it is not a complete offline Python environment.

## What stays fixed

- All 80 compound identities and original experimental pKi values, with source activity links and recorded exclusion provenance.
- Five descriptors: MolWt, MolLogP, TPSA, NumHDonors and NumHAcceptors. A second calculation path uses the same RDKit functions to check numerical values and ordering; it is not an independent validation of descriptor definitions.
- The exact saved 57-training / 23-reference-test split, with no shared parent, connectivity or nonchiral Murcko scaffold groups.
- Train-only scaling, Ridge with alpha 1, and a training-mean baseline. Archived predictions and metrics are checked numerically.
- The same saved split for structural diagnostics. Default Butina distance cutoff 0.65 produces groups of 79 and 1; five nonempty grouped folds are reported as not evaluable. No cutoff adjustment or substitute split is performed.

The notebook audits the frozen 107-record to 80-compound curation against raw source identifiers and labels. It does not claim to perform fresh curation. Derived Ki values are consistency checks, not additional measured endpoints. Nonchiral representation limitations are reported without averaging labels, changing chirality settings or discarding compounds.

## Interpretation and validation

The 23 reference-test outcomes have already been inspected. This run reproduces the original experiment; it is not fresh external or prospective validation. Both original test R² values are negative, and the Ridge errors are only slightly lower than the training-mean baseline. No tuning, alternative-model search, resampling leaderboard, ambiguous UMAP helper or Tukey significance test is included.

The exact notebook passed two independent clean-interpreter executions, including archived prediction/metric agreement, all input hashes, shared-split diagnostics and results-ZIP checks. A local Jupyter-kernel transport check was blocked before notebook execution, so these checks are not represented as a Jupyter or Google Colab run. Live Colab verification is pending and must be reported separately before claiming it has passed.

## Provenance

- Immutable input package: repository commit `6d07e2ab78b54cc6aeb44523101a4672aa159705`, under `notebooks/qsar/chembl3855278`.
- Input manifest SHA256: `cfb8b096f3c00c2be092993bbbfd90f1a15d8cbdcda6fb3f910dc508360f2cf9`.
- Notebook SHA256: `ed59b70d33bbe338b06b1da02abaf2d8c9fbbf1786b264493a05858d1596e010`.
- `source_data_manifest.json` records the exact 21 input/provenance/reference files read by this notebook. `requirements-science.lock.txt` matches the embedded dependency lock.

This is a scientifically adapted integration of Patrick Walters' Datamol inspection and dataset-splitting ideas, not a literal replay of the upstream solubility notebook. The pinned splitting source is [practical_cheminformatics_posts, commit b4a74789](https://github.com/PatWalters/practical_cheminformatics_posts/blob/b4a74789beb1c43d18fe46f13bd5e77c1f2cce92/splitting/dataset_splitting.ipynb). Applicable MIT notices (Patrick Walters, 2021 and 2022) and the full license are included in the notebook.

ChEMBL data and derived tables retain CC BY-SA 3.0; the original data license is among the verified inputs. The original published pilot files and application are not modified by this addition.
