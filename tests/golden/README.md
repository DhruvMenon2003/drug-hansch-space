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
  `drawn` in every view; `boot` and every other field are byte-identical to the previous golden.
* `table.selectedRows` reads rows with `aria-selected="true"` (original) or `aria-current="true"` (new, see below).

### Deliberate behaviour changes (allow-list)

| Change | Where it shows in a snapshot | How it is checked instead |
| --- | --- | --- |
| Table rows use `aria-current="true"` instead of the invalid `aria-selected` (D22) | `table.selectedRows` (the snapshot reads both attributes, so the value is unchanged) | `tests/e2e/shell.spec.mjs` / `lod.spec.mjs` do not depend on it; the snapshot selector accepts either attribute. **CSS dependency (shell):** `#table tbody tr[aria-selected="true"]` in `style.css` must become `[aria-current="true"]`. |
| The Hansch panel follows the group chosen by the tour / Explore (UX-18). The original left the panel on the previous group while the select already read the new one | `hansch.out`, `hansch.cands`, `hansch.plot` in views where `view.group` changes without the select being used | parity.spec.mjs: those hashes are compared strictly except in the views listed in `HANSCH_FOLLOWS_VIEW`; for them the spec asserts the panel text names the group that the select shows (`selects[8]`). |

### Pixel comparison with the original (sphere LOD 18x12 -> 10x7)

`node tests/tools/pixel-compare.mjs --orig http://localhost:<oracle>/ --new http://localhost:<site>/ --head-shell`
(screenshots of the 8 tour steps, live, original vs new site). Numbers from the S2a run are in the stage report and in
`docs/DECISIONS.md`. Metric: share of pixels that differ visibly (pixelmatch YIQ, threshold 0.2, the metric of Playwright's
`toHaveScreenshot`); the share of pixels that differ by even one grey level is larger (silhouette anti-aliasing of 759
smaller polygons) and is reported as `pctAny`.
