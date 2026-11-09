# Multilingual AI Self-Ordering for Independent Food Outlets

A project to help busy Indian food stalls and independent quick-service outlets manage walk-up orders through a voice-enabled kiosk or QR-based mobile experience. Customers review and confirm an order before it reaches a shared backend and merchant/kitchen dashboard.

> **Project status:** Early implementation. The documentation pack is complete; the repository also contains a TypeScript monorepo foundation (health API, config, error envelope, shared contracts, React shell) and the Sarvam conversational LLM provider adapter. Ordering, menu, cart, order and conversation services are not implemented. Deployment is not addressed.

## The problem

At high-footfall outlets, a single counter can become a bottleneck for taking orders. Customers may leave before ordering, staff can mishear requests, and kitchens need a clear view of what to prepare. This project explores a multilingual self-ordering flow that lets customers place orders by voice or touch while keeping staff in control of fulfillment and payment confirmation.

## Product direction

The MVP is intended for independent Indian takeaway outlets and small QSRs. It supports two customer channels connected to the same backend:

- **Voice-enabled kiosk:** A restaurant-provided tablet or touchscreen with voice and touch ordering.
- **QR mobile ordering:** A customer scans an outlet QR code and orders from a mobile web experience, using voice or touch.

The planned language set is Kannada, English, and Hinglish (Hindi-English code-switching). Gnani Prisma STT and Gnani Timbre TTS remain the intended speech providers. Sarvam AI Sarvam 105B Conversations (`sarvam-105b-conversations`) is the planned primary conversational LLM. Each provider sits behind an adapter; see [provider notes](docs/PROVIDERS.md) for verified Sarvam facts and unresolved setup items. Sarvam documents Kannada, Hindi, and English coverage, including romanized and code-mixed text, but application quality for this menu domain still needs evaluation.

## MVP journey

1. Customer opens the outlet menu from a kiosk or QR code.
2. Customer browses by touch or speaks; recognized content is added to an editable draft.
3. The backend checks item availability and calculates prices from the current menu.
4. Customer reviews the order and explicitly confirms it.
5. Customer selects UPI QR instructions or cash at counter.
6. The system creates one order and pickup token, then displays it to the customer and merchant/kitchen dashboard.
7. Staff update preparation and collection status.

Payment status is separate from kitchen status. A QR display, customer claim, or spoken “paid” is not proof of payment. Verification requires a trusted payment callback or authorized staff confirmation.

## Planned technology

| Area | Direction | Status |
|---|---|---|
| Customer and merchant interfaces | React | Confirmed direction |
| Backend | Node.js | Confirmed direction |
| Data store | MongoDB | Confirmed direction |
| Speech recognition | Gnani Prisma STT | Intended provider; API unverified |
| Speech synthesis | Gnani Timbre TTS | Intended provider; API unverified |
| Conversational LLM | Sarvam AI Sarvam 105B Conversations | Planned primary; API documented, account and credits unconfirmed |
| Ordering channels | Kiosk and QR mobile web | Confirmed product direction |
| Payments | UPI QR instructions or cash at counter | MVP choices; no production payment integration selected |

Authentication provider, hosting, deployment, POS integration, payment provider, and exact framework/tooling are undecided. Do not treat the provisional API or database descriptions as implemented contracts.

## Team ownership

- **Ayush:** Backend, AI/provider integration, and order processing.
- **Anvesh:** Customer-facing and merchant-facing interfaces.
- **Shared:** Review API, data model, order-state, and security changes together.

## Documentation

Start with the [Product Requirements Document](docs/PRD.md), then use the supporting documents relevant to your work:

- [Design system](docs/DESIGN_SYSTEM.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database model](docs/DATABASE.md)
- [Security requirements](docs/SECURITY.md)
- [Code conventions](docs/CODE_STYLE.md)
- [Testing strategy](docs/TESTING.md)
- [AI agent instructions](docs/AGENTS.md)
- [Customer and merchant UX flows](docs/UX_FLOWS.md)
- [Provisional API contract](docs/API.md)
- [Provider configuration and verification](docs/PROVIDERS.md)
- [Internal conversation contract and provider notes](docs/API.md#shared-conversational-service-contract-provisional-provider-neutral)
- [Claude Code instructions](CLAUDE.md)
- [Frontend guide: routes, setup, demo-only features and backend dependencies](frontend/README.md)

The API routes, payloads, and data schemas are proposals for implementation planning. Confirm them against the actual repository and resolve open decisions before relying on them.

## Current implementation status

npm workspaces: `shared`, `backend`, `frontend`. Requires Node >= 20.19.

| Command (repository root) | Scope |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Backend API and frontend dev server |
| `npm test` | Vitest in `shared` and `backend`. The `*.integration.test.ts` files start a real `mongod` through `mongodb-memory-server`; the first run on a machine downloads that binary (several hundred MB, a few minutes) and caches it |
| `npm run typecheck` | Strict `tsc --noEmit` across workspaces |
| `npm run lint` / `npm run format` | ESLint / Prettier check |
| `npm run build` | Shared contracts, backend compile, frontend production build |
| `npm run seed --workspace backend` | Upsert the synthetic demo menu into a local MongoDB |

**Implemented:** `GET /api/v1/health`, `GET /api/v1/outlets/:outletId/menu`, `POST /api/v1/ordering-sessions`, `POST /api/v1/quotes`; environment validation, correlation IDs and the shared error envelope; shared contract types for menu, session and quote; three frontend surfaces in one app switched by URL hash; the Sarvam LLM provider adapter in `backend/src/providers/sarvam` behind the provider-neutral interface in `backend/src/providers/llm`; the shared conversational service in `backend/src/services/conversation`; and server-authoritative menu and pricing in `backend/src/services/{menu,quote,sessions}`.

Customer endpoints authenticate with `Authorization: Bearer <sessionId>` from `POST /api/v1/ordering-sessions`, which expires on a 10-minute sliding idle window or a 30-minute absolute cap, whichever comes first. Three contract decisions still need Ayush/Anvesh sign-off and are marked `NEEDS JOINT AGREEMENT` in [docs/API.md](docs/API.md): menu categories, that session transport, and the 422-versus-409 split for invalid versus unavailable selections.

**Not implemented:** order creation, payment, pickup tokens, merchant dashboard actions and menu editing, staff authentication, speech (STT/TTS), and rate limiting. Ordering sessions and issued quotes are held in memory, not MongoDB. The conversation service has no HTTP route yet: its request/result shape is an API contract that Ayush and Anvesh review together before it is exposed.

Copy `.env.example` to `backend/.env` for local development; `backend/.env.example` lists the backend-only provider placeholders. `backend/.env` is loaded automatically by `npm run dev --workspace backend`, `npm start --workspace backend`, and `npm run seed --workspace backend` (shell/deployment environment variables still take precedence over it); nothing else reads it. For local MongoDB, set `MONGODB_URI=mongodb://127.0.0.1:27017` and `MONGODB_DB_NAME=voice_ordering_dev` in `backend/.env`. Do not publish secrets; keep `.env.example` to placeholder variable names only. No live Sarvam request has been made from this repository, and its tests consume no provider credits.

The MVP should be considered ready for demonstration only when its critical flow works across kiosk and QR channels, backend prices and order state are authoritative, duplicate confirmations are handled idempotently, sessions are isolated, and payment status cannot be asserted by the customer client.

## Open decisions

- Exact React/Node framework, language (JavaScript or TypeScript), and repository layout.
- Gnani API contracts, supported language identifiers, audio formats, limits, and retention behavior.
- Sarvam dashboard access, actual introductory credit balance, cost budget and account rate limits.
- Evaluation of Sarvam Conversations quality for Kannada, English, and Hindi-English code-switching in restaurant ordering.
- Staff authentication and authorization approach.
- Payment QR source and any trusted callback integration.
- Hosting, TLS, deployment, backups, logging, and retention policies.
- Menu customizations, tax/charge rules, and pickup-token reset policy.
- Pilot outlet, target hardware/network, and measurable success thresholds.

See [PRD open questions](docs/PRD.md#9-constraints-assumptions-open-questions) for the maintained decision list.
