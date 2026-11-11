# Dose-trend analyzer: source

An explorable explanation of the Cochran–Armitage trend test that ends in a working analyzer and a journal-ready figure
studio. The same sources build two homes:

- `python3 build.py --site ../../site/dose-trend` — the folder served at `/dose-trend/` of this site: markup, CSS and
  three scripts beside it, the site's own fonts, its vendored three.js for the molecule, nothing from another origin.
- `python3 build.py` — `dist/index.html`, one self-contained file (webfonts from Google Fonts, PlayCanvas from jsDelivr,
  image and PDF fonts inlined) for hosting the page on its own. Not used by this repository.

## Layout

```
src/
  page.html        markup + CSS (layers: tokens, base, layout, parts, figures, tool) with build placeholders
  core.js          statistics: Cochran–Armitage, exact permutation trend, Fisher, Holm, Wilson, Newcombe, parseTable, analyze
  figure.js        results → figure JSON (sci-figure-gen contract) → SVG / PDF; journal presets; Helvetica metrics
  00-helpers.js    canvas helpers adapted from the explorable template (surface, animate, drag, label, rng …)
  05-fonts.js      PDF_FONTS: inlined data, or the name of pdf-fonts.json fetched on demand
  10-study.js      STUDY block (the table, drug, presets, molecule, panel-a image) + derived S + prose bindings
  20-hero.js       flat 2D molecule drawn at once; a 3D engine (three.js or PlayCanvas, chosen by the build) loaded lazily
  30-figures.js    Figures 1–6 (dots, shuffle, beam, pile, verdicts, landscape)
  40-analyzer.js   paste / screenshot → editable grid → tests → methods and results text
  50-studio.js     figure studio: options → JSON → proof, checks, exports (SVG, PDF, PNG, JSON)
build.py           assembles either target (tokens, scripts, molecule JSON, panel image, PDF fonts)
build_fonts.py     subsets Arimo (OFL) into data/pdf_fonts.json for TrueType embedding in the PDF
data/              apricitabine.json (RDKit ETKDG conformer), pdf_fonts.json
assets/            biorender-panel-a.jpg (draft resolution) and its size-capped web copy
ref/               reference statistics from SciPy / statsmodels (reference.py → reference.json; make_cases.py → cases.json)
test/
  core.test.js     statistics against the reference values (2,296 checks)
  figure.test.js   8 layouts: validation, text overlap, canvas bounds, PDF font embedding
  shoot.py         screenshots of every figure (light, --dark, --width 375, --no-engine)
  interact.py      drives every figure, the analyzer, the studio and the exports; checks prose == model
```

## Build and verify

```
python3 build.py --site ../../site/dose-trend
node test/core.test.js && node test/figure.test.js
python3 test/shoot.py shots/site --root ../../site --page dose-trend/index.html
python3 test/interact.py --root ../../site --page dose-trend/index.html
```

The repository's own checks cover the built folder: `npm run check` (no third-party origin, per-file budgets, links) and
`npx playwright test tests/e2e/dose-trend.spec.mjs`. `test/shoot.py` and `test/interact.py` need Python Playwright with a
Chrome at `/usr/bin/google-chrome`; for the one-file build they can also take `--fonts` (a `node_modules/@fontsource` folder
with STIX Two Text and IBM Plex) and a local PlayCanvas copy under `vendor/package/build/`.

## Adapting to another table

1. Edit the `STUDY` object in `src/10-study.js`: `tableText` (the table as the paper prints it), `focus` (the row the
   essay is about), `drug`, `formula`, `spanner`, `unit`, `population`, `design`, `duration`, `outcome`.
2. Choose `presets` (staircase / spike / flat) for which the captions' claims hold for the new group sizes; Figure 5's
   readouts show whether they do.
3. Replace `data/apricitabine.json` (RDKit: `AllChem.EmbedMolecule(ETKDGv3)` + `MMFFOptimizeMolecule`; atoms `[el,x,y,z]`,
   bonds `[i,j,order]`) or set `molecule: null` to drop the 3D hero.
4. Replace the panel-a illustration or set `panelA: null`.
5. Reread the prose in `src/page.html`: every number is a `data-b` span whose fallback text must equal the computed
   binding (`test/interact.py` and the Playwright spec check this), but the sentences around them are written for this trial.
6. Build, run the checks, look at the screenshots.
