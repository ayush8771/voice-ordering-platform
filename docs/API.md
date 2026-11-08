# API Contract (Provisional)

**Editorial API starter adapted to this product.** The routes, field names, auth mechanism, and schemas below are proposed contracts for team review, not evidence of existing implementation or verified provider APIs. Base path, framework, versioning, and authentication provider are undecided. Use HTTPS in deployment. JSON responses; server is authoritative.

## Conventions

- Suggested base path: `/api/v1`; confirm against repository conventions before implementation.
- Money: integer minor units with `currency: "INR"`.
- Errors: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "...", "details": [] } }`; avoid internal details.
- Client sends IDs/options/quantities, never trusted prices or payment state.
- Ordering requests are outlet/session scoped. Staff endpoints require authenticated, outlet-authorized staff; exact mechanism undecided.
- Use bounded pagination for dashboard lists. Exact rate limits are deployment decision.
- Retryable order creation uses `Idempotency-Key` header; same key and same payload returns original result, same key with different payload returns conflict.

## `GET /api/v1/outlets/{outletId}/menu`

Public active menu for one outlet. Response `200`: `{ outlet: { id, name, currency }, menuVersion, items: [{ id, name, description?, priceMinor, currency, available, options: [{ id, label, priceDeltaMinor }] }] }`. Do not expose private configuration. Errors: `404` unknown/inactive outlet, `429` rate limited.

## `POST /api/v1/ordering-sessions`

Create an anonymous customer session. Request: `{ outletId, channel: "qr" | "kiosk" }`. Response `201`: `{ sessionId, expiresAt }`; session identifier is an unguessable bearer capability and must not be logged. Errors: `400` invalid input, `404` outlet unavailable, `429` rate limited. Session lifetime and token transport (cookie/header) must be decided and documented before implementation.

## `POST /api/v1/quotes`

Validate a draft against current menu and calculate a quote. Requires scoped session. Request: `{ outletId, items: [{ menuItemId, quantity, optionIds: [] }] }`. Response `200`: `{ quoteId, menuVersion, items: [{ menuItemId, name, quantity, optionIds, unitPriceMinor, lineTotalMinor }], subtotalMinor, totalMinor, currency, expiresAt }`. Errors: `400` invalid schema, `401/403` missing/invalid or wrong-scope session, `409` unavailable item/changed menu, `422` invalid option/quantity.

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

## Speech adapter boundary (provider contract unverified)

Voice input must produce a draft intent/transcript result, never an order or payment transition. Any internal endpoint must enforce session scope, request limits, consent, and redacted logging. Confirm Gnani Prisma/Timbre official request/response schemas, language codes, audio formats, streaming behavior, limits, latency, retention, and error semantics before specifying a wire contract. Keep those payloads out of this provisional public API.

## Contract tests

For each endpoint test valid and invalid schemas, authorization and cross-session/outlet access, unavailable/stale menu, duplicate requests, server-calculated totals, state transition rules, persistence/provider failures, and safe errors. Payment callback tests are required before any provider integration.
