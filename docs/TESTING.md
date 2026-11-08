# Testing Strategy

## 1. Goals

Protect the order lifecycle, money calculations, session boundaries, payment integrity, menu availability, and merchant state transitions. Test critical failure paths as well as the happy path. Choose test tooling after inspecting existing repository setup; tool names and commands below are not yet configured.

## 2. Test layers

### Unit
Test price calculation in integer paise, quantity/option validation, state-transition rules, token generation constraints, idempotency-key handling, and speech-intent-to-draft mapping with deterministic fixtures. Test language display/fallback utilities.

### Integration
Test API validation and MongoDB persistence, outlet/session isolation, concurrent/retried order creation, unavailable menu items, menu price changes between quote and confirmation, staff authorization, status transitions, and payment callback signature/replay/amount matching when a provider is selected. Mock provider adapters; do not send real payment or audio data in ordinary automated tests.

### End-to-end / manual
Run kiosk and QR order through review, explicit confirmation, payment choice, token, dashboard receipt, preparation, ready, and collection. Exercise Kannada, English, mixed Hinglish, touch-only ordering, denied microphone permission, noisy/ambiguous speech, network interruption, and customer recovery. Verify actual devices once target hardware is known.

## 3. Critical acceptance tests

1. Two simultaneous sessions cannot view or modify each other's draft/order.
2. Client price manipulation cannot change the server quote or order total.
3. A stale quote after menu price/availability changes must be refreshed or rejected before confirmation.
4. No order is created before explicit confirmation.
5. Repeating a confirmation with the same idempotency key creates one order/token/ticket.
6. Spoken/typed “paid” and a client payment flag do not mark payment verified.
7. Invalid, replayed, mismatched, or unsigned payment callback cannot mark payment verified.
8. Authorized staff can record cash/UPI receipt; unauthorized staff/customer cannot change payment or kitchen status.
9. Provider failure leaves a usable touch-ordering path and does not lose the draft.
10. Dashboard reflects accepted status changes while payment status remains independent.

## 4. Tools, commands, coverage

**Unit/integration tools:** Vitest (configured in `backend/`), with Supertest for HTTP-level API tests. **E2E tooling:** still undecided; no browser-driver dependency has been added.

**Commands** (run from the repository root):

| Command | Scope |
|---|---|
| `npm test` | Vitest across workspaces that define tests (currently `backend/`) |
| `npm run typecheck` | Strict `tsc --noEmit` for `shared`, `backend`, `frontend` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier check |
| `npm run build` | Shared contracts, backend compile, frontend production build |

Current coverage is foundation-level only: environment/config validation, the
health contract, correlation-ID behavior and the error envelope. None of the
critical acceptance tests in section 3 are implemented yet, because the order
lifecycle they cover does not exist yet. Do not invent passing test results or arbitrary coverage thresholds. Prioritize critical business logic and security boundaries over a global percentage.

## 5. Completion criteria

- Relevant tests, lint, type checks, and build are run when configured and results are reported truthfully.
- Critical user flow is verified on both customer channels or limitations are stated.
- Invalid input, permissions, retries, provider/network failures, and payment-state integrity are covered.
- Changed files are reviewed and documentation is updated.
