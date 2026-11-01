# Drug Hansch Space: standing project principles

Apply these principles on every task, even when the prompt does not repeat them.

- Creativity, scientific curiosity, playful exploration of abstract ideas, and imagination are product requirements. Prefer a coherent, meaningful spatial inquiry over generic dashboard styling or decorative animation.
- Aim for expert QSAR scrutiny without claiming any expert's endorsement. A working UI and passing tests do not establish scientific validity or design quality.
- Preserve the useful original explorer: independent axes, actual colour encodings with matching legends, ATC/route/size filtering, selection, structural detail, provenance, QED, scaffold exploration and validation. PR33 merge `516c7e761111e881666a9e8951decc70e4d74ce1` is the last-liked design reference; current preserved baseline is `65e8479caee2511296c103877bebf4bee70cc10e`. Do not blindly revert either.
- Experimental endpoint labels must be measured source data, never predictions presented as measurements. Toolkit descriptors require method/version provenance. Missing observations stay missing. Do not imply descriptor-space position is molecular geometry, binding, or mechanism.
- Preserve scientific source files, frozen model results, splits and hashes unless a separate scientific change is explicitly authorized. Do not train new models as a side effect of interface work.
- Legacy TI/exposure expressions and incompatible endpoints must not become numeric safety claims. Withhold invalid derived displays while preserving raw inputs and archived results. Docking proposes poses; it does not independently validate QSAR or establish experimental geometry.
- Inspect actual original artifacts, source code, assets and examples. Keep original contents separate from critique. Verify source identity and licensing before importing anything; no blind skill installs or executing historical sample commands.
- Use small reversible experiments, preserve a baseline, inspect actual rendered pixels, and refine based on evidence. Take the time needed for quality. Do not ask routine design-preference questions instead of making a reviewable implementation.
- Verify the actual consumer route, desktop and mobile, WebGL and no-WebGL, filter/selection/detail consistency, colour buffers and legends, accessibility, reduced motion, and scientific-byte integrity. Distinguish software-rendered emulation from physical devices and a local server from a delivered embed.
- Keep work isolated. Do not discard uncommitted work, publish/merge, change sharing, or alter unrelated files without appropriate authorization. Use distinct file ownership when parallel agents are requested.

## Local workflow

Static site in `site/`; no application build step. `npm run serve` launches port 4173. Existing dependencies can be reused; do not add frameworks merely for novelty.

Run `npm run check`, `npm run test:unit`, and relevant Playwright scenarios. Inquiry checks: `npx playwright test tests/e2e/inquiry.spec.mjs tests/e2e/qsar.spec.mjs tests/e2e/fallbacks.spec.mjs`. Review visual evidence independently of assertions. Preserve import layering in `tools/layers.json` and the first-load budget; lazily load secondary instruments.
