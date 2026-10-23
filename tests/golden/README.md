# Parity goldens

`original.json` is what the ORIGINAL single-file app produced for the recipe in `tests/helpers/snapshot.mjs`
(`tests/tools/make-goldens.mjs` drives the original, served from a copy that carries a `window.__dbg` hook). It is never
regenerated from the new site. `tests/e2e/parity.spec.mjs` replays the same recipe on the current site and compares.

Regenerate (only when the snapshot FUNCTION changes, always from the original):

```sh
python3 -m http.server <port> --directory <scratchpad>/arch/site        # the original, vendor-wired, with window.__dbg
node tests/tools/make-goldens.mjs --base http://localhost:<port>/       # byte-identical output for the same original and function
```

Every change to what the goldens hold or to how the spec compares them is listed here, with the reason. Two owners add
sections (the runtime stage and the shell stage); keep each entry to: what changed, why, how it is still checked.

## Runtime stage (S2a-runtime)

### Instance compaction (snapshot function changed, goldens regenerated from the original)

The new site draws only the visible drugs, compacted to the front of the instanced mesh (`points.count == visible`,
`stage.drugAt[slot]` / `stage.slotOf[drug]`); the original draws one instance per drug and hides filtered-out drugs with
scale 0. The old snapshot hashed the raw instance arrays, which differ by construction.

* `matricesSha1` / `colorsSha1` now hash the DRAWN instances (matrix scale > 0) keyed by drug cid, sorted by cid:
  `[cid, round(x*1000), round(y*1000), round(z*1000), round(scale*1000)]` and `[cid, r, g, b]` (colour x 10000).
  Both apps reduce to the same thing, so the comparison stays exact.
* `drawn` (new field) is the number of drawn instances; `colorsN` was dropped (it was `3 * 759`, a constant).
* Verified: regenerating from the original with the new function changes ONLY `matricesSha1`, `colorsSha1`, `colorsN`,
  `drawn` per view (and adds `hanschFor`, see the UX-18 row below); `boot` is byte-identical to the previous golden. The
  later search-blur recipe change (D21 row below) altered further fields in 8 views: `ui:reset-view`, `step:series-again`,
  `ui:show-fit` (view, selection, scene, labels, animation hash, detail), and `animToSha1` in `search:prefix`,
  `pointer:hover`, `pointer:click`, `ui:spin-on`, `ui:spin-off`.
* `table.selectedRows` reads rows with `aria-selected="true"` (original) or `aria-current="true"` (new, see below).

### Deliberate behaviour changes (allow-list)

| Change | Where it shows in a snapshot | How it is checked instead |
| --- | --- | --- |
| Table rows use `aria-current="true"` instead of the invalid `aria-selected` (D22) | `table.selectedRows` (the snapshot reads both attributes, so the value is unchanged) | `tests/e2e/p7-fixes.spec.mjs` (one `aria-current="true"` row, no `aria-selected` anywhere in the table); the snapshot selector accepts either attribute. `style.css` highlights the selected row through `[aria-current="true"]` (the shell stage added it next to the old selector). |
| The Hansch panel follows the group chosen by the tour / Explore (UX-18). The original left the panel on the previous group while the select already read the new one | `hansch.out`, `hansch.cands`, `hansch.plot` (and the new field `hanschFor`, the group the panel is drawn for) in the 11 views where the original's `selects[8]` and `hanschFor` disagree: `step:all` .. `select:dexamethasone`, `step:series-again` | parity.spec.mjs derives the set from the GOLDEN (`selects[8] !== hanschFor`), skips the panel hashes there and asserts instead that the new panel describes the group the select shows; everywhere else the hashes are strict. |
| The search box no longer searches a second time when it loses focus (D21; the original re-ran the search on the pending `change` event, which in the recipe re-selected caffeine and reset the filters inside the unrelated `ui:reset-view` step) | the recipe | `search()` in snapshot.mjs blurs the input inside the search step, so both apps reach the same state; goldens regenerated from the original with that recipe. The duplicate is guarded in `tests/e2e/p7-fixes.spec.mjs` (selection events counted: Enter + blur = 1). |
| Hover is cleared when a layout changes (D23) | none (the recipe never hovers across a layout) | `tests/e2e/p7-fixes.spec.mjs` (hover and tooltip gone after a layout); the filtered-out note is in `lod.spec.mjs` |

### Pixel comparison with the original (sphere LOD 18x12 -> 10x7)

`node tests/tools/pixel-compare.mjs --orig http://localhost:<oracle>/ --new http://localhost:<site>/ --shell-rev 291bdae`
(screenshots of the 8 tour steps, live, original vs new site). Numbers from the S2a run are in the stage report and in
`docs/DECISIONS.md`. Metric: share of pixels that differ visibly (pixelmatch YIQ, threshold 0.2, the metric of Playwright's
`toHaveScreenshot`); the share of pixels that differ by even one grey level is larger (silhouette anti-aliasing of 759
smaller polygons) and is reported as `pctAny`.

## Later stages (explorer features after the split)

Features merged after the shell stage changed what some snapshot fields hold. The goldens were not regenerated (they come only
from the original), and the two tests below check their property without them. The recorded-views test and the search-box test
still compare these fields, and the detail panel HTML that later features extended, with the original, so they report these
differences until each one has an allow-list row and a check of its own.

| Change | Where it shows in a snapshot | How it is checked instead |
| --- | --- | --- |
| The camera fits the cube to the stage (`distanceFactor` in `js/gl/render.js`), so the first pose is 5 % closer than the original's: (2656, 1549, 2988) against (2796, 1631, 3146), with or without a late three.js | `camera.pos` in `load` and every view that has not moved the camera yet | "the first camera pose does not depend on how late three.js arrives" compares a load with three.js held back 1.5 s against a prompt load of the same build, which is the property it names; the recorded-views test still compares the golden pose. |
| The conformer viewer draws a silhouette hull beside the atoms and the bonds (ChimeraX finish, `outline()` in `js/gl/chimera.js`): four meshes over two geometries instead of two meshes | `detail.mol` (four counts instead of two) | "swapping the conformer disposes the old one" collects every mesh, geometry and material of the old group once and requires each to be disposed, instead of counting two of each. |
