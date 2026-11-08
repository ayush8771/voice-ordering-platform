# Code Style & Conventions

## 1. General principles

Prefer readable, focused code; follow existing repository patterns; avoid speculative abstractions and dependencies. Make the smallest change that satisfies documented behavior. Do not restructure unrelated areas.

## 2. Naming and structure

Follow the existing formatter/linter and file naming. If no convention exists, use PascalCase for React component names, camelCase for functions/variables, UPPER_SNAKE_CASE only for true constants, and descriptive camelCase for JSON/API fields. Use consistent route naming and plural resource nouns. Keep provider-specific names inside adapters. Database conventions are in [DATABASE.md](DATABASE.md).

Do not impose a new monorepo or directory layout before inspecting the repository. Keep UI, transport handlers, domain services, persistence, and external provider adapters separated according to current project structure.

## 3. Components, functions, imports

Components should render a focused concern and delegate business rules to services. Functions should do one logical task and validate boundaries. Prefer explicit types/contracts where the repo uses TypeScript; do not silently introduce TypeScript if the project is JavaScript. Keep imports grouped consistently with existing files; avoid circular dependencies and deep imports that bypass module boundaries.

## 4. Errors and logging

Return structured API errors using [API.md](API.md). Never swallow failures or report an order/payment success unless persisted/verified. User-facing messages should be actionable and avoid internal detail. Server logs should be structured and redacted per [SECURITY.md](SECURITY.md); never log secrets, raw audio, or full sensitive transcripts.

## 5. Comments, formatting, dependencies

Comments explain non-obvious intent, constraints, and tradeoffs, not the syntax. Use repository formatter, linter, and type checker when configured. Do not claim a tool or command is configured until inspected. Avoid adding dependencies when built-in or existing utilities suffice; document why a new dependency is needed.

## 6. Product-specific rules

- Backend recalculates price and validates every order against current menu state.
- Speech-derived content stays a draft until customer confirmation.
- Payment and kitchen states are separate fields and transitions.
- Keep Sarvam-specific request/response fields inside its LLM adapter; shared service contracts must remain provider-neutral.
- Never infer provider capabilities from product names; verify official Sarvam/Gnani API docs before coding or updating provider assumptions.
- Update relevant docs with intentional behavior/contract changes.
