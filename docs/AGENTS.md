# AI Coding Agent Instructions

This file is located under `docs/`; it documents the agent workflow but may not be loaded automatically by coding tools. The root `CLAUDE.md` points to this file and is the discoverable Claude Code entry point. If a root `AGENTS.md` is later added, it should point here and preserve repository-specific instructions.

## Project context and ownership

Product: multilingual voice-first self-ordering and queue management for independent Indian food outlets. React customer kiosk/QR interfaces and merchant/kitchen dashboard share a Node.js API and MongoDB. Kannada, English, Hinglish. Gnani Prisma STT and Timbre TTS are intended integrations; exact APIs remain unverified.

- **Ayush:** backend, AI/provider integration, order processing.
- **Anvesh:** customer and merchant interfaces.
- Both review shared API, state, and schema changes.

## Source of truth

Before significant work, read relevant files in `/docs`: `PRD.md`, `DESIGN_SYSTEM.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `CODE_STYLE.md`, `TESTING.md`, `UX_FLOWS.md`, and `API.md`. Treat confirmed decisions, assumptions, and open questions distinctly. Do not resolve an open question by inventing a vendor, deployment, or capability.

## Workflow

1. Inspect the repository, existing instructions, and relevant code before changing anything.
2. For non-trivial work, state a concise plan, affected files, contract/data changes, and validation needed before implementation.
3. Reuse established patterns; make focused changes and avoid unrelated rewrites or dependencies.
4. Preserve backend authority for menu/prices/status; require explicit order confirmation; never treat speech or a client claim as payment proof; enforce idempotency and session isolation.
5. Run only checks that exist and are relevant. Report exact checks run and outcomes. Never fabricate test success; state checks not run.
6. Review the final diff for unintended changes and update docs when product behavior, architecture, data, API, security, or conventions change.

## Stop and clarify

Identify conflicts between requirements and implementation instead of silently guessing. Seek a decision before enabling production payments, choosing an auth provider, deploying/hosting, integrating POS, relying on undocumented Gnani APIs, retaining audio, or making a destructive data change. Keep secrets out of prompts and logs. Do not modify synced reference material under `sources/`.
