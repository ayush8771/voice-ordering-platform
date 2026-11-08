# Multilingual AI Self-Ordering for Independent Food Outlets

A project to help busy Indian food stalls and independent quick-service outlets manage walk-up orders through a voice-enabled kiosk or QR-based mobile experience. Customers review and confirm an order before it reaches a shared backend and merchant/kitchen dashboard.

> **Project status:** Documentation and MVP planning. This repository currently contains the product documentation pack; application code, setup commands, and deployment instructions have not yet been added.

## The problem

At high-footfall outlets, a single counter can become a bottleneck for taking orders. Customers may leave before ordering, staff can mishear requests, and kitchens need a clear view of what to prepare. This project explores a multilingual self-ordering flow that lets customers place orders by voice or touch while keeping staff in control of fulfillment and payment confirmation.

## Product direction

The MVP is intended for independent Indian takeaway outlets and small QSRs. It supports two customer channels connected to the same backend:

- **Voice-enabled kiosk:** A restaurant-provided tablet or touchscreen with voice and touch ordering.
- **QR mobile ordering:** A customer scans an outlet QR code and orders from a mobile web experience, using voice or touch.

The planned language set is Kannada, English, and Hinglish (Hindi-English code-switching). Gnani Prisma is the intended speech-to-text provider and Gnani Timbre the intended text-to-speech provider. Their API details and capabilities still need verification before implementation.

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
- [Claude Code instructions](CLAUDE.md)

The API routes, payloads, and data schemas are proposals for implementation planning. Confirm them against the actual repository and resolve open decisions before relying on them.

## Repository structure

```
backend/     Node.js + Express API, order processing, provider adapters
frontend/    React clients: customer QR, customer kiosk, merchant dashboard
shared/      API contracts and domain vocabulary used by both sides
docs/        Product documentation (source of truth)
```

`backend/` and `frontend/` already existed in the repository, so the foundation
uses them rather than introducing a different layout. The illustrative layout in
[ARCHITECTURE.md](docs/ARCHITECTURE.md#7-project-structure-guidance) is mapped
onto them: routes, services, models and providers live under `backend/src/`.

## Setup and commands

Requires Node.js >= 20.19 (developed on 24.11) and npm 11. MongoDB is optional
for foundation work; the API starts and reports it as `unconfigured`.

```bash
npm install                       # install all workspaces
cp .env.example backend/.env      # then fill in local values
npm run build --workspace shared  # build shared contracts first
npm run dev                       # backend :4000 and frontend :5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Run backend and frontend together |
| `npm run dev:backend` / `npm run dev:frontend` | Run one side only |
| `npm run build` | Build shared, backend, then frontend |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm run lint` | ESLint |
| `npm run format` | Prettier check (`npx prettier --write .` to fix) |
| `npm test` | Vitest (backend) |

Frontend surfaces during foundation work: `/` customer QR, `/#/kiosk` customer
kiosk, `/#/merchant` merchant dashboard. The Vite dev server proxies `/api` to
the backend.

## Current implementation status

The foundation is in place: workspace tooling, a typed shared contract package,
an Express API with request correlation IDs and the documented error envelope, a
`GET /api/v1/health` probe, an optional MongoDB connection, and React client
shells that verify backend connectivity.

**No product features are implemented.** There is no menu, cart, quote, order,
token, voice integration, staff authentication or payment handling yet. The
`backend/src/services`, `models` and `providers` directories are placeholders.

## Open decisions

- Exact React/Node framework, language (JavaScript or TypeScript), and repository layout.
- Gnani API contracts, supported language identifiers, audio formats, limits, and retention behavior.
- Staff authentication and authorization approach.
- Payment QR source and any trusted callback integration.
- Hosting, TLS, deployment, backups, logging, and retention policies.
- Menu customizations, tax/charge rules, and pickup-token reset policy.
- Pilot outlet, target hardware/network, and measurable success thresholds.

See [PRD open questions](docs/PRD.md#9-constraints-assumptions-open-questions) for the maintained decision list.
