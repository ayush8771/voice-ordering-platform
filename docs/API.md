# API Contract (Provisional)

**Editorial API starter adapted to this product.** The routes, field names, auth mechanism, and schemas below are proposed contracts for team review, not evidence of existing implementation or verified provider APIs. Base path, framework, versioning, and authentication provider are undecided. Use HTTPS in deployment. JSON responses; server is authoritative.

## Conventions

- Suggested base path: `/api/v1`; confirm against repository conventions before implementation.
- Money: integer minor units with `currency: "INR"`.
- Errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "...", "details": [] } }`; avoid internal details.
- **Request body faults**, rejected by the JSON parser before any route runs, use the same envelope: `400 VALIDATION_ERROR` for unparseable JSON, an unsupported encoding or charset, or an aborted body, and `413 VALIDATION_ERROR` for a body over the 32kb limit. The parser's own message is never passed through, so a malformed body is never reflected back to the caller. These were previously returned as `500 INTERNAL_ERROR`, which both misreported whose fault the request was and let any client write stack traces into the server log.
- Client sends IDs/options/quantities, never trusted prices or payment state.
- Ordering requests are outlet/session scoped. Staff endpoints require authenticated, outlet-authorized staff; exact mechanism undecided.
- Use bounded pagination for dashboard lists. Exact rate limits are deployment decision.
- Retryable order creation uses `Idempotency-Key` header; same key and same payload returns original result, same key with different payload returns conflict.

## `GET /api/v1/outlets/{outletId}/menu`

Public active menu for one outlet. Response `200`: `{ outlet: { id, name, currency }, menuVersion, items: [{ id, name, description?, priceMinor, currency, available, options: [{ id, label, priceDeltaMinor }] }] }`. Do not expose private configuration. Errors: `404` unknown/inactive outlet, `429` rate limited.

**As implemented.** Unauthenticated, as documented. Types are exported from `@vop/shared` as `MenuResponse`.

- **NEEDS JOINT AGREEMENT:** the response additionally carries `categories: [{ id, name, sortOrder }]` and each item an optional `categoryId`. Categories are a product concept in [UX_FLOWS.md](UX_FLOWS.md) flow 2 but were absent here. The addition is additive - `items` is unchanged - so a client may ignore it.
- Sold-out items are returned with `available: false` rather than omitted, so the customer sees why an item cannot be chosen. Inactive **options** are omitted entirely.
- An inactive outlet, an unknown outlet and a malformed outlet ID all return the same `404` body, so existence is not disclosed. Outlet IDs must match `[A-Za-z0-9_-]{1,64}`.
- **Listing order** of `categories` and `items` is `sortOrder`, then `name` by Unicode code point, then `id`. The merchant's `sortOrder` carries the display intent; the rest only breaks ties and makes the order total, so repeated reads are identical. It is deliberately *not* locale-aware: see [DATABASE.md](DATABASE.md) section 3 for the open decision.
- `menuVersion` is a 16-character fingerprint derived from the served menu (item price, availability, category, options; category name and order). It changes whenever any of those change, so no write path can forget to bump it.
- `503 SERVICE_UNAVAILABLE` is returned when the database is unreachable; the request is retryable and nothing was written.
- Rate limiting is not implemented; it remains a deployment decision.

## `POST /api/v1/ordering-sessions`

Create an anonymous customer session. Request: `{ outletId, channel: "qr" | "kiosk" }`. Response `201`: `{ sessionId, expiresAt }`; session identifier is an unguessable bearer capability and must not be logged. Errors: `400` invalid input, `404` outlet unavailable, `429` rate limited. Session lifetime and token transport (cookie/header) must be decided and documented before implementation.

**As implemented** (`CreateOrderingSessionRequest` / `CreateOrderingSessionResponse` in `@vop/shared`). The response also echoes `outletId` and `channel` so a client need not track them separately.

- **NEEDS JOINT AGREEMENT - transport:** `Authorization: Bearer <sessionId>`, not a cookie. A header keeps the capability out of URLs and access logs, and avoids needing CSRF defences for cross-origin kiosk/QR clients. Anvesh must confirm before the client is built against it. The server reads the token **only** from this header: the same value in a query string, a request body or a cookie is ignored and the request is a `401`.
- **Lifetime:** two deadlines, whichever comes first.
  - **10 minutes idle**, measured from the last request that successfully authenticated and slid forward by each one. This is what ends an abandoned kiosk session.
  - **30 minutes absolute** from creation, regardless of activity. This bounds the useful life of a leaked token.
  - `expiresAt` in the response is the **absolute** deadline, that is the latest moment the session can work. A client must therefore treat a `401` as possible before `expiresAt` and start a new session rather than assuming the old one is good until then.
  - An earlier revision of this document described the lifetime as "30 minutes idle" while the implementation applied 30 minutes absolute with no idle window at all. The idle window now exists; the figures above are what the code does.
- The session ID is 32 CSPRNG bytes (256 bits), base64url, 43 characters matching `[A-Za-z0-9_-]{43}`. It is never logged; logs carry a 12-character SHA-256 prefix (`sessionRef`).
- Sessions are persisted in MongoDB, so a restart or a second backend instance does not end an open session ([DATABASE.md](DATABASE.md) section 2). Only the token's SHA-256 hash is stored. Both deadlines above are still enforced in the query filter, so nothing this section documents changes with the storage; `503` when the session store is unreachable, and the request is retryable because nothing was written.
- `404` is returned for an unknown **or inactive** outlet, and for an `outletId` that does not match `[A-Za-z0-9_-]{1,64}` - the same bound the menu route applies, so a malformed ID is rejected before it reaches a query and existence is still not disclosed. `503` when the session store is full.
- An expired session and an unknown token return an identical `401` body, so a caller cannot tell a timed-out session from a wrong guess.
- Rate limiting on session creation is **not implemented** ([SECURITY.md](SECURITY.md) section 4 requires it before deployment).

### `DELETE /api/v1/ordering-sessions`

**NEEDS JOINT AGREEMENT - added to close the gap the line above used to describe.** `workflows/endOrderingSession.ts` has supported ending a session since the cart milestone, but no route exposed it, so a customer who taps "end my order" or closes the tab could not revoke the capability early - it simply ran until its own TTL. This route is that revocation endpoint.

- `Authorization: Bearer <sessionId>` is required; a missing header is `401`. There is no body.
- Response: `204` with an empty body, whether or not the session was still live. Ending an unknown, malformed or already-ended session is also `204` - never a `404` - so this cannot be used to probe for a valid token and a client may call it defensively on every exit path without checking state first.
- Deletes the session's draft first, then the session (docs/DATABASE.md section 2's existing ordering for this workflow), each retried up to three times; if the draft delete still fails the session is revoked anyway; the orphaned draft is already unreadable and expires on its own deadline.
- When a conversational provider is configured, the session's in-memory conversation state (recommendation policy, bounded reply history, last-mentioned item) is also discarded.
- `503` only if the session delete itself cannot complete after its retries; nothing about this route makes an order harder to track - `GET /api/v1/orders/{orderId}` uses its own capability and is unaffected.

## `POST /api/v1/quotes`

Validate a draft against current menu and calculate a quote. Requires scoped session. Request: `{ outletId, items: [{ menuItemId, quantity, optionIds: [] }] }`. Response `200`: `{ quoteId, menuVersion, items: [{ menuItemId, name, quantity, optionIds, unitPriceMinor, lineTotalMinor }], subtotalMinor, totalMinor, currency, expiresAt }`. Errors: `400` invalid schema, `401/403` missing/invalid or wrong-scope session, `409` unavailable item/changed menu, `422` invalid option/quantity.

**As implemented** (`QuoteRequest` / `QuoteResponse` in `@vop/shared`). The response also echoes `outletId`.

Pricing rules, all server-side:

- `unitPriceMinor` = item `priceMinor` + the sum of the selected options' `priceDeltaMinor`. `lineTotalMinor` = `unitPriceMinor` x `quantity`. `subtotalMinor` = the sum of line totals.
- `totalMinor` currently equals `subtotalMinor`: no tax or service-charge rule is configured and charge rules remain open ([PRD.md](PRD.md) section 9). The separate field means adding one later is not a breaking change.
- Integer paise throughout, with checked addition and multiplication. A total above 210,000,000 paise is refused, as is any non-integer stored price.
- A delta may be zero or negative, but a combination that would price below zero is refused as `409` rather than clamped.
- The item `name` is snapshotted from the menu. Any price-like field in the request body is ignored, never read.
- Lines are returned in the order submitted and **identical lines are not merged**, so a client can map response lines to request lines by index.
- Bounds: at most 30 lines (`MAX_QUOTE_LINES`), quantity 1-20 per line (`MAX_LINE_QUANTITY`), no repeated option ID within a line.
- `outletId` in the body must equal the session's outlet, else `403`.

**NEEDS JOINT AGREEMENT - error split.** The documented codes are kept and sharpened so a client can tell "wrong" from "sold out": unknown item or unknown option on that item is `422`; existing-but-unavailable item or inactive option is `409`; schema, quantity and bound violations are `400`. `details` carries `[{ menuItemId, optionId? }]` for the offending selection.

A quote creates nothing. It is held in memory for 5 minutes (`expiresAt`) bound to the issuing session, so order creation can later re-validate what the customer actually saw; a quote is invisible to any other session.

**AGREED - relationship to the cart.** The cart endpoints below are the primary customer ordering interface. This route is retained, unchanged and not deprecated, for compatibility with a client that holds its own draft and for independent quote requests - pricing a selection without touching the draft. Its no-merge line behaviour is deliberately different from the cart's; see the cart section.

## Cart draft endpoints

**AGREED - the cart endpoints are the primary customer ordering interface.** An earlier revision of this document assumed the client held the draft and posted it to `POST /api/v1/quotes`; these routes were then added as a reviewed proposal. The decision is now taken: QR and kiosk clients build the order against the cart endpoints, because one shared conversational layer must be able to amend the same draft the touch UI shows ([ARCHITECTURE.md](ARCHITECTURE.md) section 3) and a draft that exists only in the browser cannot be read or changed by a backend conversation tool.

`POST /api/v1/quotes` is **retained**, unchanged, for two uses: compatibility for a client that still holds its own draft, and independent quote requests - pricing a selection without touching the draft. Neither route is deprecated, and the quote contract above is unaffected.

A cart is a **draft and nothing else**: it creates no order, reserves no stock, holds no payment state and is never evidence that a customer confirmed anything. Confirmation still goes through a quote and (later) `POST /api/v1/orders`.

All six routes require `Authorization: Bearer <sessionId>`. There is exactly one draft per ordering session, and the session's outlet is the only scope: a body may carry `outletId`, and if it does not equal the session's outlet the request is `403`. Types are exported from `@vop/shared` as `CartResponse`, `CartLine`, `AddCartItemRequest` and `UpdateCartItemRequest`.

| Route | Effect |
| --- | --- |
| `GET /api/v1/cart` | Current draft, repriced from the live menu. Creates nothing. |
| `POST /api/v1/cart/items` | Add `{ menuItemId, quantity, optionIds? }`. An identical selection merges into the existing line. |
| `PATCH /api/v1/cart/items/{lineId}` | `{ quantity, optionIds? }`. `optionIds`, when present, replaces the line's selection; a replacement that collides with another line is `409`. |
| `DELETE /api/v1/cart/items/{lineId}` | Remove one line. |
| `DELETE /api/v1/cart` | Clear every line. Clearing an empty draft is a no-op. |
| `POST /api/v1/cart/quote` | No body. Quotes the draft exactly as stored. |

Every route returns `200` with the whole draft: `{ cartId, outletId, menuVersion, revision, items: [{ lineId, menuItemId, name, quantity, optionIds, unitPriceMinor, lineTotalMinor, available, issues }], subtotalMinor, totalMinor, currency, hasUnavailableItems, updatedAt }`.

Rules, all server-side:

- **Storage holds selections only** - item ID, option IDs, quantity. No price, name or total is stored, so every amount in a response is computed from the current menu on read and a client value can never become a stored one. The one exception is an add-time name snapshot, used only to label a line whose item has left the menu.
- **Pricing is shared with the quote service** (`backend/src/services/quote/pricing.ts`), so a draft total and a quote for the same selection cannot disagree. Integer paise throughout, same bounds and the same `422`/`409` split as a quote.
- **A mutation refuses a selection that could not be ordered now**: unknown item or option `422`, unavailable item or inactive option `409`, bad schema or quantity outside 1-20 `400`.
- **AGREED - merging.** Adding a selection whose item **and** option set already appear in the draft increases that line's quantity instead of creating a second line; option order is irrelevant, since the set is normalized. This is what a customer means by ordering the same thing again. **Quote behaviour is unchanged:** `POST /api/v1/quotes` still returns lines in the order submitted and never merges identical lines, because there the client owns the line list and maps responses to requests by index. The two differ on purpose; a client must not assume one from the other.
- **AGREED - PATCH collisions return `409`.** If a `PATCH` would make a line identical to another existing line (same item, same option set), the request is refused with `409` and `details: [{ menuItemId, lineId }]` naming the line it collided with. The server never silently merges the two, because folding them together would change a line the caller did not name and would make the resulting quantity a surprise. The client resolves it explicitly - update the other line, or remove one of them.
- **A line already in the draft degrades instead of failing the read.** If its item or option later goes away or is switched off, the line stays, with `available: false`, `issues` from `CART_LINE_ISSUES` (`itemNotOnMenu`, `itemUnavailable`, `optionNotOnItem`, `optionUnavailable`, `notPriceable`) and `unitPriceMinor`/`lineTotalMinor` of `0`. Unorderable lines are excluded from `subtotalMinor` and set `hasUnavailableItems`, so the customer is shown what to remove or replace rather than having the whole draft fail.
  - **AGREED - client obligation.** `unitPriceMinor: 0` is **not a free item**: it means "cannot be priced or ordered now", and the reason is in `issues`. A client must mark these lines distinctly, explain the reason, and **block checkout** - no quote request, no confirmation - until every one is removed or replaced ([UX_FLOWS.md](UX_FLOWS.md) flows 2 and 3). A quote over the same selection returns `409`/`422` anyway, so proceeding only produces a worse error later.
- **Bounds:** at most 30 lines (`MAX_CART_LINES`), quantity 1-20 per line (`MAX_CART_LINE_QUANTITY`), no repeated option ID in one selection. An add that would push an existing line past the quantity cap, or the draft past the line cap, is `409`.
- **AGREED - concurrency and `If-Match`.** Mutations for one session are serialized server-side, so no update is lost between reading and writing a draft, and `revision` is an **integer** that increments on every accepted mutation. The integer form is kept for the MVP: these are first-party clients, the value is opaque to the customer, and a full entity-tag scheme buys nothing until an intermediary needs one.
  - **Request:** send the `revision` from the last cart response as `If-Match: <integer>`, verbatim, on any mutation that must not apply to a draft the client has not seen. Quoting, `W/` weak validators and lists of validators are **not** accepted. Omitting the header means "apply to whatever is there", which is still safe because mutations are serialized; a client editing from one surface may omit it.
  - **Conflict:** a mismatch is `409 CONFLICT` with `details: [{ revision }]` carrying the draft's **current** revision, and the draft is left untouched. The client re-reads (`GET /api/v1/cart`), reapplies the customer's intent to the new state, and retries - a blind retry with the new revision would silently overwrite whatever the other surface did. A malformed or non-integer `If-Match` is `400`.
  - A no-op (unchanged quantity, clearing an empty draft) does not move the revision, so another surface's `If-Match` is not invalidated by an edit that changed nothing. A refused mutation does not move it either.
  - **Voice and touch may edit the same draft at the same moment**; this is exactly what the revision is for ([ARCHITECTURE.md](ARCHITECTURE.md) section 3).
- **AGREED - isolation.** The draft is keyed by ordering session, and a stored draft is refused if its outlet does not match the caller's scope. A `lineId` belonging to another session is reported as `404`, exactly like an unknown or malformed one, so line IDs cannot be probed. This holds for the persisted store as well ([SECURITY.md](SECURITY.md) section 1).
- **Drafts are persisted in MongoDB** ([DATABASE.md](DATABASE.md) section 2), so a restart or a second backend instance does not empty a draft mid-order. A draft expires at `min(last write + 30 minutes, the session's absolute deadline)`, so it never outlives the session that can read it. The **ordering session's expiry stays authoritative** for how long a draft is usable, session/outlet isolation is enforced in the query itself, and the revision check is a conditional write, so concurrency safety does not depend on a single process. A mutation sent **without** `If-Match` that loses a race is retried against the fresh draft rather than refused, which is what "apply to whatever is there" means; a stale `If-Match` is still `409` and carries the stored `revision`. `503` when the draft store is unreachable or full; the request is retryable and nothing was written. The response contract above is unchanged by the storage.

### `POST /api/v1/cart/quote`

**NEEDS JOINT AGREEMENT - closes a gap between the cart and quote milestones.** `POST /api/v1/quotes` prices whatever `items` a caller sends; nothing ties that array to the session's actual draft, so a client building its review screen from the cart (docs/UX_FLOWS.md flow 3) had to re-serialize `CartLine[]` into `QuoteRequest.items[]` itself, with no guarantee the two stayed in sync. This route quotes the stored draft directly (`workflows/quoteFromCart.ts`), through the same `quoteService.createQuote` call a hand-built request reaches, so a cart total and the quote used to confirm it can never disagree.

- No body, no `outletId` to check - the scope is the session's, exactly like every other cart route.
- Response `200`: an ordinary `QuoteResponse`, identical in shape to `POST /api/v1/quotes`.
- `400` when the draft is empty - the same message an empty `items` array gets.
- `409` when any draft line is unavailable (`hasUnavailableItems`), with `details: [{ menuItemId, lineId }]` for every such line, so the response can point at exactly what to remove or replace. This is the server-side form of the obligation already on the client ([UX_FLOWS.md](UX_FLOWS.md) flow 2: "block checkout ... and say that is why") - a client that skipped the check cannot reach a quote through this route either.
- This route **never creates or modifies the draft**; it only reads it. A quote from it is redeemed at `POST /api/v1/orders` exactly like one from `POST /api/v1/quotes` - same `quoteId`, same session-bound ownership, same `409` on an expired or stolen quote.
- `POST /api/v1/quotes` is unaffected and still useful for an independent price check that should not touch the draft.

## `POST /api/v1/orders`

Explicitly confirm and create an order. Requires session and `Idempotency-Key`. Request: `{ outletId, quoteId, paymentMethod: "upiQr" | "cashAtCounter", customerConfirmed: true }`. Server rechecks menu/quote, calculates total, persists order and unique outlet-scoped token atomically as supported by deployment. Response `201` (or `200` replay): `{ orderId, token, orderStatus: "accepted", paymentMethod, paymentStatus: "pending" | "dueAtCounter", totalMinor, currency, createdAt }`. Errors: `400` missing confirmation/schema, `401/403` session issue, `409` stale quote/idempotency conflict, `422` invalid/unavailable selection, `503` persistence unavailable. No payment is verified by this endpoint.

**As implemented** (`CreateOrderRequest` / `CreateOrderResponse` in `@vop/shared`).

- `customerConfirmed` must be literally `true`. A truthy value is not a confirmation, and no draft, quote, transcript or model output substitutes for it ([SECURITY.md](SECURITY.md) section 2).
- Scope comes from the session: `outletId` in the body is only cross-checked and a mismatch is `403`. `channel` is taken from the session, never from the body.
- **The server re-prices.** The quote fixes what the customer saw; the order is priced from the live menu snapshot at confirmation. A `menuVersion` that has moved, or a recomputed subtotal that differs by a single paisa, is `409` ("re-confirm") rather than an order charged at either figure. An unknown item in the quote is still `422` and an unavailable one `409`, through the same pricing module quotes and drafts use.
- **A quote is required and is session-bound.** An expired, unknown or another session's `quoteId` is `409` - the same answer, so quote IDs cannot be probed.
- **Payment.** `cashAtCounter` becomes `dueAtCounter`, `upiQr` becomes `pending`. Neither asserts money was received, and nothing on this path can write `verified`. Staff verification of cash receipt is **not implemented** in this milestone.
- **Idempotency.** `Idempotency-Key` is required: 1-128 printable, non-whitespace characters, else `400`. Enforced by a unique index on `{ outletId, sessionKeyHash, idempotencyKey }`, so concurrent retries of one request create exactly one order - one caller gets `201` and the rest `200`. Same key with a different payload (the payload fingerprint is `quoteId` plus `paymentMethod`) is `409`. A replay works **even after the quote has expired or the process restarted**, because the stored order answers, not the quote.
- **The response additionally carries** `outletId`, `channel`, `items[]`, `subtotalMinor`, `updatedAt`, and - on a first creation only - `orderAccessToken` (see the next section). The documented fields are unchanged.
- **Pickup token.** `token` is sequential from `"1"` per outlet per **outlet-local calendar day** (the outlet's `timezone`), allocated by one atomic counter increment, so two simultaneous orders cannot share a number. It never wraps: a busy outlet reaches four digits rather than reusing a number while that order is still waiting. A number may be **skipped** when an insert turns out to be an idempotent replay; a gap in called-out tokens is harmless. An outlet with no valid timezone cannot allocate a token and is a `500` data fault, not a customer error.
- **The draft is cleared after a successful creation and the session is kept**, so a customer may order again in the same sitting ([DATABASE.md](DATABASE.md) section 2). A draft that cannot be deleted never fails the order: it is already unreadable and expires on its own deadline.
- **Known limitation.** Issued quotes are still held in process memory ([DATABASE.md](DATABASE.md) section 2). A restart or a second backend instance cannot see a quote issued elsewhere, so a customer who confirms across one gets `409` and must re-confirm - never a wrong price. Replays are unaffected. Persisting quotes is the next step if that `409` is observed in practice.

## `GET /api/v1/orders/{orderId}`

Return only the order visible to the scoped customer session or authorized outlet staff. Response: public order summary, token, item snapshot, order status, payment method/status, timestamps. Errors: `401/403` unauthorized or scope mismatch; consider `404` to avoid exposing existence.

**NEEDS JOINT AGREEMENT - the read capability.** This route is scoped above to the ordering session, but a session dies 30 minutes after it starts (and 10 minutes idle) while a customer may still be waiting for food, which would make an order untrackable exactly when it matters. **As implemented:** order creation issues a separate unguessable order-read capability, returned once and stored only as a SHA-256 hash, sent as `Authorization: Bearer <orderAccessToken>`. The route requires **no** ordering session, so tracking survives session expiry.

- A wrong capability, a session token used in its place, and an unknown `orderId` are all `404` ("Order not found"): existence is never disclosed. A missing header is `401`.
- The response is `OrderResponse` and never echoes the capability back.
- Staff access to an order is a separate route and still blocked on the undecided staff authentication mechanism (below).

## `GET /api/v1/merchant/orders`

Staff-only outlet-scoped queue. Query: `status` (optional), `limit` (bounded), `cursor` (opaque). Response: `{ items: [order summaries], nextCursor }`. Errors: `401` unauthenticated, `403` wrong outlet/role, `400` invalid query.

## `PATCH /api/v1/merchant/orders/{orderId}/status`

Staff-only state transition. Request: `{ status: "preparing" | "ready" | "collected" }`. Server validates transition and records actor/time. Response: updated order status and timestamp. Errors: `401/403`, `404`, `409` invalid transition, `422` invalid status.

**Not implemented.** Both merchant routes are blocked on the staff authentication mechanism, which this document records as undecided; implementing them would mean inventing an authorization model. An order is created as `orderStatus: "accepted"` with a `statusHistory[]` entry (`actorKind: "customer"`), which is what these routes will append to.

## Payment verification (not implemented/selected)

No public client endpoint may set `paymentStatus=verified`. A future `POST /api/v1/payment/webhook/{provider}` must verify provider signature, replay/timestamp protections, order and outlet binding, amount/currency, and idempotency before changing status. A separate authorized staff action may record manual receipt with actor and audit note. Provider and exact payload/signature contract are open; do not implement a guessed callback.

## Shared conversational service contract (provisional, provider-neutral)

One backend conversational service is used by both QR and kiosk clients. Clients send user input to the application API; they never call Sarvam or another LLM directly. Keep this internal contract independent of any provider SDK or wire format.

Suggested normalized request: `{ sessionId, channel: "qr" | "kiosk", locale, text, phase, draftSummary, menuVersion }`. Suggested normalized result: `{ assistantText, draftActions: [{ type, menuItemId?, quantity?, optionIds? }], toolRequests: [], usage?: { inputTokens?, outputTokens?, totalTokens? }, providerStatus }`.

**As implemented** (`backend/src/services/conversation`, reached over HTTP through `POST /api/v1/conversation/turns` below): the request adds `outletId` because every turn must be outlet-scoped, renames `locale` to `language` (the `Language` union already in shared contracts), and adds `customerDeclinedRecommendation` so the caller can report a decline. `draftSummary` carries item ID, name, quantity and option IDs but **no prices or totals**, so the model cannot restate money. The result adds `suggestions` (resolved menu items with `kind: "requested" | "proactive"`), `needsClarification`, `policy` (recommendation allowance state) and `violations` (what the service refused). `providerStatus` is `{ state: "ok" | "failed", providerId, model, code?, retryable?, fallback? }`; on failure `assistantText` is absent, `draftActions` is empty and `fallback` is `"touch"`. Do not include client prices as trusted data. Resolve menu items to IDs using backend menu data; validate each draft action and calculate all prices server-side.

Sarvam adapter configuration belongs on the server and is limited to provider base URL, secret key reference, model ID, timeouts, and bounded request/output budgets. Map normalized messages, tool calls, streaming chunks, usage, and provider errors to the shared service contract. Keep provider fields out of shared API payloads, domain models, and frontend code. Replacing the adapter must not change ordering/business logic.

Only server-defined tools may be offered to the model (for example, menu search/detail lookup and draft-cart proposal). The backend validates tool name, schema, session/outlet scope, current menu version, item availability, and quantities before execution. Never expose order creation, quote acceptance, payment verification, or state-transition tools. A model tool call is a proposal and cannot replace the customer's review and explicit confirmation.

**As implemented:** the allowlist is exactly `menu_search`, `menu_item_details` and `propose_draft_update`. The two lookups are read-only and executed by the service through the menu port, bounded by a configurable number of tool rounds per turn. `propose_draft_update` is never executed: it yields a draft action for customer review. An item reference from the model is resolved against backend menu data and is refused when it is unknown, unavailable or ambiguous, rather than guessed. Option IDs must exist on the resolved item or the whole proposal is dropped. Draft actions have no price field at all. A forbidden name such as `create_order` or `verify_payment` is rejected and recorded as a violation.

### `POST /api/v1/conversation/turns`

**NEEDS JOINT AGREEMENT - this route is not in the sections above.** The contract here was specified as internal, but a QR or kiosk client cannot reach it any other way, and clients must never call an LLM directly. One route is therefore added rather than a family of them: everything else a turn needs already exists as a cart endpoint.

Requires `Authorization: Bearer <sessionId>`. Request: `{ text, language: "en" | "kn" | "hi", phase: "browsing" | "building" | "review" | "confirmation" | "payment", outletId?, customerDeclinedRecommendation? }`.

- `sessionId`, `outletId` and `channel` come from the **session**. `outletId` in the body is only cross-checked (`403` on a mismatch); `channel` in a body is ignored, because it decides kiosk-versus-QR wording and is not the caller's to choose.
- Response `200`: `{ assistantText, cart, draftActions: [{ action, applied, reason?, message? }], suggestions, needsClarification, providerStatus, policy, violations }`.
- **`cart` is the authoritative `CartResponse`**, repriced from the live menu, identical in shape to `GET /api/v1/cart`. A client renders totals from this and never from `assistantText`.
- Errors: `400` bad/missing `text`, `language` or `phase`, or text over the input budget; `401` missing or expired session; `403` body outlet mismatch or a session bound to another outlet; `503` no conversational provider is configured, the provider failed before any reply, or the conversation session limit is reached.

**Conversation-to-cart integration** (`backend/src/workflows/conversationTurn.ts`). A turn reads the draft through the cart service, hands the model that price-free summary, and applies each validated `DraftAction` by calling the **ordinary cart service methods** - the same code path the cart routes use, so item, option, availability, quantity, line-count, and session/outlet checks are identical whether a change came from a tap or from speech. Consequences worth stating:

- **No model output reaches a database or an order.** The workflow is injected with the conversation service and the cart service only; no order service, quote service, quote store or cart store is in scope, so there is no path from a tool call to order creation, quote acceptance or payment state. Confirmation stays `POST /api/v1/orders` with a literal `customerConfirmed: true`.
- **A proposal names a selection, never a line ID.** The model never sees `lineId`. `updateQuantity` and `removeItem` are matched against the draft by item and, when the proposal named options, by option set. No match is reported `applied: false, reason: "not_in_draft"`; more than one match is `"ambiguous_draft_line"` - refused rather than guessed, because the matching lines differ by options the customer did not name.
- **A refusal does not lose the turn.** A cart-service refusal (`400`/`409`/`422`) becomes `applied: false, reason: "rejected_by_cart"` with the client-safe message; the customer still gets `assistantText` and the real cart. A `5xx` from a store is **not** absorbed and surfaces as the request's own error.
- **No `If-Match`.** A voice turn means "apply to the draft as it is now", the same as a cart mutation without the header. Actions are applied in order, each against the cart the previous one returned.
- **Cart and total questions** are answered from `cart` in the response. The prompt additionally instructs the model to answer "what did I order" from the draft summary only and never to state an amount; as with every prompt rule, the control is that the summary contains no money at all.
- **Contextual references** ("add two of those") are supported by giving the model a referent, not by parsing pronouns per language: the conversation service remembers the last item it resolved against backend menu data for that session - from a suggestion, an applied proposal, or a single-result lookup - and the prompt names it with its ID. The model turns the deixis into that ID, which is then resolved and validated exactly like any other reference. A referent survives turns that resolve nothing, and is never set from model text or from a failed turn.
- **Provider failure preserves ordering.** `providerStatus.state: "failed"` with `fallback: "touch"` leaves the draft untouched and the cart endpoints fully functional. With no provider key configured at all the route answers `503` and every touch path still works.

Customers can request recommendations whenever they ask. Proactive recommendations are limited to one per session, never during review, confirmation, or payment, and stop after a decline for the rest of the session. This policy is enforced by application state, not by relying on the prompt alone.

**As implemented:** the allowance is computed from per-session state and enforced by dropping proactive entries from the structured `suggestions` result; the prompt is told the same rule but is not the control. The allowance is consumed only when a proactive suggestion actually resolves to an available item. A suppressed turn sets `policy.proactiveSuppressed` and adds a violation. Known limitation: a model that ignores the instruction and buries a suggestion in free-text `assistantText` cannot be removed by the structured check, so this needs evaluation with real utterances. Provider failure, insufficient credits, or unavailable network must preserve the draft and allow order completion by touch.

## Sarvam chat provider facts (verified against official documentation; implementation still pending)

- Model: `sarvam-105b-conversations` (Sarvam 105B Conversations), text-in/text-out, 32K context.
- Endpoint: `POST https://api.sarvam.ai/v1/chat/completions`. This model uses V1; do not substitute `/v2` based on OpenAI-compatible examples for other models.
- Authentication: `api-subscription-key: <key>`; official docs also accept `Authorization: Bearer <key>` for compatible clients. Prefer the subscription-key header.
- Request uses OpenAI-compatible chat `messages` and `model`; `stream` supports server-sent events. Tool calling with `tools`/`tool_choice` and structured output with `response_format` / JSON Schema are documented for V1. Even strict structured output must be parsed and backend-validated.
- Non-stream response usage documents `prompt_tokens`, `completion_tokens`, and `total_tokens`; streamed responses can include a final usage chunk. Do not assume the API exposes account credit balance or a particular cached-token usage field in this response.
- Sarvam documents 11-language coverage for its model family, including Kannada, Hindi, and English, and native-script, romanized, and code-mixed text. This is not a quality guarantee for restaurant/menu language or Hinglish; test with representative utterances.
- Current published rates are ₹15 per 1M input, ₹5 per 1M eligible cached input, and ₹60 per 1M output tokens, excluding GST. Reasoning tokens, where applicable, are billed at output rates. Recheck official pricing before budgeting or launch.
- Sarvam says each verified user receives ₹100 free signup credits; this is an advertised policy, not confirmation that Ayush's dashboard has a balance. Check the dashboard before any authorized test. Exhausted credits produce HTTP 402 and retries do not clear the condition.

The adapter implementing these facts exists (`backend/src/providers/sarvam`); the conversational service above does not. A default request carries `model` and `messages` only, and the internal `usage` fields map from `prompt_tokens` / `completion_tokens` / `total_tokens`. Full source notes, links, verified-versus-unverified split, implemented environment variables, error mapping, and setup steps: [PROVIDERS.md](PROVIDERS.md).

## Speech adapter boundary (provider contract unverified)

Voice input must produce a draft intent/transcript result, never an order or payment transition. Any internal endpoint must enforce session scope, request limits, consent, and redacted logging. Confirm Gnani Prisma/Timbre official request/response schemas, language codes, audio formats, streaming behavior, limits, latency, retention, and error semantics before specifying a wire contract. Keep those payloads out of this provisional public API. Speech provider choice remains independent of the conversational LLM choice.

## Contract tests

For each endpoint test valid and invalid schemas, authorization and cross-session/outlet access, unavailable/stale menu, duplicate requests, server-calculated totals, state transition rules, persistence/provider failures, and safe errors. Payment callback tests are required before any provider integration.
