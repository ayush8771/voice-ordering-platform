# Claude Code Instructions

This repository documents an MVP for multilingual AI voice-first self-ordering and queue management for independent Indian food outlets. Read the relevant project documentation before implementation and follow repository-local instructions.

## Required reading

1. Inspect the repository tree and existing code before proposing changes.
2. Read `docs/AGENTS.md` and the relevant documents from `docs/`: `PRD.md`, `DESIGN_SYSTEM.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `CODE_STYLE.md`, `TESTING.md`, `UX_FLOWS.md`, and `API.md`.
3. Treat statements marked **confirmed**, **assumption**, **provisional**, or **open** according to those labels. Never turn an open item into an invented product decision.

## Product invariants

- Kiosk and QR ordering share the same backend and order rules.
- Backend validates current menu, options, prices, totals, outlet/session scope, and state transitions.
- Customer must explicitly review and confirm before order creation.
- Transcript/provider output may modify a draft only; speech never confirms an order or proves payment.
- Payment status becomes verified only through a verified provider callback or authorized staff confirmation. No payment provider is selected.
- Make order creation and callbacks idempotent. Isolate sessions and outlets.
- Keep Gnani Prisma STT and Timbre TTS credentials server-side. Verify actual provider docs before implementation; do not fabricate API fields or capabilities.
- Do not assume authentication provider, hosting, POS, or production payment integration.
- Preserve touch/keyboard fallback and privacy-conscious audio/log handling.

## Working method

For non-trivial changes, first inspect relevant code and docs, then provide a concise plan with affected files, data/API implications, risks, and validation. Reuse existing patterns and make focused changes. Do not add dependencies or restructure unrelated code without a concrete need. For conflicts or choices marked open that block safe implementation, identify the decision needed instead of guessing.

After coding, run only checks that exist and are relevant. Report exact checks and outcomes; never claim a test, lint, type check, or build passed unless it was run. Review the final changes for unintended edits and update documentation when behavior, architecture, schema, API, security, or conventions change.

Never expose secrets in source, client bundles, prompts, screenshots, or logs. Do not modify synced reference material under `sources/`.
