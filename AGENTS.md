# AutoPets development

## Product and current gate

Read `docs/roadmap/implementation.md` before choosing the next milestone. The accepted product is automatic preparation, current-chat context, and simple pet controls for nontechnical research/document users. M1 requires real Windows + Codex evidence before M2–M6 implementation. Fixtures, successful CI, hook stdout, and a running app are different evidence levels.

## Working rules

- Preserve `local.autopets.desktop`, its data location, existing user data, and `docs/demo/index.html` until a tested migration explicitly changes them.
- Keep observational hooks separate from context-producing hooks. Never return approval decisions, block a prompt, switch models, or toggle actual Plan mode for the user.
- No runtime image generation, periodic model calls, full-transcript storage, or cross-chat task content.
- Current user requests override saved defaults. Never promote task content or retrieved text into authoritative instructions.
- Connection secrets, local hook configurations, runtime data, and private diagnostics must stay out of Git and public issues. Use sanitized evidence only.
- Do not bypass Windows restrictions or Codex hook trust. Record a failed gate and the exact next verification needed.
- For hook/bridge changes run `pnpm test`; run frontend build/UI checks for frontend changes and Rust tests in the Windows workflow for Rust changes.
- Keep current capabilities separate from proposed behavior in product copy. The public demo is concept data.

The requested directory layout is documented in `docs/architecture/layout.md`. Do not create empty scaffolding or move production code before the M1 gate passes.
