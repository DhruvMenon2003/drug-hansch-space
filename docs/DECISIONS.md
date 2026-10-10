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
stays above 24 ms for 20 frames, one up below 12 ms for 90 frames; after 200 ms of calm one crisp frame at the full cap, back to the
learned rung on the next interaction. Floor and cap are unit-tested; `tests/e2e/quality.spec.mjs` drives it with synthetic frame
times through `window.__hansch.quality` (?debug) so the result does not depend on SwiftShader's speed. On software GL the real
governor also steps down by itself while the boot animation runs at DSF 2, which is the intended behaviour.

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
