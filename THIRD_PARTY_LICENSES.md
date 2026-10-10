# Third-party licences

Last reviewed: 2026-10-09. This file lists what the published site (`site/`) ships or depends on, with the terms as read on that date.
It is a record of sources, not legal advice. Open questions for the project owner are in [docs/LICENSING-NOTES.md](docs/LICENSING-NOTES.md);
the data terms are summarised on the page itself under "Data sources and licences".

## 1. Code and fonts shipped in `site/`

| Component | Version | Licence | Files | Upstream |
|---|---|---|---|---|
| three.js | 0.169.0 | MIT | `site/vendor/three/three.module.min.js`, `site/vendor/three/addons/controls/OrbitControls.js`, `site/vendor/three/addons/renderers/CSS2DRenderer.js` (further addons from the same package, if copied later, are MIT under the same licence) | https://github.com/mrdoob/three.js |
| GSAP (core) | 3.12.5 | GSAP Standard "No Charge" License | `site/vendor/gsap/gsap.min.js` | https://gsap.com/standard-license/ |
| SmilesDrawer | 2.1.7 | MIT | `site/vendor/smiles-drawer/smiles-drawer.min.js` | https://github.com/reymond-group/smilesDrawer |
| Bricolage Grotesque (latin subset) | 1.001 | SIL OFL 1.1 | `site/vendor/fonts/bricolage-grotesque-normal-500-latin.woff2` | https://github.com/ateliertriay/bricolage |
| IBM Plex Mono (latin subsets) | 2.3 | SIL OFL 1.1, Reserved Font Name "Plex" | `site/vendor/fonts/ibm-plex-mono-normal-400-latin.woff2`, `...-500-latin.woff2` | https://github.com/IBM/plex |
| Newsreader (latin subsets) | 1.003 | SIL OFL 1.1 | `site/vendor/fonts/newsreader-normal-400-latin.woff2`, `newsreader-italic-400-latin.woff2` | https://github.com/productiontype/Newsreader |

The JavaScript files were checked byte-for-byte against the upstream releases (three@0.169.0 and smiles-drawer@2.1.7 on jsDelivr, gsap 3.12.5 on
cdnjs) on 2026-10-09. The site loads nothing from any third-party server.

### three.js (MIT)

Copy of the licence shipped at `site/vendor/three/LICENSE` (identical to the r169 tag):

```text
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### GSAP (Standard "No Charge" License)

GSAP is not open source. It is used under the GSAP Standard "No Charge" License (Webflow, effective April 30, 2025; last modified May 30, 2025),
https://gsap.com/standard-license/. Summary of the terms as read on 2026-10-09 (quotations; the licence page is authoritative):

- Grant: "a non-exclusive, worldwide license to use, reproduce, display, and implement GSAP Products solely for Permitted Uses".
- "'Permitted Uses' means the implementation and/or use of GSAP Products on any website, web application, or digital interface by any person or entity".
- Plain English: "You may use the code at no charge in commercial or non-commercial apps, web sites, games, components, and other software as long as end users are not charged a fee of any kind".
- Restrictions include: no use in tools that "allow users to build visual animations without code" that compete with Webflow's visual animation builder, no reverse engineering to make Competitive Products, and no removal or alteration of "any proprietary notices or branding from GSAP Products".
- Webflow may amend the terms; earlier versions remain available "under the applicable terms licensed to you prior to the effective date".

The shipped file is unmodified and keeps its header: `GSAP 3.12.5, https://gsap.com, @license Copyright 2024, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license`.
Serving the unmodified file from this site fits the quoted "Permitted Uses" wording. **Open question (not decided here):** the licence does not mention
committing the library to a public Git repository or redistributing it as a download; see `docs/LICENSING-NOTES.md`, item 5. The ScrollTrigger plugin is not used.

### SmilesDrawer (MIT)

Copy of the licence shipped at `site/vendor/smiles-drawer/LICENSE.md`:

```text
MIT License

Copyright (c) 2017 GDB / Reymond Research Group

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The authors ask users to cite: Probst D, Reymond J-L. J Chem Inf Model. 2018;58(1):1-7. doi:10.1021/acs.jcim.7b00425 (the repository README asks for this citation).

### Fonts (SIL Open Font License 1.1)

Copyright lines (the full OFL 1.1 text for each family is in [site/vendor/fonts/LICENSES.md](site/vendor/fonts/LICENSES.md)):

- Bricolage Grotesque: Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)
- IBM Plex Mono: Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
- Newsreader: Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)

The fonts are not sold by themselves, and author names are not used to promote the site. Open question about the Reserved Font Name: `docs/LICENSING-NOTES.md`, item 4.

## 2. Data shipped in `site/data/`

| Data | Source | Terms | Fields |
|---|---|---|---|
| Drug list, names, PubChem CIDs, ATC assignments | DrugBank-derived table | DrugBank Terms of Use; academic release CC BY-NC 4.0 (which applies is an open question) | `name`, `cid`, `atc[].code`, `flags` |
| ATC names (893), Adm.R route codes | WHO Collaborating Centre for Drug Statistics Methodology, ATC/DDD Index 2026 | WHOCC copyright notice | `meta.atc_names`, `atc[].routes` (part) |
| Potency, targets | ChEMBL | CC BY-SA 3.0 | `act.*`, `chembl`, `hansch.json` |
| XLogP3, complexity, titles, parent CIDs, 3D conformers | PubChem (NCBI/NLM) | NCBI data policy; per-record rights possible | `d.xlogp`, `d.cx`, `title`, `pcid`, `molecules.json` |
| Route names (label-filled) | openFDA, DailyMed, FDA route list | CC0 / public domain | `atc[].routes` (part) |
| Descriptors, PCA, t-SNE, RDKit conformers, fits | computed with RDKit and marimo-chem-utils | computed values | `d.*`, `pc`, `ts`, `hansch.json` |

Citations are on the page ("Data sources and licences"). Releases and versions that the build did not record are listed in `docs/LICENSING-NOTES.md`, item 7.

## 3. Build-time tools (not distributed with the site)

| Tool | Version | Licence |
|---|---|---|
| RDKit | not recorded | BSD-3-Clause, Copyright (c) 2006-2015, Rational Discovery LLC, Greg Landrum, and Julie Penzotti and others |
| marimo-chem-utils | 0.2.4 | MIT, Copyright (c) 2025 Patrick Walters |
| useful-rdkit-utils (dependency) | 2.0.1 | MIT, Copyright (c) 2021-2025 PatWalters |
| pandas, numpy, scikit-learn | not recorded | BSD-3-Clause |
| requests | not recorded | Apache-2.0 |

None of their code is in `site/`; only numbers they computed are shipped.

## 4. Test tooling (NOT shipped: lives in `devDependencies` and `tests/`, outside the published `site/` folder)

None of these is part of the published site; Pages uploads only `site/`. Emulation covers WebXR API behaviour only; it says nothing about a physical headset.

| Tool | Version | Licence | Used for |
|---|---|---|---|
| Immersive Web Emulation Runtime (`iwer`) | 2.5.0 | MIT, Copyright (c) Meta Platforms, Inc. and affiliates | emulated WebXR runtime in the XR tests |
| `@iwer/sem` (Synthetic Environment Module) | 2.5.0 | MIT, Copyright (c) Meta Platforms, Inc. and affiliates | emulated room (planes, hit-test) |
| Playwright / `@playwright/test` | 1.56.1 | Apache-2.0, Copyright (c) Microsoft Corporation | browser tests |
| axe-core | 4.13.0 | MPL-2.0, Copyright (c) 2015 - 2026 Deque Systems, Inc. | accessibility checks in the tests |
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | axe-core adapter for Playwright |

The MIT licence of `iwer` and `@iwer/sem` (identical text in both packages):

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

axe-core is under the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/); it is used unmodified as a test dependency and no axe-core code is
copied into this repository or the site. The transitive dependencies of these packages are recorded in `package-lock.json`.

## 5. Other candidates (listed only if adopted)

Zdog 1.1.3 (MIT), Vanta.js 0.5.24 (MIT), Vanilla-Tilt 1.8.1 (MIT) were evaluated and are not adopted (see `docs/DECISIONS.md`). If one is adopted later:
vendor an exact version and add its licence here.
