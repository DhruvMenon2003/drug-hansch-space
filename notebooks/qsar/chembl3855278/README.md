# Single-assay QSAR pilot — offline bundle

A fixed exploratory model of source-reported human D2 binding pKi from ChEMBL assay CHEMBL3855278 (document CHEMBL3853329). This is not the old frozen 250-compound model, regulatory validation, or a general D2 predictor.

## Observed result

80 eligible compounds; 57 training and 23 holdout across six unseen Murcko scaffolds. Ridge MAE/RMSE 0.370/0.491 pKi versus training-mean 0.376/0.497. Both R² values are negative (−0.052 and −0.077): the tiny advantage does not establish useful predictive skill. The holdout is only six chemical groups; its 23 rows are not 23 independent scaffold tests. Maximum training similarity spans 0.697–0.969 (Morgan radius 2, 2048 bits); scaffold novelty does not imply unrelated chemistry. Three holdout compounds exceed at least one training descriptor range.

## Run

Use a trusted Python environment matching `requirements-tested.txt`, then from this directory:

```bash
python pilot.py
python replay_notebook.py
```

Or open `assay_qsar_pilot.ipynb` and Run all. `assay_qsar_pilot.executed.ipynb` retains the tested local cell outputs. The second command blocks network socket connections; it requires IPython, already listed in the tested environment. No install, download, EXE/DLL execution, Colab upload or public app changes are performed. Fresh Colab setup/execution is **not** verified by a local replay.

## Evidence and methods

- `frozen/`: complete official source snapshot, provenance, original and standardized activity fields, source-to-parent structure decisions, exclusions and duplicate records, eligible cohort.
- `predeclared_recipe.json`: fixed five-descriptor/scaler/Ridge(alpha=1) recipe and structural split, frozen before fitting. Source-reported pKi is the label; Ki and round-trip pKi are separate conversion checks.
- `input_hashes.json`: hash gate for frozen data, recipe and model implementation. This detects changed bytes, not incorrect scientific claims.
- `pilot.py`: readable implementation; original source data never overwritten. Model preprocessing only fits training rows; train-mean baseline and ridge share one holdout.
- `results/`: fitted model and transparent JSON coefficients, reproducible dataset, exact split, predictions/residuals, metrics and plot. Never load untrusted `.joblib` files.

Multiple source records for the same full-isomeric parent are conservatively excluded, regardless of numerical agreement, because their source-table/replicate mapping remains unresolved. All records remain in the ledger. This reduces representativeness and should not be mistaken for a universal curation rule.

The structure-only split attempts scaffold separation, with parent/connectivity protection and a declared fallback. Scaffold separation does not imply genuinely unrelated chemistry. Descriptor ranges and nearest-training similarities are descriptive domain indicators, not calibrated confidence. A small one-assay holdout is uncertain; bad performance is still a valid pilot result. No tuning or alternate split was selected after metrics.

Data attribution: ChEMBL (EMBL-EBI), source URLs and retrieval timestamps in the frozen provenance; ChEMBL data is distributed under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). Original paper: DOI 10.1021/acs.jmedchem.6b00972, PMID 27564135. The study concerns a D3 lead series, but this cohort is specifically its D2 assay. No full article is redistributed here.

Descriptor library: Pat Walters, `useful_rdkit_utils` 2.0.1, reviewed commit 1057ec09a6d55768ecbfa0bfe4f0d3ef3f20163f. Package API is used; workflow code is newly written rather than a reproduced tutorial benchmark.

## Source-provenance check after the first fit

The first model was fitted after the complete cohort was handed off as ready. A later source check identified a possible literature comparator, named GSK598809A in the manuscript, so final release was paused. The registered GSK598809 identity (PubChem CID 11784937) was checked against all 107 source structures: no exact full-identity or stereo-ignored parent-graph match was found. Independent audit confirmed that absence. No exclusion, split change, parameter change or corrective refit was justified or performed.

The suffix “A” and source figure were not visually confirmed, and complete source-table-to-record mapping remains unresolved. This is a **database-attributed, single-assay experimental-label pilot**, not independently verified original laboratory measurements. The original 80-compound cohort and first-fit results remain unchanged. Machine-readable identity checks and source response bytes accompany this note.

The distributed bundle omits the optional locally generated `model.joblib`; use `model_parameters.json` and the readable pipeline. Model replay generates a fresh trusted-local serialization if desired.
For raw-to-cohort reconstruction, run `frozen/curate_assay.py` only in a separate copy: its timestamped summary is regenerated. Compare the eligible CSV and decision ledgers to the frozen hashes. Never rerun curation in the immutable frozen directory before the hash-gated model replay.
