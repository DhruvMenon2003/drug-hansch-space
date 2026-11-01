# Following an identity across maps

This milestone extends the original static explorer with a lazy-loaded inquiry instrument. Start with **Follow a molecule** in the opening tour card or directly in Explore. Pin the current selection or caffeine, compare Properties / Structure map / PCA overview, inspect the five nearest displayed-coordinate neighbours, and switch between a neighbourhood camera and the whole population. The TPSA sweep changes visual size and reports population counts while preserving the chosen colour encoding and filters. Structure & sources opens the original detail view (full sheet on mobile). The validation link returns control to the existing fit explorer.

## Scientific meaning

Neighbours use Euclidean distance after each displayed axis is scaled by its current filtered population range. This is a view-dependent display metric, not a fingerprint similarity, bioactivity prediction, or applicability-domain criterion. t-SNE coordinates are frozen and do not make distant-cluster distances meaningful. Trails show visual interpolation only. Point size emphasizes the focused view or a threshold; it does not encode potency or uncertainty. Route counts describe recorded routes, not measured bioavailability.

Scientific datasets and model outputs are unchanged. The original exploratory TI tools are available: live readout, axes/colours, ranked batch, decisions, exposure, manual bench, table values, laboratory positions and CSV output. The first draft suppressed them too broadly; that removal has been corrected. The UI now distinguishes the legacy dose log-product, target–hERG pChEMBL difference, and clearance-based conditional exposure estimate. Formula and source labels replace unsupported clinical-TI, free-concentration and safety claims. Source-withheld values remain missing. Existing fit prose now distinguishes internal fit signals from external predictivity; docking prose does not call a proposed pose an experimentally established one.

## Source review and provenance

Baseline: PR36/current tree `65e8479caee2511296c103877bebf4bee70cc10e`; design reference PR33 `516c7e761111e881666a9e8951decc70e4d74ce1`.

Original source ZIP reviewed without importing its reduced experience modules: SHA-256 `ddddd73eaa12cdf014b2c20bc7f6fdc8e8e430945d9ad5b0b20fc8377c8f1ac1`. Current drawing reviewed as element text/IDs and a rendered coordinate-region reconstruction (not a pixel-exact Excalidraw export): SHA-256 `9df310c3598ed2830523026ab22a0010b14d3a999ceeba94b9192501cfb3f812`. Its validation/domain branches informed the separation of exploration from evidence.

The current revision adapts the projected leader-tag drawing mechanism from `explorable/gallery/planetary-gears.html` into `site/js/explorable-tags.js`, with bounded placement and camera-projected anchors. The full MIT notice is retained in `site/vendor/explorable/LICENSE` and root notices. Existing Three.js, GSAP, fonts and chemical assets retain their identities. Inspected references include the user's `explorable/gallery/noise-cancelling.html` (direct manipulation linked to consequences) and `marimo_chem_utils/examples/scatterplot.py` (linked structure inspection). The noise-cancelling example's shared-state pattern also informs paired structure drawings, a raw-property ruler and linked scene annotations. None of the reference physics or scientific computations is imported. The historical pasted prompt was preserved and read; its proposed training code, arbitrary exposure factors and receptor assumptions were not executed.

## Verification limits

Local Chromium with SwiftShader and emulated phone cover the implemented route. Hardware GPU performance, physical phones, XR, public deployment and signed-in Page embedding require separate verification. A passing test suite is not an assertion that the qualitative quality benchmark or full long-term QSAR workflow has been achieved.

## Revision after independent review

The map-distance meaning is now visible beside the representation controls. The fixed logP/TPSA/MR comparison explicitly remains independent of the map representation. Activity cards expose the stored endpoint types, target, document count and primary record links. For caffeine/theophylline, the snapshot contains no caffeine aggregate and a median theophylline pChEMBL of 4.25 over IC50/Ki records from four documents. It cannot establish a pairwise potency difference; individual assay and document IDs were not retained. PubChem links follow the stored structure-parent CID, with dataset CID shown separately.

One concrete inquiry exposed a frozen identity error: dataset CID 6918250 is named ofatumumab, but its parent structure CID 6918251 is C12H10N4O2, MW 242.23. Read-only primary-source checks on 2026-11-01 found that [ChEMBL CHEMBL1201836](https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL1201836.json) describes OFATUMUMAB as an antibody with no small-molecule structure, while [PubChem 6918251](https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/6918251/property/MolecularFormula,MolecularWeight/JSON) describes the small molecule. The inquiry marks this record as needing identity review. It does not repair, remove or retrain on any data, and this spot check is not a full identity audit.

When WebGL is unavailable, the layout becomes a full-width workbench with a compact notice and an SVG projection of the same visible records. It uses the first two non-pseudo map axes, labels any omitted axis, preserves colour encodings/legends and selection, and retains the original table/search/detail route. The projection does not change the three-axis neighbour calculation. The TPSA sweep is active only when TPSA is among the chosen axes.

## Concrete review journeys

1. Follow caffeine; compare theophylline in Properties. TPSA 61.82 versus 72.68 Å² gives a 10.86 Å² difference in computed descriptors. Read the source cards before making an activity claim.
2. Keep caffeine pinned while changing Structure map/PCA. Notice that neighbours change; in PCA, the ofatumumab-labelled record exposes why coordinate proximity and internally consistent SMILES do not validate chemical identity or pharmacology.
3. Filter to recorded oral administration (537 rows), sweep TPSA at 60 and 140 Å², and inspect 183/354 versus 483/54 below-or-above counts. This is a population question about stored descriptors/routes, not an absorption prediction.
4. Return to the existing frozen QSAR validation route to inspect holdout evidence. The display-space neighbour list is not substituted for its applicability-domain evidence.

## Self-critique and release boundary

Compared with PR33, the added value is a persistent identity through multiple representations, explicit comparisons with source evidence, and a linked population slice. The original richer axes, filters, structures and validation remain. This is still a descriptor-space inquiry, not the requested long-term artistic ligand/receptor experience. No receptor geometry, pose or binding animation has been invented. The adapted projected annotations now provide concrete source reuse; the reference gallery's media are preserved but are not presented as scientific imagery. The current typography and guided inquiry improve readability but do not establish that the user's imaginative-experience benchmark has been met.

The delivery destination is the existing GitHub Pages site. Prepare a draft PR for user review; the user alone chooses the final Merge action. Do not merge, enable auto-merge or deploy main. The existing Pages workflow deploys site/ on main pushes and contains no automatic test job. Local checks and independent browser evidence must be reported as local, with final hosted-route verification pending until after an authorized merge.

## Viewport and development-guidance follow-up

The fallback now offers an explicit reversible neighbourhood zoom. It pads the pin plus its five current map neighbours by 15% on each projected axis, draws every filtered record inside that window, and reports in-frame/off-screen counts. For the initial caffeine view, this reveals 14 of 759 records with 745 off-screen. It does not change population filters, neighbour normalization/ranks, source values or the population slice statistics. Known identity mismatches receive a crossed outline in the projection and an inspection marker in 3D; the source record remains available. Directional inquiry glyphs use inline SVG.

Two official frontend design/testing instruction packages were used; AGENTS.md records portable capability-check rules and source provenance. Session-specific installation and transfer receipts remain in the private project record. Instruction packages do not add MCP/browser tools. The full original explorable fork ZIP was downloaded directly from `DhruvMenon2003/explorable` at `4a72bfa74af8f912eb93701cac924ab0fb68b969`: 15,518,883 bytes, 36 files, SHA-256 `f822a64ad09e82363d92a5c36eb7c0707c1f4043c2f0091412d3b6619674825c`. CRC validation passed; gallery pages, templates, examples, images, GIF/MP4 and support code are preserved. No recorder/install scripts were executed.


## Paired exploration and review corrections

Choose a neighbour with **Compare**. Two actual stored SMILES drawings, three descriptor choices and a pair-window ruler show the numerical difference; matching identity tags follow the same records through the existing animated maps. The selected descriptor receives a projected axis bracket only when it is a map axis; other maps say “not a map axis.” No edge is a chemical bond and no transition is a chemical transformation. Identity-mismatched structures are withheld only from the depiction, while the flagged source record remains accessible.

Fresh visual review found and corrected a startup race (comparison chosen before the Properties map), camera-dependent marker sizes that did not update during zoom, redundant selected-name labels, and a mobile detail peek covering the difference. The pair now starts with caffeine/theophylline, persists after map changes and brings its result into view. Structure & sources still opens the full original detail sheet. The duplicate TI stage card appears in TI axis/colour views during inquiry; its full data row remains in the original details.

All ten explanatory HTML comments plus the original preload marker, and the layout policy comment, are restored. The full ranked dialog body now loads on first use from a local HTML fragment, and the added fallback styling loads only in fallback mode, preserving the initial payload budget without erasing rationale or weakening checks.

A separate frozen-data inconsistency is disclosed: summary metadata says 337 rows have a predicted side, while the full 649-row batch contains 620 with predictions and 29 measured-only. No source metadata or result was rewritten. Ranked preview and full Decisions batch remain distinguishable. The laboratory restores the original arithmetic (e.g. famotidine 3.06 and 4.900367…) as explicitly labelled legacy derived values, not validated concentration or TI.

## Access and visual-context correction

Ordinary Explore exposes search, axes/colour, filters and a direct Follow entry before the long inquiry. The instrument opens in a disclosure below those controls; Back and Resume preserve the pin, comparison, selection, map and filters. Both entry buttons share one lazy initialization. The CSV input remains available in its own disclosure. The stale “unavailable” table caption is removed.

Resume also reactivates scene annotations after visiting the fit section, without resetting the current view. The unchanged QED stylesheet and its original comment move to the existing on-demand QED load; charts wait for both their data and styling. This keeps the initial-load budget intact without removing rationale or capabilities.

The ranked table pins molecule identity and target provenance beside horizontally scrolled evidence on desktop. On phones, each row presents all seven fields without horizontal scrolling. It retains the original preview limit, filters and frozen values.

Projected identity tags reserve the population beacon, one another and the moving mobile detail sheet. Sheet bounds trigger on-demand redraws during its CSS transition and stop when settled. Axis labels also reserve the beacon. Molecular drawings follow the application's explicit theme, including an override of the OS preference. Their caption now states that these are independent 2D layouts: the existing depiction library provides no verified common-core alignment mechanism, and no atom correspondence or binding pose has been invented.

The pair ruler's arithmetic and scale are unchanged. In the caffeine/theophylline pair, the log P difference of −0.011 occupies about 9.91% of its labelled pair window, not nearly all of it. The ruler remains a local comparison with explicit bounds, not a population-wide magnitude scale.
