# Drug Hansch Space

Rank a batch of molecules by therapeutic index, highest first, with each molecule scored by a
QSAR model fitted on its own target rather than by one pooled model.

That is the goal. This repository is the working record of how far it gets, which numbers hold up,
and which do not. Most of what follows is about the second part, because that is where the work is.

The explorer is published from `site/` as a static page with no build step:
**[dhruvmenon2003.github.io/drug-hansch-space](https://dhruvmenon2003.github.io/drug-hansch-space/)**

## What the index actually is

```
therapeutic_index = p_activity(primary target) − p_toxicity(hERG, CHEMBL240)
```

Both terms are −log10 mol/L, so the result is a log10 ratio and higher means a wider margin over
the cardiac liability. It is computed in `ti/rank.py` and published to `site/data/ti/summary.json`.

It is not an LD50/ED50 ratio, not a clinical therapeutic index, and not dose-aware. It carries no
information about exposure, duration or patient. Do not read it as safety evidence. A molecule can
sit at the top of this ranking and be unusable for reasons the endpoint cannot see.

hERG is one liability among many, chosen because ChEMBL has enough of it to fit against. Treating
it as *the* toxicity term is a modelling convenience, not a pharmacological claim.

## Conditional routing

The routing rule, stored alongside the results:

> Activity only from a model fitted on the molecule's own target; no pooling across targets. The
> target comes from ChEMBL's mechanism table where one is recorded, otherwise from `ti/router.py`
> on structure alone, and `target_source` says which.

Two consequences are worth stating plainly, because they are easy to miss.

**The ranking is within a target, not across targets.** The published list is grouped by
`target_chembl_id` (42 targets) and each row carries `rank_in_target`. A molecule's index is a
margin measured against its own target's activity scale, so comparing a row from one target with a
row from another is not meaningful, however tempting the single ordered list makes it. The site
presents the list grouped for this reason.

**The router abstains.** When the closest local model scores below the scope floor of 0.45, the
molecule is not ranked and the reason is recorded rather than filled in with a pooled guess. The
reasons in `not_ranked` are specific:

- no usable structure: RDKit could not parse the SMILES
- no usable structure: contains Pt (or Gd), which the Crippen parameters do not cover
- no validated series model and the fallback is below q2 = 0.25
- the router abstained: closest local model scored 0.17, below the scope floor of 0.45

An abstention is a result. It is the part of the workflow that keeps the ranking honest.

## Acceptance gates

A model is only allowed to supply an activity value if it passes one of two gates. These are
deliberately strict.

| Gate | Requirement |
| --- | --- |
| Series Hansch | n ≥ 15, r² ≥ 0.6, LOO q² ≥ 0.5, y-scramble q² ≤ 0.05, median Tanimoto ≥ 0.55 |
| Nonlinear fallback | scaffold-grouped q² ≥ 0.25, shuffled q² ≤ 0.1 |

The median-Tanimoto floor is the congeneric-series check: a model is only treated as a series model
if its members actually resemble each other. The y-scramble ceiling is there so a model that fits
noise cannot pass by fitting it well.

The Hansch form uses clogp, clogp², mr, tpsa, hbd and hba. The fallback draws on 16 descriptors:
mw, clogp, clogp², mr, tpsa, hbd, hba, rotb, aromatic_rings, fsp3, formal_charge, n_basic_centres,
n_acidic_centres, max_partial_charge, min_partial_charge and qed.

## Where this currently stands

From the run published in `site/data/ti/summary.json`:

| | |
| --- | --- |
| Molecules in | 1345 |
| Ranked | 649 (the published summary carries the first 400 rows) |
| Inside the applicability domain | 371 |
| At least one side predicted rather than measured | **620** |
| Both sides measured | 29 |
| **Activity from a validated Hansch series model** | **5** |

Counted per side across all 649 ranked molecules:

| Side | Measured | Series Hansch | Nonlinear fallback |
| --- | --- | --- | --- |
| Activity (own target) | 284 | 5 | 360 |
| Toxicity (hERG) | 57 | — | 592 |

The toxicity side is the weak one: hERG is a measured value for 57 molecules and a prediction for the
other 592. Since the index is a difference between the two sides, almost every row in this ranking
inherits the error of a predicted hERG value.

A caution about where these come from. The row counts above are derived from `site/data/ti/batch.json`,
which carries one row per ranked molecule with its own `as` and `hs` source labels. The `counts` block
in `summary.json` disagrees with them: it reports 337 for "at least one side predicted" where the rows
give 620. `site/js/ti.js` already warns about this in the overlay, in its own words: "Archived summary
source counts do not reconcile with the full batch; use row-level source labels." Take the row-level
labels as authoritative and treat that `counts` block as an archived statistic that has drifted.

The series row is the honest summary of the whole exercise. 2,238 candidate series were tried and
190 cleared the series gate, spread across 85 of the 189 targets that have a model at all, and 139
targets have a usable nonlinear fallback. Yet only five ranked molecules take their activity from a
validated series model. In the published 400 rows the split is 236 from the nonlinear fallback, 160
measured outright, and 4 from a series Hansch model.

So the congeneric-series ideal the routing is built around is reachable, and then almost never
reached in practice. Most rows are carried by the fallback, whose gate (q² ≥ 0.25) is a much weaker
claim than the series gate, and the row's `p_activity_quality` records the actual q² it was fitted
at, often between 0.28 and 0.57. Read that column before trusting a position in the ranking.

Each row records where its numbers came from: `p_activity_source` and `p_toxicity_source` separate
measured from predicted, `p_activity_quality` and `p_toxicity_quality` carry the assay description
or the model's own q², `applicability_domain` says inside or outside, and `routing_decision` says
how the target was chosen. Read those columns before reading the index.

Run with Python 3.13.16, RDKit 2026.09.1, scikit-learn 1.9.1, NumPy 2.5.3.

## The DRD2 model, and why it is in here

Open **DRD2 QSAR · validation** on the home page. It reads `site/data/qsar_drd2.json` when opened
and shows a conditional training-fit surface, scaffold-holdout predictions, 100 y-scrambles, a
Williams plot, validation metrics and coefficient tables.

The model is not predictive:

- scaffold-test R² = −0.0898
- five-fold scaffold q² = −0.2850
- LOO q² = 0.0714

Passing the 100-shuffle chance-correlation check does not rescue those numbers; it only says the
fit is not pure coincidence. Compounds grouped by shared mechanism target are not a congeneric
series, and this is the demonstration of what that costs. The overlay exists so the reasoning and
its failure are inspectable, not because the equation is usable.

The equation inspector decomposes a stored prediction into coefficient × descriptor value. That is
algebra, not mechanism: a term's size does not mean changing that property would change the
biological effect. The inspector uses the scaffold-training model; the separately labelled
all-data coefficient table is a descriptive post-selection fit and is marked as such.

The frozen export is generated by the notebook in
[drug-toxicity-qsar-prediction](https://github.com/DhruvMenon2003/drug-toxicity-qsar-prediction) for
human DRD2 (`CHEMBL217`), binding assays (`B`), `Ki` only. Save its JSON to both
`data/qsar_drd2.json` and `site/data/qsar_drd2.json`; the two must be byte-identical. Do not
hand-edit model metrics. A missing or incompatible export produces an explicit unavailable state
rather than a silent fallback.

To follow one compound through the pipeline, take an InChIKey through `dataset.csv`,
`candidate_features.csv`, `features.csv` and `predictions.csv`, then use the molecule and document
identifiers to trace its measurements in `raw_activities.csv`. `selection.json`, `dropped.csv`,
`feature_selection.json` and `provenance.csv` explain every transition. The
[executed notebook](https://github.com/DhruvMenon2003/drug-toxicity-qsar-prediction/blob/be9bcd29a70b545ecc2420728f5e1206e084a809/curation/hansch_drd2.ipynb)
and [audited outputs](https://github.com/DhruvMenon2003/drug-toxicity-qsar-prediction/tree/944a7e8717ea6bf85815cb1fa103bcd2c4ca2fd4/curation/results/hansch_drd2)
are pinned to the tested revision, and the notebook downloads a SHA-256-verified frozen cache so
replay does not depend on live API results.

## The single-assay pilot

A separate [notebook](notebooks/qsar/chembl3855278/assay_qsar_pilot.ipynb) runs one assay end to
end: frozen ChEMBL records, explicit curation, five descriptors, a grouped split, training-only
scaling and Ridge fitting, then held-out predictions and domain diagnostics.

80 eligible compounds from assay CHEMBL3855278, split 57 training and 23 holdout across six unseen
scaffolds. Ridge holdout R² is −0.052 against −0.077 for the training-mean baseline. Useful
predictive skill is not established. The labels are database-attributed experimental pKi, not
independently verified measurements, and complete paper-row mapping is still unresolved.

The [replay bundle](notebooks/qsar/chembl3855278/README.md) has source and decision ledgers, the
fixed recipe, exact splits, JSON coefficients, predictions and hashes, plus an
[executed notebook](notebooks/qsar/chembl3855278/assay_qsar_pilot.executed.ipynb). Source and
derived tables keep their
[ChEMBL licence and attribution](notebooks/qsar/chembl3855278/DATA_LICENSE.md). The
[Excel workbook](notebooks/qsar/chembl3855278/exports/assay_qsar_pilot_public.xlsx) puts source
records, curation, descriptors, predictions and validation in one file, with a
[QA receipt](notebooks/qsar/chembl3855278/exports/public_qa_receipt.json). The workbook is a static
export: replay regenerates the CSV and JSON, but automatic XLSX regeneration is not established.

### Datamol standalone

[View the notebook](notebooks/qsar/chembl3855278/assay_qsar_datamol_standalone.ipynb) or
[open it in Colab](https://colab.research.google.com/github/DhruvMenon2003/drug-hansch-space/blob/main/notebooks/qsar/chembl3855278/assay_qsar_datamol_standalone.ipynb).
It adapts Pat Walters' molecule, descriptor, property-flag and cluster inspection workflow, then
runs the same frozen 80-compound recipe. The split, features, labels and weak held-out result are
unchanged; the inspection flags and clusters do not select or refit the model.

Nine ordinary Python cells passed locally. Colab execution and a complete live download of all 45
source files are not verified. Setup and attribution notes are in
[DATAMOL_STANDALONE.md](notebooks/qsar/chembl3855278/DATAMOL_STANDALONE.md).

## Running it

```sh
npm run serve        # port 4173, serves site/ directly
npm run check        # import layering, CSP, preload graph, data integrity, first-load budget
npm run test:unit    # 100 node tests
npx playwright test tests/e2e/qsar.spec.mjs tests/e2e/inquiry.spec.mjs tests/e2e/fallbacks.spec.mjs
```

`site/` is published by GitHub Pages as-is. There is no framework and no application bundle. The
first-load budget is tight on purpose and `npm run check` enforces it; at the time of writing the
page sits at roughly 450 KB gzip including fonts, against its own 450 KB ceiling, so new weight has
to buy its way in.

Three shell tests currently fail on `main`, independently of any of the above: two axe colour-contrast
violations on `.inquiry-invitation > .eyebrow` (4.26:1 against a required 4.5:1) and four
under-12px text nodes in the `.ti-live` stage readout.

## Bio-Loom: what was checked, and what this is not

Research checked 22 October 2026. The intended reference is BioByte's **Bio-Loom**, the Hansch/Leo
QSAR software, not the unrelated projects named BioLoom or BioBloom.

| Primary evidence | Verified | How it informs this explorer |
| --- | --- | --- |
| [Product description](http://www.biobyte.com/bb/prod/bioloom.html), [Dotmatics announcement, 5 April 2016](https://www.prnewswire.com/news-releases/dotmatics-partners-with-biobyte-to-offer-clogp-across-the-entire-dotmatics-platform-574592241.html) | Bio-Loom links CLOGP/CMR calculations, property records and QSAR datasets | Connect the compound explorer to model data and its provenance |
| [Manual](http://biobyte.com/bb/manual/Bio-Loom_Manual.html), especially [QSAR lookup](http://biobyte.com/bb/manual/lessons/QSAR.html) and [compound details](http://biobyte.com/bb/manual/lessons/Full_Compound_Details.html) | Compound lookup, dataset selection, parameter and correlation tables, equation details | Search frozen compounds, filter split/domain status, inspect the equation and per-compound terms |
| [C-QSAR manual](http://www.biobyte.com/bb/prod/qsarman2k.pdf) sections V and IX, [worked tutorial](http://www.biobyte.com/blqsar/index.html) | Interpreting parameters, examining outliers, seeking independent support for mechanism | Show validation failures and domain flags beside the equation; keep association separate from mechanism |
| [Products and services](http://www.biobyte.com/bb/Prices_2.html) | Database packages, a ClogP DLL, a command-line product, evaluation licence on request | No claim of open-source licence or numerical compatibility |

The official [BL-1.7 evaluation ZIP](http://www.biobyte.com/downloads/BL-1.7.zip) was downloaded and
inspected with Python `zipfile`: 37,663,114 bytes, 226 entries (96 ordinary files excluding
directories and macOS metadata), SHA-256
`f091e9856a5866096ed47cb57a275c0e7c3f8d753d7e0201c2b5311016cea461`. It contains `BIO-LOOM.exe`,
supporting DLLs and data, HTML/Java editor support, and readable Perl helpers
`Support/approx_match/amatch.pl` and `Support/babel/pipeline.pl`. Those helpers are not the core
Bio-Loom/CLOGP implementation. No core source release was found in the official download, the
linked documentation, or focused public GitHub searches. That is a bounded search result, not proof
that source is unavailable elsewhere. The vendor's HTTP pages were readable; HTTPS fetches
repeatedly failed. No downloaded program was executed, and no vendor code, parameter database or
artwork is redistributed here.

This repository is a small independent implementation of the documented lookup → parameters →
equation workflow, over our own ChEMBL snapshot. RDKit's
[Wildman–Crippen MolLogP/MolMR](https://www.rdkit.org/docs/source/rdkit.Chem.Crippen.html) are
labelled as such and are not BioByte CLOGP/CMR. Whole-molecule MolLogP is also not the classical
substituent hydrophobic constant π. The proprietary fragment/interaction engine, the licensed
Masterfile/CQSAR databases, the molecular editor and multi-target search are not emulated.

### Teaching reference

[Santiago Bolivar's Universal Interactive QSAR notebook](https://github.com/Sbolivar16/QSAR_Tools/blob/cf2514d10038252627d397d2164741077ff5d06f/QSAR_Universal_Interactive.ipynb)
was read as source without execution (30 cells, SHA-256
`b161317e2ebe6287563dd08c226dabfa4ce18fb2821c064335358f508d68ffe2`). Its staged explanations,
attrition report and output guide are useful presentation references. No code was imported.

Where it differs matters: its zero-based cells 10–11 do not filter `standard_units` before naming
`standard_value` as `activity_nM`; cell 13 fits imputation, filtering and scaling before the split
and CV in cell 14; cell 19 plots absolute probability distance from 0.5 under a Williams-plot title
rather than standardized measured residuals. Our strict nM eligibility, pChEMBL response,
fold-local selection, scaffold holdout and measured-residual Williams plot are unchanged. Being
inside the domain does not establish reliability, and docking agreement would not validate
predictive performance.

## Data and licensing

Sources, per-field attribution, citations and the changes made to source data are listed in the
site footer under **Data sources and licences**, and in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Requests made by the data build are in
[data/provenance.csv](data/provenance.csv); cross-checks are in
[data/validation.md](data/validation.md).

Non-commercial and educational. A licence for this project's own code and data has not been chosen
yet; every source keeps its own terms. Nothing here is medical advice, and none of it should be
used for a clinical, regulatory or purchasing decision.
