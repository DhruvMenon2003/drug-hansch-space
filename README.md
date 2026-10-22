# drug-hansch-space

The published home explorer is in `site/`; there is no application build step.

The **DRD2 QSAR · validation** button in the home page's Hansch section opens a native overlay. It reads `site/data/qsar_drd2.json` only when opened and shows a conditional training-fit surface, scaffold-holdout predictions, 100 y-scrambles, a Williams plot, validation metrics and coefficient tables. The original 759-drug explorer can colour exactly matched compounds by applicability domain. All response values are pChEMBL.

The reproducible notebook in [drug-toxicity-qsar-prediction](https://github.com/DhruvMenon2003/drug-toxicity-qsar-prediction) generates the frozen export for human DRD2 (`CHEMBL217`), binding assays (`B`) and `Ki` only. Save its compact JSON to both `data/qsar_drd2.json` (source data) and `site/data/qsar_drd2.json` (published asset); the two files must be byte-identical. Do not hand-edit model metrics. Missing or incompatible exports produce an explicit unavailable state.

The displayed prediction and domain diagnostics come from the scaffold-training model. The separate all-data coefficient table is a descriptive post-selection fit. The surface holds other descriptors at training medians; it is not a claim that this target-grouped dataset is a congeneric series.

Check changes with `npm run check`, `npm run test:unit`, and `npx playwright test tests/e2e/qsar.spec.mjs`. The static checker retains its existing 8 MB cap on `site/`. GitHub Pages publishes that folder directly; no new page, framework or application bundle is needed.
