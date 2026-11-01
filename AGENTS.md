# Drug Hansch Space: standing project principles

Apply these principles on every task, even when the prompt does not repeat them. Prioritize the quality of the designed experience over mechanically implementing every workflow step; the workflow is a reference, while scientific truth and useful exploration remain requirements.

- Creativity, scientific curiosity, playful exploration of abstract ideas, and imagination are product requirements. Prefer a coherent, meaningful spatial inquiry over generic dashboard styling or decorative animation.
- Aim for expert QSAR scrutiny without claiming any expert's endorsement. A working UI and passing tests do not establish scientific validity or design quality.
- Preserve the useful original explorer: independent axes, actual colour encodings with matching legends, ATC/route/size filtering, selection, structural detail, provenance, QED, scaffold exploration and validation. PR33 merge `516c7e761111e881666a9e8951decc70e4d74ce1` is the last-liked design reference; current preserved baseline is `65e8479caee2511296c103877bebf4bee70cc10e`. Do not blindly revert either.
- Experimental endpoint labels must be measured source data, never predictions presented as measurements. Toolkit descriptors require method/version provenance. Missing observations stay missing. Do not imply descriptor-space position is molecular geometry, binding, or mechanism.
- Preserve scientific source files, frozen model results, splits and hashes unless a separate scientific change is explicitly authorized. Do not train new models as a side effect of interface work.
- Preserve the user-defined legacy index, manual arithmetic, archived rankings and exposure tools. Label their exact formulas, units, endpoint compatibility and measured-versus-predicted sources; do not silently disable whole features because a scientific claim is unsupported. Distinguish the legacy dose log-product from the target–hERG pChEMBL difference and the clearance-based exposure estimate. None establishes clinical TI or safety. Keep source-withheld values missing. Docking proposes poses; it does not independently validate QSAR or establish experimental geometry.
- Inspect actual original artifacts, source code, assets and examples. Keep original contents separate from critique. Verify source identity and licensing before importing anything; no blind skill installs or executing historical sample commands.
- Use small reversible experiments, preserve a baseline, inspect actual rendered pixels, and refine based on evidence. Take the time needed for quality. Do not ask routine design-preference questions instead of making a reviewable implementation.
- Ground each design iteration in a concrete stored-record journey: what scientific question can the reader answer, which source supports it, what could be misread, and what does 3D add? Compare before/after screenshots with PR33 and critique the result from a skeptical QSAR perspective; do not attribute imagined feedback to named experts.
- Verify the actual consumer route, desktop and mobile, WebGL and no-WebGL, filter/selection/detail consistency, colour buffers and legends, accessibility, reduced motion, and scientific-byte integrity. Distinguish software-rendered emulation from physical devices and a local server from a delivered embed.
- Keep work isolated. Do not discard uncommitted work, publish/merge, change sharing, or alter unrelated files without appropriate authorization. Use distinct file ownership when parallel agents are requested.
- Deliver through the existing GitHub Pages site and a reviewable PR. The user retains the final Merge action: do not merge, enable auto-merge, or deploy main. Preserve the chosen visual baseline; installing methodology skills does not authorize a redesign or a new approval process.

## Local workflow

Static site in `site/`; no application build step. `npm run serve` launches port 4173. Existing dependencies can be reused; do not add frameworks merely for novelty.

Run `npm run check`, `npm run test:unit`, and relevant Playwright scenarios. Inquiry checks: `npx playwright test tests/e2e/inquiry.spec.mjs tests/e2e/qsar.spec.mjs tests/e2e/fallbacks.spec.mjs`. Review visual evidence independently of assertions. Preserve import layering in `tools/layers.json` and the first-load budget; lazily load secondary instruments.

## Skills and capability checks

At the start of each session, inspect the available tool and skill catalogs. Confirm actual capabilities before promising browser access, original-file transfer, scientific execution, account integrations or parallel capacity. Instruction packages do not install MCP tools, credentials, runtimes or model caches.

- Use relevant Frontend App Builder and Frontend Testing Debugging guidance for implementation and rendered QA. Product Design audit and Superpowers review/verification workflows can support critique when available. Preserve the static architecture and established visual direction.
- Prefer existing Playwright tests and browser dependencies. Record the browser, renderer and viewport used; SwiftShader and phone emulation do not establish hardware-GPU or physical-device validation.
- Use the current Library or attachment workflow for the actual source type. Preserve original bytes and file identity. Extracted text can truncate records or omit formulas, hidden columns and relation signs; inspect originals before claiming a complete spreadsheet or PDF audit.
- Before scientific execution, verify the environment, required model/registry caches, exact source records and versions. Separate a replay from a new retrieval or fit. Do not turn a missing runtime into an invented result.
- Install only relevant missing skills through their supported installer. Inspect source, licensing and shared dependencies; avoid indiscriminate bulk installation. If a tool or resource is unavailable, record the specific gap and use an authorized supported alternative without claiming the missing capability ran.
- Keep session-specific paths, installation diagnostics, transfer receipts and coordination details in the private project record, outside this reusable public guidance.

The frontend guidance previously used comes from official `openai/plugins` revision `0722921d5542fc593105c27bd52630babd8b8c2a`, under `plugins/build-web-apps/skills/`. Its [manifest](https://github.com/openai/plugins/blob/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-web-apps/.codex-plugin/plugin.json) declares OpenAI, version 0.1.2, MIT. Verify present availability rather than assuming an earlier installation persists.

## Original references and provenance

Reuse originals already preserved in the private project Library/Space. Keep original content separate from critique and derived artifacts. Record exact source identity, license, access limits and artifact hashes; do not place private input files or account identifiers in the public repository.

The full [DhruvMenon2003/explorable fork](https://github.com/DhruvMenon2003/explorable/tree/4a72bfa74af8f912eb93701cac924ab0fb68b969) was inspected at revision `4a72bfa74af8f912eb93701cac924ab0fb68b969`: 36 files, including gallery pages, templates, examples and media. Its original ZIP is 15,518,883 bytes, SHA-256 `f822a64ad09e82363d92a5c36eb7c0707c1f4043c2f0091412d3b6619674825c`; it matched the separately preserved upstream archive.

Inspect actual implementations and assets before adapting them. The projected-label adaptation is documented in `site/js/explorable-tags.js`; the shared-state reference in `site/js/inquiry-pair.js` is conceptual, not copied code. Retain `site/vendor/explorable/LICENSE` and `THIRD_PARTY_LICENSES.md`. The reference repository's no-dependencies validator is unsuitable for this Three.js application. Do not execute its recorder's deletion or overwrite operations as part of source review.
