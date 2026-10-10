# Decisions

Engine decisions per skill (A-Frame, Babylon.js, PlayCanvas, R3F, Zdog/Vanta) are written by the documentation stage. The
sections below record runtime decisions with their measured evidence.

## ScrollTrigger removed

`vendor/gsap/ScrollTrigger.min.js` (GSAP ScrollTrigger 3.12.5) and its `<script>` line are gone; `gsap.min.js` (core) stays for the
camera, layout and fade tweens.

Why:

* ScrollTrigger starts an unconditional `requestAnimationFrame` loop at load (`function _rafBugFix(){return lt&&requestAnimationFrame(_rafBugFix)}`)
  and never stops it. With the render loop stopped it was the only rAF source: 62-120 callbacks per 2 s.
* Chromium CDP `TaskDuration` at idle: **15.7 ms/s with ScrollTrigger, 0.1 ms/s without** (original app, SwiftShader). The idle
  requirement (0 rAF callbacks and 0 draw calls per second after the scene settles) cannot be met while it is loaded.
* It was used only for `onToggle` of eight elements (no scrub, no pin): the same information an IntersectionObserver gives.

Replacement (`js/tour.js`): an IntersectionObserver watching a 2 px strip, the "reading line", expressed as a `rootMargin`. Wide
layouts: 62 % of the viewport height (what `top 62%` .. `bottom 62%` meant). Phones: 30 % down the visible reading area, measured from the
sticky stack (masthead + stage), because the old 66 % line sat inside the area the sticky stage hides (UX-08: at 320 x 568 each
step's heading was dim while the stage still showed the previous step). The observer is rebuilt on a width change, a height change of
150 px or more, a change of the narrow media query, or a change of the stack height; a same-width height change under 150 px (browser
chrome sliding in or out) is ignored (UX-12). `#explore` and `#hansch` cross the same line (UX-19): arriving from the tour, landing
there, or following a link to them shows the all-drugs view / the selected fit; scrolling on from Explore into Hansch keeps a view
the reader built. A preset `app.step` is honoured and survives the first observer batch.

Evidence that the observer equals ScrollTrigger:

* Prototype in the scouting stage (82 scroll samples per viewport against geometric truth, SwiftShader): ScrollTrigger lagged on 3 + 3
  samples, the observer on 5 + 1: equivalent within noise.
* `tests/e2e/tour-scroll.spec.mjs`, sweeping the whole page down and up in 90 px steps at 1280 x 800 and 390 x 844 and comparing the
  active step with the step box that contains the reading line: at most 1 lagging sample per 40 (the bound), every step reached,
  each step scrolled to is active with its view applied, jump links, no `ScrollTrigger` on `window`, not requested, not in the page.
* After removal: idle main thread **0.14 ms/s** (CDP TaskDuration, 10 s, 1280 x 800), **0 rAF callbacks and 0 draw calls** over 10 s.
  gsap's own ticker sleeps after 20 ticks (`gsap.config({ autoSleep: 20 })`, default 120) so the tail after the last tween is short.

## Render on demand

`js/scheduler.js` (pure, unit-tested in `tests/unit/scheduler.test.mjs`) pumps the frames of the main stage and, separately, of the
conformer viewer: at most one rAF pending, none while the tab is hidden, an XR session owns the loop, or the context is lost. A
frame returns whether it wants another (layout tween running, orbit damping or a camera tween moving, Spin on). Everything else
wakes it: orbit controls, hover and selection, layout / recolor / theme, resize (rendered synchronously inside the
ResizeObserver callback, so a resize never leaves a blank canvas), fonts, devicePixelRatio changes, tab visibility, every gsap tween
tick that moves something. Instance matrices are written only while the layout tween runs or hover / selection / layout changed;
the axis-title placement only when the camera or the labels changed. The conformer viewer draws only while `#mol` is on screen and
`#detail-body` is open, and spins for 8 s per molecule. `tests/e2e/idle.spec.mjs` asserts 0 draw calls and rAF growth <= 2 over 3 s
at rest and that every wake trigger draws again within 2 animation frames.

## Adaptive resolution

`js/gl/quality.js`: rungs min(devicePixelRatio, 2), 1.5, 1, 0.75. One rung down when the EMA of the frame time (continuous runs only)
stays above 24 ms for 20 frames, one up when it stays "fast" for 90 frames; after 200 ms of calm one crisp frame at the full cap, back
to the learned rung on the next interaction. "Fast" is relative to the display: 1.25 x the measured refresh interval (10th percentile
of the last 120 rAF gaps, clamped to 6.9 to 17 ms), so 20.8 ms at 60 Hz and 10.4 ms at 120 Hz. The first version needed an EMA under an
absolute 12 ms, which a 60 Hz display (16.7 ms per frame at best) can never deliver, so after any slowdown the page would have stayed at
a low resolution for ever (Wave 2 note N6). A flap guard doubles the number of fast frames the next rise needs (up to 32 x) when a rise
is followed by a drop within 600 frames. Floor, cap, the 60/120/30 Hz recoveries and the interval estimate are unit-tested
(`tests/unit/quality.test.mjs`); `tests/e2e/quality.spec.mjs` drives the page with synthetic frame times through
`window.__hansch.quality` (?debug) so the result does not depend on SwiftShader's speed. On software GL the real governor also steps
down by itself while the boot animation runs at DSF 2, which is the intended behaviour.

## Sphere LOD and instance compaction

Spheres are `SphereGeometry(0.22, 10, 7)` (120 triangles; 759 spheres = 91 080 triangles, was 300 564 at 18 x 12) with antialiasing
on, and only the visible drugs are drawn: they are compacted to the front of the instanced mesh (`points.count == visible`,
`stage.drugAt[slot]` / `stage.slotOf[drug]`; while a layout tween runs the union of the old and new visible sets is drawn so drugs
can grow in and out). Series step: 8 spheres. Picking, hover, the selection ring, recolour, extras and the conformer viewer all work by
drug index (`tests/e2e/lod.spec.mjs`).

Live screenshot difference against the original (`tests/tools/pixel-compare.mjs`, 8 tour steps, original served from the oracle,
new site with the S1 shell so only the 3D rendering differs; S2a run):

| viewport | share of pixels visibly different (pixelmatch YIQ 0.2) | share differing by more than 24/255 in any channel | share differing at all |
| --- | --- | --- | --- |
| 1280 x 800, worst of 8 steps | 0.040 % (structure) | 0.42 % | 2.30 % |
| 390 x 844, worst of 8 steps | 0.019 % (activity) | 0.41 % | 2.28 % |

The pixels that differ at all are silhouette anti-aliasing: 12 x 6, 13 x 6, 14 x 5, 16 x 5 and 12 x 7 give the same 2.2-2.4 % (an
identical 18 x 12 sphere gives exactly 0 %), so no sphere inside the 100k-triangle budget does better and 10 x 7 stays (B1.5).
The criterion "<= 1 % per step" is met under the perceptual and the 24-level metrics and not under the strictest, any-difference one.

## Data pipeline

Everything below is measured on this repository's build (Chromium 141, software GL, a shared 4-core box); the numbers are medians of
five loads and show the order of magnitude, not a device. `tests/e2e/data.spec.mjs` and `tools/check_site.py` hold the limits.

**Conformer shards.** The full conformer table (`tools/data/molecules.json`, 1.07 MB, 329 KB gzip) is the rebuild source and is not
published. `tools/shard_molecules.py` (stdlib, deterministic, idempotent, `--check` for CI) cuts it into 32 files `site/data/mol/<cid % 32>.json`
(6 to 16 KB gzip each, 362 KB for all of them; plus `index.json`, which the page never fetches). `loadMolecule(cid)` in `js/data.js` fetches only the
shard of the drug that was opened, once per shard, with `cache: 'no-cache'`; a failed fetch (network error, non-2xx, bad JSON) is
dropped from the cache so the next call retries, and the panel shows "Could not load the conformer file." with a Retry button. A
drug whose `conf` field is empty costs no request. The first pick used to download the 329 KB table for a molecule of about 1.3 KB;
it now downloads 14 KB (dexamethasone) and the budget is 40 KB. `tools/build_data.py` writes the full table to `tools/data/` and calls the
shard script; `MOL_SHARDS` in `js/data.js` and `index.json` must agree (checked).

**SmilesDrawer is loaded on the first pick** (61 KB gzip, was a blocking `<script>` in the head). `detail.js` adds the script element
once (shared promise, the CSP's `script-src 'self'` allows it) and draws the 2D structure from an idle callback after the 3D conformer
has been built (`conformer:shown`), so the two jobs do not share a task. A failed load shows "Structure drawing not available." and is
not retried for 15 s, so a failure is one console line, not one per pick. SmilesDrawer's layout is one synchronous call that cannot be
sliced: measured 15 ms for a median molecule, 100 to 150 ms at 100 heavy atoms (vancomycin), and for the 25 drugs above 110 heavy
atoms (peptides and glycopeptides, 112 to 492 heavy atoms; cost follows the ring systems more than the atom count) 24 to 278 ms for
eight of the nine measured (ganirelix 49, daptomycin 24, dalbavancin 156, bivalirudin 87, ziconotide 196, secretin 65, nesiritide 114,
enfuvirtide 278) and 922 ms for ecallantide (492 atoms). There is no cheap way to predict the cost, so above 110 heavy atoms
(`MAX_AUTO_ATOMS`) the depiction is not made automatically: the panel says so and offers "Draw anyway". That is a visible change against the original app,
which drew all 759. Looked at: on request, dalbavancin (128 heavy atoms, the molecule the long-task test watches) comes out as a tangle of
crossed lines (the layout does not resolve its bridged macrocycles) and secretin as a one-line chain with unreadable atom labels
at the panel's 360 px, so the automatic drawing buys little for these.

**Structure-map sentence.** The three O(n^2) nearest-neighbour passes of step 2 (35 to 130 ms CPU, 40 to 55 % of the old boot task)
run as a generator in slices of at most 12 ms from idle callbacks after the first paint (`js/idle.js`: `runSliced`, `whenIdle`,
setTimeout fallback for Safari); the paragraph is filled when done and equals the original text exactly (tested against the
goldens). Without the work, the longest task in the first 3 s on an unloaded box is the software-GL context creation (about 140 ms);
on real GPUs that is a few ms.

**Preload and load order.** The block between `<!-- preload:start -->` and `<!-- preload:end -->` in the head is written by
`tools/check_site.py --write-preload` from the real import graph of `js/main.js` (static and dynamic, through the import map): 30
`modulepreload` links plus `data/drugs.json` and `data/hansch.json` as `preload as=fetch crossorigin fetchpriority=low`; the check
fails when the list and the graph differ. The two font preloads stay as they were; there is no `preconnect` (one origin). Placement
matters: with the block after the stylesheets and `gsap`, first contentful paint is unchanged; with it before them, FCP doubles.
Measured with Chromium's CDP emulation (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`, gzip -6 and
`max-age=600` like Pages, five cold loads each, median):

| network / CPU | variant | FCP | first 3D draw | boot done |
| --- | --- | --- | --- | --- |
| 1.6 Mbps, 150 ms RTT, 4x CPU | no hints | 1.38 s | 4.65 s | 4.73 s |
| | hints last in the head (shipped) | 1.38 s | 4.62 s | 4.74 s |
| | hints before the stylesheets | 2.96 s | 4.62 s | 4.74 s |
| 9 Mbps, 70 ms RTT, 4x CPU | no hints | 0.58 s | 2.02 s | 2.09 s |
| | hints last in the head (shipped) | 0.60 s | 1.49 s | 1.58 s |
| 50 Mbps, 40 ms RTT, no throttle | no hints | 0.24 s | 0.80 s | 0.84 s |
| | hints last in the head (shipped) | 0.25 s | 0.63 s | 0.67 s |

On the slow link the page is bandwidth-bound (all 735 KB arrive by 4.2 s whatever the order), so the hints change nothing there; on
every link where latency matters they take 20 to 26 % off the first draw and leave FCP alone. Giving the font preloads
`fetchpriority=low` was tried and changed nothing (first draw 4.67 s), so it was not done. The 1.6 Mbps first draw of 4.6 s misses the
scouts' 4.0 s target: with the fonts it is bytes, not round trips.

**Budgets** (`tools/check_site.py` for files, `data.spec.mjs` for what a browser really fetches): first load 45 requests (limit
45: there is no headroom, see below), one origin, 0 third-party; 428 KB gzip without fonts (limit 450), CLS 0.005 to 0.007 (limit 0.02).
**Not met: 723 KB including fonts against the 450 KB aim.** Chromium requests all five vendored woff2 files at first load (295 KB; they
are already compressed and the owner ruled out re-subsetting): Newsreader 129 KB and Bricolage Grotesque 75 KB (preloaded), Newsreader
italic 62 KB (used by exactly one line, the hint under the plot), IBM Plex Mono 400 and 500 (15 KB each). Even with no fonts at all,
the 428 KB of code and data leave 22 KB. The scouts' measured way to ~410 KB is subsetting to the used glyphs and pinning the variable axes
(fonts ~80 KB), which needs a designer's look at the type; dropping the italic face would save 62 KB and change that one line. The
test keeps a ceiling (740 KB) so the figure cannot grow unnoticed; nothing was relaxed. The request count is also at its limit
(30 modules, 6 stylesheets, gsap, 2 data files, 5 fonts, the page): the three empty stub stylesheets (`kbd.css`, `export.css`,
`xr.css`) cost a request each until they carry content, and each later stage that adds a first-load module or file will break the
count; merging the stylesheets into one file is the cheap fix.

**Caching and versions.** GitHub Pages sends `max-age=600`, so a visitor can hold code from one deploy and revalidate data from the
next. Data and shard JSON is fetched with `cache: 'no-cache'` (a cheap 304 when unchanged; tested on the wire). `tools/stamp_build.py`
(CI only, before the artifact is uploaded; not committed) writes the same build id into `js/version.js` (`APP_BUILD`, `'dev'` in the
repository) and `data/drugs.json` (`meta.app_build`); at start-up a mismatch of two real ids shows a polite, non-blocking "A newer
version of this page is available" banner with a Reload button. A `'dev'` build, or data without an id, never shows it.
