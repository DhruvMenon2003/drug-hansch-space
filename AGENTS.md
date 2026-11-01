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

## Verified development skills and capabilities

Snapshot: 2026-11-01, selected cloud executor. Recheck catalog and tools at the start of a new session; installed instructions do not create MCP tools, credentials, browser access, or additional agents.

| Capability | Verified status and use |
| --- | --- |
| Frontend App Builder | Installed and byte-verified at `/home/agent/.codex/skills/frontend-app-builder/SKILL.md`, including its image-concept reference. Read for substantial visual creation/redesign; preserve this repository's static architecture and scientific constraints. |
| Frontend Testing Debugging | Installed and byte-verified at `/home/agent/.codex/skills/frontend-testing-debugging/SKILL.md`. Read for rendered UI fixes and screenshot/interaction QA. Use existing repository tests and actual state changes. |
| Skill discovery | Both packages are readable on disk; the current executor skill-list API still returns an empty catalog. Read the exact paths if automatic discovery has not refreshed; do not claim account-directory installation. |
| Browser QA | Existing Playwright 1.56.1 and Chromium work with SwiftShader. Browser plugin/Node REPL tools are absent from this session, so record `Browser plugin not available` and use the existing Playwright workflow. No browser package was reinstalled. Emulation is not physical-device validation. |
| Image generation and inspection | Image-generation and local image-view tools are callable. Use concepts/assets for visual exploration, never fabricate scientific measurements, molecular identity or experimental binding geometry. |
| GitHub | Connector reads, branch commits and draft PR creation are verified. User review/merge remains separate. Do not assume GitHub-comment agent integration is configured. |
| Superpowers / Product Design | Now available in this executor cloud catalog. Superpowers receiving-code-review and verification-before-completion, plus Product Design audit, were read for this revision. Apply evidence-based critique without adding routine approval questions already settled by the user. |

The two installed skills come from official `openai/plugins` commit `0722921d5542fc593105c27bd52630babd8b8c2a`, under `plugins/build-web-apps/skills/`; its [manifest](https://github.com/openai/plugins/blob/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-web-apps/.codex-plugin/plugin.json) declares OpenAI, version 0.1.2, MIT. The instruction packages themselves add no application dependencies. Separately, the explorable adaptation below carries its own MIT notice. The original skill files, agent metadata and local references are unchanged.

Installation used the inspected official [skill installer](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-installer/SKILL.md). Its archive download returned HTTP 404 before installation. The authorized GitHub connector supplied the exact pinned files; all five skill files matched upstream Git blob hashes, then the installer's validation/copy functions installed them. Do not repeat a failed download or infer that instruction installation also installed an account plugin.

Optional, not installed here: official [Build Web Data Visualization](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-web-data-visualization) has relevant Three.js, uncertainty and visualization-critique guidance. Its skills depend on shared `../../references`; use the supported whole-plugin setup if selected rather than copying incomplete individual directories. Account plugin setup is coordinated by the parent thread. Avoid bulk installation and duplicate account changes.

## Original references and project record

Reuse originals already preserved in the existing private project Space/Library before repeating downloads or relying on chat summaries. The parent thread coordinates Space updates; return concrete version, artifact, evidence and blockers at milestones instead of editing that record concurrently. Preserve original source content separately from critique, and record missing/access/license limits. Never commit private account identifiers or personal context.

The user's full `DhruvMenon2003/explorable` fork ZIP was downloaded directly from GitHub at revision `4a72bfa74af8f912eb93701cac924ab0fb68b969` and is extracted under `/workspace/reference-originals/DhruvMenon2003-explorable-4a72bfa/` in this executor. The original ZIP is `/workspace/handoff-inputs/DhruvMenon2003-explorable-4a72bfa74af8f912eb93701cac924ab0fb68b969.zip` (15,518,883 bytes); it is byte-identical to the separately preserved upstream `MbappeWU/explorable` archive. SHA-256: `f822a64ad09e82363d92a5c36eb7c0707c1f4043c2f0091412d3b6619674825c`; 36 original files, including gallery, templates, examples and media. Inspect actual implementations/assets before adapting; retain its MIT attribution. Its single-file/no-library validator is not appropriate for this existing Three.js app. Do not execute its recorder's deletion/overwrite operations as part of a source review.
