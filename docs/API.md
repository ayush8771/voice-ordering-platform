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
- Sessions are in memory: a restart ends open sessions. Safe, because no order exists until confirmation. Persistence is still an open decision ([DATABASE.md](DATABASE.md) section 2).
- `404` is returned for an unknown **or inactive** outlet, and for an `outletId` that does not match `[A-Za-z0-9_-]{1,64}` - the same bound the menu route applies, so a malformed ID is rejected before it reaches a query and existence is still not disclosed. `503` when the session store is full.
- An expired session and an unknown token return an identical `401` body, so a caller cannot tell a timed-out session from a wrong guess.
- Rate limiting on session creation is **not implemented** ([SECURITY.md](SECURITY.md) section 4 requires it before deployment). There is also no revocation endpoint yet: the service supports ending a session but no route exposes it.

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

## `POST /api/v1/orders`

Explicitly confirm and create an order. Requires session and `Idempotency-Key`. Request: `{ outletId, quoteId, paymentMethod: "upiQr" | "cashAtCounter", customerConfirmed: true }`. Server rechecks menu/quote, calculates total, persists order and unique outlet-scoped token atomically as supported by deployment. Response `201` (or `200` replay): `{ orderId, token, orderStatus: "accepted", paymentMethod, paymentStatus: "pending" | "dueAtCounter", totalMinor, currency, createdAt }`. Errors: `400` missing confirmation/schema, `401/403` session issue, `409` stale quote/idempotency conflict, `422` invalid/unavailable selection, `503` persistence unavailable. No payment is verified by this endpoint.

## `GET /api/v1/orders/{orderId}`

Return only the order visible to the scoped customer session or authorized outlet staff. Response: public order summary, token, item snapshot, order status, payment method/status, timestamps. Errors: `401/403` unauthorized or scope mismatch; consider `404` to avoid exposing existence.

## `GET /api/v1/merchant/orders`

Staff-only outlet-scoped queue. Query: `status` (optional), `limit` (bounded), `cursor` (opaque). Response: `{ items: [order summaries], nextCursor }`. Errors: `401` unauthenticated, `403` wrong outlet/role, `400` invalid query.

## `PATCH /api/v1/merchant/orders/{orderId}/status`

Staff-only state transition. Request: `{ status: "preparing" | "ready" | "collected" }`. Server validates transition and records actor/time. Response: updated order status and timestamp. Errors: `401/403`, `404`, `409` invalid transition, `422` invalid status.

## Payment verification (not implemented/selected)

No public client endpoint may set `paymentStatus=verified`. A future `POST /api/v1/payment/webhook/{provider}` must verify provider signature, replay/timestamp protections, order and outlet binding, amount/currency, and idempotency before changing status. A separate authorized staff action may record manual receipt with actor and audit note. Provider and exact payload/signature contract are open; do not implement a guessed callback.

## Shared conversational service contract (provisional, provider-neutral)

One backend conversational service is used by both QR and kiosk clients. Clients send user input to the application API; they never call Sarvam or another LLM directly. Keep this internal contract independent of any provider SDK or wire format.

Suggested normalized request: `{ sessionId, channel: "qr" | "kiosk", locale, text, phase, draftSummary, menuVersion }`. Suggested normalized result: `{ assistantText, draftActions: [{ type, menuItemId?, quantity?, optionIds? }], toolRequests: [], usage?: { inputTokens?, outputTokens?, totalTokens? }, providerStatus }`.

**As implemented** (`backend/src/services/conversation`, internal only - no HTTP route exists yet): the request adds `outletId` because every turn must be outlet-scoped, renames `locale` to `language` (the `Language` union already in shared contracts), and adds `customerDeclinedRecommendation` so the caller can report a decline. `draftSummary` carries item ID, name, quantity and option IDs but **no prices or totals**, so the model cannot restate money. The result adds `suggestions` (resolved menu items with `kind: "requested" | "proactive"`), `needsClarification`, `policy` (recommendation allowance state) and `violations` (what the service refused). `providerStatus` is `{ state: "ok" | "failed", providerId, model, code?, retryable?, fallback? }`; on failure `assistantText` is absent, `draftActions` is empty and `fallback` is `"touch"`. Do not include client prices as trusted data. Resolve menu items to IDs using backend menu data; validate each draft action and calculate all prices server-side.

Sarvam adapter configuration belongs on the server and is limited to provider base URL, secret key reference, model ID, timeouts, and bounded request/output budgets. Map normalized messages, tool calls, streaming chunks, usage, and provider errors to the shared service contract. Keep provider fields out of shared API payloads, domain models, and frontend code. Replacing the adapter must not change ordering/business logic.

Only server-defined tools may be offered to the model (for example, menu search/detail lookup and draft-cart proposal). The backend validates tool name, schema, session/outlet scope, current menu version, item availability, and quantities before execution. Never expose order creation, quote acceptance, payment verification, or state-transition tools. A model tool call is a proposal and cannot replace the customer's review and explicit confirmation.

**As implemented:** the allowlist is exactly `menu_search`, `menu_item_details` and `propose_draft_update`. The two lookups are read-only and executed by the service through the menu port, bounded by a configurable number of tool rounds per turn. `propose_draft_update` is never executed: it yields a draft action for customer review. An item reference from the model is resolved against backend menu data and is refused when it is unknown, unavailable or ambiguous, rather than guessed. Option IDs must exist on the resolved item or the whole proposal is dropped. Draft actions have no price field at all. A forbidden name such as `create_order` or `verify_payment` is rejected and recorded as a violation.

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
