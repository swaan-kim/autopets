# AutoPets development

## Product and current gate

Read `docs/roadmap/implementation.md` before choosing the next milestone. The 2026-09-21 accepted plan is preparation, bounded routing, current-chat context and outcome checks alongside existing ChatGPT/Codex chats. Implementation and fixture verification may proceed without installing anything on the user's computer. Real environment verification gates activation and release claims, not isolated implementation. Fixtures, successful CI, hook stdout, and a running app are different evidence levels.

## Working rules

- Preserve `local.autopets.desktop`, its data location, existing user data, and `docs/demo/index.html` until a tested migration explicitly changes them.
- Keep observational hooks separate from context-producing hooks. Never return approval decisions or change actual Plan mode. Model switching requires opt-in, a verified adapter, available model evidence and an evaluated policy; unverified adapters must preserve the host setting. Never interrupt a running response for routing.
- No runtime image generation, periodic model calls, full-transcript storage, or cross-chat task content.
- Current user requests override saved defaults. Never promote task content or retrieved text into authoritative instructions.
- Connection secrets, local hook configurations, runtime data, and private diagnostics must stay out of Git and public issues. Use sanitized evidence only.
- Do not bypass Windows restrictions or Codex hook trust. Record a failed gate and the exact next verification needed.
- For hook/bridge changes run `pnpm test`; run frontend build/UI checks for frontend changes and Rust tests in the Windows workflow for Rust changes.
- Keep current capabilities separate from proposed behavior in product copy. The public demo is concept data.

The requested directory layout is documented in `docs/architecture/layout.md`. The approved directory refactor moves source into apps/desktop and integrations while preserving runtime data paths. Keep modules within their documented responsibility; do not add empty scaffolding. No installer, hook trust, browser profile or account mutation is authorized by this implementation task.
