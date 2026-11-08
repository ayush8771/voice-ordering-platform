# Claude Code Instructions

This repository documents an MVP for multilingual AI voice-first self-ordering and queue management for independent Indian food outlets. Read the relevant project documentation before implementation and follow repository-local instructions.

## Required reading

1. Inspect the repository tree and existing code before proposing changes.
2. Read `docs/AGENTS.md` and the relevant documents from `docs/`: `PRD.md`, `DESIGN_SYSTEM.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `CODE_STYLE.md`, `TESTING.md`, `UX_FLOWS.md`, `API.md`, and `PROVIDERS.md`.
3. Treat statements marked **confirmed**, **assumption**, **provisional**, or **open** according to those labels. Never turn an open item into an invented product decision.

## Product invariants

- Kiosk and QR ordering share the same backend and order rules.
- Backend validates current menu, options, prices, totals, outlet/session scope, and state transitions.
- Customer must explicitly review and confirm before order creation.
- Transcript/provider output may modify a draft only; speech never confirms an order or proves payment.
- Payment status becomes verified only through a verified provider callback or authorized staff confirmation. No payment provider is selected.
- Make order creation and callbacks idempotent. Isolate sessions and outlets.
- Use Sarvam AI Sarvam 105B Conversations (`sarvam-105b-conversations`) as the planned primary conversational LLM through a replaceable provider adapter. Keep the provider API key server-side; do not make live API calls or assume credits are present before dashboard confirmation.
- Keep Gnani Prisma STT and Timbre TTS as the speech providers, separate from the conversational LLM. Their credentials remain server-side and their exact API details must be verified before implementation.
- One shared conversational layer serves QR and kiosk. Backend services remain authoritative for menu, availability, prices, cart validation, quotes, orders, payments, and pickup tokens.
- Answer requested recommendations whenever asked. Limit proactive recommendations to one per session; never offer one during review, confirmation, or payment; stop proactive suggestions after a decline.
- Expose only allowlisted AI tools and validate tool calls and arguments in backend services. Model output never confirms orders or changes payment state.
- Preserve a complete touch-ordering path when any AI/provider/network/credit dependency is unavailable.
- Do not assume authentication provider, hosting, POS, or production payment integration.
- Preserve touch/keyboard fallback and privacy-conscious audio/log handling.

## Working method

For non-trivial changes, first inspect relevant code and docs, then provide a concise plan with affected files, data/API implications, risks, and validation. Reuse existing patterns and make focused changes. Do not add dependencies or restructure unrelated code without a concrete need. For conflicts or choices marked open that block safe implementation, identify the decision needed instead of guessing.

After coding, run only checks that exist and are relevant. Report exact checks and outcomes; never claim a test, lint, type check, or build passed unless it was run. Review the final changes for unintended edits and update documentation when behavior, architecture, schema, API, security, or conventions change.

Never expose secrets in source, client bundles, prompts, screenshots, or logs. Do not modify synced reference material under `sources/`.

## Graphify Usage

Graphify output lives in `graphify-out/`: `graph.json` (nodes and edges), `GRAPH_REPORT.md` (communities, god nodes, surprising connections), and `graph.html` (interactive view).

1. Consult Graphify when exploring unfamiliar architecture, dependencies, or cross-module relationships.
2. Use the graph to locate relevant files before investigating them.
3. Verify important relationships against actual source code.
4. Treat inferred or ambiguous edges as hypotheses, not facts.
5. Never treat Graphify as a replacement for source code, tests, or project documentation.
6. Refresh the graph after significant code or documentation changes using the supported incremental workflow.
7. Verify graph integrity after updates. Never bypass safety checks or force a rebuild without appropriate backups.
8. Avoid unnecessary graph queries for small, straightforward changes.
