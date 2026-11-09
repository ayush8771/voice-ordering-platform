# Testing Strategy

## 1. Goals

Protect the order lifecycle, money calculations, session boundaries, payment integrity, menu availability, and merchant state transitions. Test critical failure paths as well as the happy path. Test tooling is configured; see section 4 for the exact commands.

## 2. Test layers

### Unit
Test price calculation in integer paise, quantity/option validation, state-transition rules, token generation constraints, idempotency-key handling, and speech/model-intent-to-draft mapping with deterministic fixtures. Test recommendation limits, stop-after-decline behavior, forbidden-phase suppression, tool allowlisting, tool argument validation, and provider-neutral adapter mapping without network calls. Test language display/fallback utilities.

### Integration
**MongoDB-backed tests run against a real `mongod`.** `mongodb-memory-server` (a backend devDependency) downloads and starts an actual MongoDB server; `src/db/testMongoServer.ts` is the harness, and the files are `*.integration.test.ts`. They are part of `npm test`, not a separate command. The first run on a machine downloads a `mongod` binary (several hundred MB) and takes a few minutes; it is cached afterwards and startup drops to a couple of seconds. A machine with no network and no cached binary cannot run these two files - the rest of the suite is unaffected. Do not replace them with a stubbed driver: the faults they exist to catch (index creation and uniqueness, server-side sort order and collation, projection, and the production wiring itself) are invisible to a stub.

The seed is exercised by running `npm run seed` as a child process rather than by re-implementing it, and the menu endpoint is read over a real TCP socket from a listening server using the production wiring (`connectToMongo` plus `createLazyMongoMenuRepository`) with no injected doubles.

Test API validation and MongoDB persistence, outlet/session isolation, concurrent/retried order creation, unavailable menu items, menu price changes between quote and confirmation, staff authorization, status transitions, and payment callback signature/replay/amount matching when a provider is selected. Mock LLM/STT/TTS adapters; assert invalid model tool calls cannot mutate business state and failure/402 paths preserve the draft and touch completion. Do not send real payment, audio, or LLM requests in ordinary automated tests.

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
11. Requested recommendations are available on request; unsolicited recommendations occur no more than once per session and never during review, confirmation, or payment; a decline suppresses further proactive recommendations for that session.
12. Provider output cannot set price, mark payment verified, confirm an order, or bypass backend quote validation and explicit confirmation.

**Covered as of the order milestone** (`routes/orders.integration.test.ts` over a real `mongod`, `services/orders/pickupToken.test.ts` as unit tests):

- items 2, 3 and 4 for order creation: the order is re-priced from the live menu and a moved `menuVersion`, a changed price or a switched-off item is `409` with no order written; a request without a literal `customerConfirmed: true` (including a truthy `"yes"`) is `400` and writes nothing;
- item 5, including the cases a single-process test would miss: five concurrent retries of one `Idempotency-Key` create exactly one order (one `201`, the rest `200` with the same `orderId`), a reused key with a different payload is `409`, and a replay still succeeds after the quote has gone - checked by replaying against a **fresh app instance**, which is what a restart or a second backend instance is;
- item 1 for orders: another session's quote is `409`, an out-of-scope `outletId` is `403`, and a wrong order-read capability, a session token used in its place and an unknown order ID are all `404`;
- item 6 in part: a cash order is `dueAtCounter` and a UPI order `pending`; no request path can reach `verified`;
- pickup tokens: four concurrent orders take `1`-`4` with no repeat, counters are separate per outlet and per outlet-local day, and the outlet's timezone (not UTC) decides the day;
- storage hygiene: the stored order document contains neither the session bearer token nor the raw order-read capability, only their hashes.

Items 7, 8 and 10 remain uncovered because the payment callback and the staff/merchant routes are not implemented (no payment provider is selected and staff authentication is undecided).

**Covered as of the integration-readiness milestone** (`routes/customerJourney.integration.test.ts`, over a real `mongod` with the production wiring): item 9 end to end, not just at the conversation-service boundary - a voice turn and a touch edit land on the same persisted draft, the draft quotes and confirms into an order, the order outlives an explicit session revocation, and the same journey completes through touch alone when no conversational provider is configured; item 5 and item 3's restart form again, this time through the whole chain rather than orders in isolation - a draft built against one app instance is read, quoted, and confirmed into an order tracked from a second instance against the same database, which is what a restart or a second backend instance is. `workflows/quoteFromCart.test.ts` and `routes/cart.test.ts` cover item 2 for the cart-to-quote path specifically: a quote taken from the stored draft cannot diverge from what the cart itself reports, and a draft holding an unavailable line is refused outright rather than quoted with that line dropped. `routes/ordering.test.ts` covers the session-revocation route added this milestone: ending a session clears its draft and makes the capability unusable immediately, and ending an unknown or already-ended session is idempotent.

## 4. Tools, commands, coverage

**Unit/integration tools:** Vitest (configured in `backend/` and `shared/`), with Supertest for HTTP-level API tests and `mongodb-memory-server` for the MongoDB integration tests described in section 2. **E2E tooling:** still undecided; no browser-driver dependency has been added.

**Commands** (run from the repository root):

| Command | Scope |
|---|---|
| `npm test` | Vitest across workspaces that define tests (`shared/`, `backend/`). Includes the MongoDB integration files; see section 2 for the first-run binary download |
| `npm run typecheck` | Strict `tsc --noEmit` for `shared`, `backend`, `frontend` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier check |
| `npm run build` | Shared contracts, backend compile, frontend production build |

Current coverage is foundation, provider, conversation, ordering and MongoDB-integration level.

MongoDB integration (against a real `mongod`): index creation, idempotent
re-creation, and that each unique constraint actually rejects a duplicate while
the outlet-scoped ones still permit the same `publicId` under another outlet;
`_id` never reaching a caller; an inactive outlet indistinguishable from an
unknown one; outlet scoping in the query itself; an operator-shaped ID treated
as a plain value; the lazy repository's 503 and its per-call database
resolution; behavioural parity between the MongoDB and in-memory repositories
over both the sample menu and a multilingual dataset whose names collate
differently byte-wise and locale-wise; `menuVersion` stability across reads,
change on every price, availability, option-delta and category-name edit, and
isolation from another outlet's edits. For persisted ordering sessions and
draft carts: restart recovery (a second store over the same database serves a
session and a draft the first created), that no bearer token is written to disk
and a stored line carries no money field, session and outlet isolation in the
filter, expiry refused on read while the document is still present, the idle
slide clamped to the absolute deadline, revision conflicts between two
instances with no lost line and a stale `If-Match` still `409`, the full-store
refusal, and an absent database surfacing as a retryable `503` on every
operation rather than as an invalid session or a saved draft, and the draft
deadline clamped to the session's. Over HTTP against a real `mongod` with the
production wiring and no injected doubles
(`routes/cartHttp.integration.test.ts`): session creation persisting a
token-free document and refusing an unknown outlet, the full cart verb walk
with `If-Match` accepted and a stale one refused, selection-only storage, one
session's draft invisible to another, restart recovery of both the session and
its draft by a second app instance, and an expired session refusing every cart
verb with the same body an unknown token gets while its draft document is still
present. The teardown workflow is unit-tested for delete order, retries, and a
session still ended when the draft delete keeps failing. Seed and HTTP: `npm run seed` writes the
expected rows, timestamps and indexes, is idempotent across runs (including
preserving `createdAt`), and refuses to run with `NODE_ENV=production` or
without `MONGODB_URI`; the menu endpoint then serves the seeded data over a real
socket with the expected projection, ordering, availability and option
filtering, no outlet configuration, no cross-outlet rows, indistinguishable
404s, and a session-to-quote flow priced from stored documents.

Ordering-session security: token entropy (256 bits, URL-safe encoding, no
repeats over 2000 issuances) and a log reference that does not reveal the
token; outlet isolation including an item that exists only under another
outlet; both expiry deadlines (idle window sliding on use, absolute cap not
extendable by activity, clamping between them, expired sessions dropped from
the store, and an expired token indistinguishable from an unknown one);
bearer-header parsing across malformed, wrong-scheme and multi-token values and
scheme case; the token being ignored when supplied via query string, body or
cookie; and the token never appearing in a log line or a response on the
success, rejected-authentication or unhandled-error path. Request-body faults
(unparseable JSON, oversized body) are asserted to return 400/413 rather than
500 and not to echo the body.

Ordering: integer-money helpers, menu projection (inactive items shown as
unavailable, inactive options and categories omitted, no outlet configuration
leaked, inactive outlet indistinguishable from unknown), menu-version
fingerprint stability and change detection, quote pricing with option deltas,
unknown versus unavailable item and option handling, client-supplied price
fields ignored, request bounds, negative and oversized amounts, quote-store
ownership and expiry, ordering-session issuance/expiry/isolation, the real menu
lookup port including an end-to-end conversation turn resolving a spoken item
name to a backend ID, and HTTP-level status codes for every endpoint. Plus the
conversation service (tool allowlist and argument validation, forbidden-tool
refusal, menu-reference resolution including unknown/unavailable/ambiguous,
option validation, recommendation policy across phases/decline/one-per-session,
session isolation and outlet-scope refusal, bounded history, tool-round limits,
unstructured replies, provider-failure fallback, request validation and
redacted logging). Conversation-to-cart integration is covered end to end with
the real conversation, menu, menu-lookup and cart services and only the LLM
faked (`workflows/conversationTurn.test.ts`): an add proposal priced from the
menu, a deictic "add two of those" resolved through the referent the prompt
carries, the prompt proved to contain the draft but no amount, update and remove
matched by selection rather than line ID, clearing the draft, a change to
something not in the draft, two matching lines refused as ambiguous, a
cart-service refusal surfaced without losing the turn, an unavailable item never
added, provider failure leaving the draft orderable by touch, a forbidden
`create_order` tool changing nothing, and one session's turn never touching
another session's draft. `routes/conversation.test.ts` covers the HTTP contract,
including the `503` and intact touch ordering when no provider is configured.
Plus environment/config validation, the health contract,
correlation-ID behavior, the error envelope, and the Sarvam adapter (configuration validation, request shape, response and
usage parsing, status-to-error mapping including 402, timeout and caller abort,
and API-key redaction). Every adapter test drives an injected fake HTTP client
and the global `fetch` is replaced by a spy that fails the test if a live
request is attempted, so the suite consumes no Sarvam credits. Section 3 above
records which critical acceptance tests are covered and which remain open;
that list, not this paragraph, is the source of truth for status, since items
7, 8 and 10 stay genuinely uncovered until the payment and staff-authentication
decisions are made. Do not invent passing test results or arbitrary coverage
thresholds. Prioritize critical business logic and security boundaries over a
global percentage.

## 5. Completion criteria

- Relevant tests, lint, type checks, and build are run when configured and results are reported truthfully.
- Critical user flow is verified on both customer channels or limitations are stated.
- Invalid input, permissions, retries, provider/network failures, and payment-state integrity are covered.
- Changed files are reviewed and documentation is updated.
