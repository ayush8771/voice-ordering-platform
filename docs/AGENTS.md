# AI Coding Agent Instructions

This file is the detailed agent workflow. The root `AGENTS.md` contains the required project invariants and points to this document for the full workflow; `CLAUDE.md` is the discoverable Claude Code entry point.

## Project context and ownership

Product: multilingual self-ordering and queue management for independent Indian food outlets. React customer kiosk/QR interfaces and merchant/kitchen dashboard share a Node.js API and MongoDB. Kannada, English, Hinglish. Sarvam AI Sarvam 105B Conversations is the planned primary conversational LLM; Gnani Prisma STT and Timbre TTS remain speech providers.

- **Ayush:** backend, AI/provider integration, order processing.
- **Anvesh:** customer and merchant interfaces.
- Both review shared API, state, and schema changes.

## Source of truth

Before significant work, read relevant files in `/docs`: `PRD.md`, `DESIGN_SYSTEM.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `CODE_STYLE.md`, `TESTING.md`, `UX_FLOWS.md`, `API.md`, and `PROVIDERS.md`. Treat confirmed decisions, assumptions, and open questions distinctly. Do not resolve an open question by inventing a vendor, deployment, or capability.

## Workflow

1. Inspect the repository, existing instructions, and relevant code before changing anything.
2. For non-trivial work, state a concise plan, affected files, contract/data changes, and validation needed before implementation.
3. Reuse established patterns; make focused changes and avoid unrelated rewrites or dependencies.
4. Preserve backend authority for menu, availability, prices, cart validation, quotes, order creation, payments, and pickup tokens; require explicit order confirmation; never treat speech or a client claim as payment proof; enforce idempotency and session isolation.
5. Use one shared conversational layer for QR and kiosk, behind a provider adapter whose contract is independent of Sarvam request/response fields. Treat provider output as untrusted and validate all allowlisted tool calls server-side.
6. Customers can request recommendations whenever they ask. Proactive recommendations are limited to one per session, excluded from review/confirmation/payment, and disabled for the rest of the session after a decline.
7. Touch ordering can complete an order if the conversational LLM, speech provider, network, or credits fail. Do not make live Sarvam calls or consume credits without explicit authorization and confirmed dashboard balance.
8. Run only checks that exist and are relevant. Report exact checks run and outcomes. Never fabricate test success; state checks not run.
9. Review the final diff for unintended changes and update docs when product behavior, architecture, data, API, security, or conventions change.

## Stop and clarify

Identify conflicts between requirements and implementation instead of silently guessing. Seek a decision before enabling production payments, choosing an auth provider, deploying/hosting, integrating POS, relying on undocumented Gnani APIs, retaining audio, or making a destructive data change. Keep secrets out of prompts and logs. Do not modify synced reference material under `sources/`.
