# Following an identity across maps

This milestone extends the original static explorer with a lazy-loaded inquiry instrument. Start with **Follow a molecule** in the opening tour card. Pin the current selection or caffeine, compare Properties / Structure map / PCA overview, inspect the five nearest displayed-coordinate neighbours, and switch between a neighbourhood camera and the whole population. The TPSA sweep changes visual size and reports population counts while preserving the chosen colour encoding and filters. Structure & sources opens the original detail view (full sheet on mobile). The validation link returns control to the existing fit explorer.

## Scientific meaning

Neighbours use Euclidean distance after each displayed axis is scaled by its current filtered population range. This is a view-dependent display metric, not a fingerprint similarity, bioactivity prediction, or applicability-domain criterion. t-SNE coordinates are frozen and do not make distant-cluster distances meaningful. Trails show visual interpolation only. Point size emphasizes the focused view or a threshold; it does not encode potency or uncertainty. Route counts describe recorded routes, not measured bioavailability.

Scientific datasets and model outputs are unchanged. The archived TI mode is not loaded into axes/colours and its ranking entry is unavailable. Table, manual-input bench and standalone laboratory retain raw inputs but withhold incompatible legacy derived TI/exposure values. Existing fit prose now distinguishes internal fit signals from external predictivity; docking prose does not call a proposed pose an experimentally established one.

## Source review and provenance

Baseline: PR36/current tree `65e8479caee2511296c103877bebf4bee70cc10e`; design reference PR33 `516c7e761111e881666a9e8951decc70e4d74ce1`.

Original source ZIP reviewed without importing its reduced experience modules: SHA-256 `ddddd73eaa12cdf014b2c20bc7f6fdc8e8e430945d9ad5b0b20fc8377c8f1ac1`. Current drawing reviewed as element text/IDs and a rendered coordinate-region reconstruction (not a pixel-exact Excalidraw export): SHA-256 `9df310c3598ed2830523026ab22a0010b14d3a999ceeba94b9192501cfb3f812`. Its validation/domain branches informed the separation of exploration from evidence.

No third-party code or assets were imported in this change; existing Three.js, GSAP, fonts and chemical assets retain their source identities and notices. Inspected references include the user's `explorable/gallery/noise-cancelling.html` (direct manipulation linked to consequences) and `marimo_chem_utils/examples/scatterplot.py` (linked structure inspection). They informed interaction design, not scientific computations. The historical pasted prompt was preserved and read; its proposed training code, arbitrary exposure factors and receptor assumptions were not executed.

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

Compared with PR33, the added value is a persistent identity through multiple representations, explicit comparisons with source evidence, and a linked population slice. The original richer axes, filters, structures and validation remain. This is still a descriptor-space inquiry, not the requested long-term artistic ligand/receptor experience. No receptor geometry, pose or binding animation has been invented. No assets were imported from the reviewed inspiration repositories. The current typography and guided inquiry improve readability but do not establish that the user's imaginative-experience benchmark has been met.

The delivery destination is the existing GitHub Pages site. Prepare a draft PR for user review; the user alone chooses the final Merge action. Do not merge, enable auto-merge or deploy main. The existing Pages workflow deploys site/ on main pushes and contains no automatic test job. Local checks and independent browser evidence must be reported as local, with final hosted-route verification pending until after an authorized merge.

## Viewport and development-guidance follow-up

The fallback now offers an explicit reversible neighbourhood zoom. It pads the pin plus its five current map neighbours by 15% on each projected axis, draws every filtered record inside that window, and reports in-frame/off-screen counts. For the initial caffeine view, this reveals 14 of 759 records with 745 off-screen. It does not change population filters, neighbour normalization/ranks, source values or the population slice statistics. Known identity mismatches receive a crossed outline in the projection and an inspection marker in 3D; the source record remains available. Directional inquiry glyphs use inline SVG.

Two official frontend design/testing instruction packages are installed in the executor; AGENTS.md records actual paths, provenance, discovery limits and existing browser capabilities. This setup does not add MCP/browser tools. The full original explorable reference ZIP has been materialized and verified for the next design iteration; no application code has yet been copied from it in this follow-up.
