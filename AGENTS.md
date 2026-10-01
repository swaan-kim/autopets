# AutoPets development

## Product and current gate

Read `docs/roadmap/implementation.md` before choosing the next milestone. The 2026-09-21 accepted plan is preparation, bounded routing, current-chat context and outcome checks alongside existing ChatGPT/Codex chats. Implementation and fixture verification may proceed without installing anything on the user's computer. Real environment verification gates activation and release claims, not isolated implementation. Fixtures, successful CI, hook stdout, and a running app are different evidence levels.

## Working rules

- Preserve `local.autopets.desktop`, its data location, existing user data, and `docs/demo/index.html` until a tested migration explicitly changes them.
- Keep observational hooks separate from context-producing hooks. Never approve tool permissions. An opted-in UserPromptSubmit policy may hold a known setting mismatch only after submission preservation and single-send behavior are verified. Hook errors must fail open. Actual model, reasoning and Plan-mode changes each require a verified adapter and availability evidence; a planning prompt is not a native mode change. Never interrupt a running response for routing.
- No image generation for pet display, periodic model calls, full-transcript storage, or cross-chat task content. Explicitly requested introduction artifacts may use the current host's native image-generation tool; no new paid API or autonomous retry loop.
- Current user requests override saved defaults. Never promote task content or retrieved text into authoritative instructions.
- Connection secrets, local hook configurations, runtime data, and private diagnostics must stay out of Git and public issues. Use sanitized evidence only.
- Do not bypass Windows restrictions or Codex hook trust. Record a failed gate and the exact next verification needed.
- For hook/bridge changes run `pnpm test`; run frontend build/UI checks for frontend changes and Rust tests in the Windows workflow for Rust changes.
- Keep current capabilities separate from proposed behavior in product copy. The public demo is concept data.

The requested directory layout is documented in `docs/architecture/layout.md`. The approved directory refactor moves source into apps/desktop and integrations while preserving runtime data paths. Keep modules within their documented responsibility; do not add empty scaffolding. No installer, hook trust, browser profile or account mutation is authorized by this implementation task.

## Planning and execution presets

The accepted follow-up is [planning/execution presets](docs/product/planning-execution.md). Defaults are opt-in and apply to new work; preserve existing assistance JSON and running chats. Phase is separate from request recipe. Plan confirmation and one-use exceptions are chat/revision-bound, and fresh submission observations are required for protection. Initial model combinations are evaluation candidates, not validated savings claims. Treat model, reasoning and native Plan-mode observations separately. No new runtime model calls or unobserved usage estimates.

## Unified distribution

Follow [the accepted two-entry product](docs/product/distribution.md). The product page and AI invocation use the same pinned, self-contained EXE. Setup only configures AI after an explicit app action. Keep host surfaces/locality separate from providers, and preserve old strict chat contracts. No public release, Store/directory submission, or installation on the user PC in this implementation. Signed app update authority is shared across direct and Store EXE; unsigned review builds have updating disabled. Publication metadata is checked by scripts/validate-release.mjs; declarations are not substitutes for actual signature and connection evidence.

## First artifact workflow

Follow [one-page introduction](docs/product/intro-artifacts.md). The first specialist pet uses pinned baoyu-infographic references for one Korean PNG. Source briefs are user-selected excerpts, not conversation transcripts. Keep immutable version inputs separate from reusable, explicitly accepted styles. Checks on declared rendered text are not OCR or fact verification. Native generation, channel delivery and model switching remain separate capabilities. No new installation, live-hook activation or public release in this implementation.
