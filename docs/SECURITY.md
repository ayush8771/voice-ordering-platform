# Security Guidelines

**Status:** Baseline requirements; authentication, hosting, and payment provider are unresolved. This document does not imply a production security review.

## 1. Identity and authorization

Staff authentication provider and session mechanism are open decisions. Until chosen, do not invent an auth vendor or treat a hidden URL as staff authentication. Enforce merchant/staff authorization on every protected server action, scoped to the outlet. Customer sessions are anonymous, short-lived, outlet-scoped capabilities; use unpredictable identifiers, expire/revoke them, and prevent one session from reading or mutating another session's drafts/orders. Public QR codes identify an outlet, not a trusted staff role.

**As implemented** for customer sessions (full contract in [API.md](API.md)): a 256-bit CSPRNG bearer token carried only in `Authorization: Bearer`, expiring on a 10-minute sliding idle window or a 30-minute absolute cap, whichever is first; the token is never logged and logs carry a SHA-256 prefix instead; every scoped request is checked against the session's outlet. Still outstanding here: **rate limiting** on session creation and conversation requests. **As implemented:** explicit revocation is `DELETE /api/v1/ordering-sessions` ([API.md](API.md)), which ends the session and clears its draft through `workflows/endOrderingSession.ts`; it answers `204` whether or not the session was still live, so it cannot be used to probe for a valid token. Sessions are persisted in MongoDB and survive a restart; the stored document holds the SHA-256 hash of the token, never the token itself, so the collection cannot be replayed as a session ([DATABASE.md](DATABASE.md) section 2). Draft carts are keyed by the same hash and are likewise token-free.

**Draft carts.** There is exactly one draft per ordering session, and the session capability is the only way to read or change it. Every draft read and write is filtered by session **and** outlet, so a draft cannot be reached under another session or another outlet, and a line identifier belonging to another draft is reported as not found rather than forbidden, so identifiers cannot be probed. A draft holds selections only - no price, total or payment state - and never records that a customer confirmed anything.

**AGREED - when drafts move to MongoDB before pilot deployment** ([DATABASE.md](DATABASE.md) section 2), these properties are requirements on the persisted store, not consequences of it being in one process:

- the **ordering session's expiry stays authoritative** for how long a draft is usable, and expiry is enforced on read, so a surviving document can never outlive the capability that may read it; a TTL index is cleanup only;
- session and outlet scope are part of the query filter, so isolation does not depend on application code remembering to check after the fact;
- the integer `revision` becomes a conditional write, because the current in-process lock stops guaranteeing concurrency safety once more than one backend instance runs: a stale edit must be refused, never silently applied;
- a draft is customer order-building data, deleted on expiry or when the session ends and not retained after order creation, and carries no audio, transcript or personal data.

**As implemented - the order-read capability.** An ordering session is deliberately short-lived (30 minutes absolute, 10 idle), but a customer may still be waiting for food when it dies. Rather than extend the session - which would also extend every ordering capability it carries - order creation issues a **separate, narrower capability** that only reads one order: 256 bits from the CSPRNG, returned exactly once in the creation response, stored only as its SHA-256 hash, and never logged or placed in a URL. `GET /api/v1/orders/{orderId}` requires it instead of a session. A wrong capability, a session token used in its place, and an unknown order ID are all reported as `404`, so neither an order's existence nor the ID format can be probed, and an order cannot be enumerated from a session.

## 2. Order, voice, and payment trust boundaries

- The backend is authoritative for menu availability, option validity, prices, totals, order status, and payment status.
- Require explicit customer confirmation of a fresh server-calculated order summary before creating the order.
- A draft cart is never authoritative and never a confirmation: it is repriced from the current menu on every read, and a line the menu no longer supports is returned with zero amounts and an issue reason. A client is required to flag those lines and block checkout ([UX_FLOWS.md](UX_FLOWS.md) flow 2), but that is a usability obligation, not the control: the server refuses the same selection at quote and order creation regardless of what any client does.
- Treat transcripts, LLM output, structured output, and tool arguments as untrusted input. The LLM may propose draft updates only through a strict internal contract; require backend validation and customer review/confirmation.
- Keep Sarvam credentials server-side. Tool names and schemas are allowlisted in the server; the backend authorizes and validates every invocation and response before calling domain services. Never expose order creation, payment verification, or final confirmation as model-controlled actions.

**As implemented - the model's only route to the draft.** A validated draft
action reaches the cart exclusively through `workflows/conversationTurn.ts`,
which calls the ordinary cart service methods. The workflow is injected with the
conversation service and the cart service and nothing else, so no store, quote
service, order service or payment path is in scope for anything a model emits:
"never expose order creation" is enforced by what the code can reach, not only
by the tool allowlist. A spoken change is validated by the same code as a tapped
one (item, option, availability, quantity, bounds, session and outlet), the
model is never given a `lineId` and names a selection instead, and a proposal
matching more than one draft line is refused rather than guessed. Order creation
still requires a literal `customerConfirmed: true` on `POST /api/v1/orders`; no
transcript, model reply or applied draft action substitutes for it.
- Apply request/token/output budgets and handle exhausted-credit responses as provider unavailability. Do not assume automatic billing or top-ups; preserve the touch path and do not retry non-retryable quota exhaustion.
- Never trust spoken or typed “paid,” a screenshot, client flag, redirect, or QR display as payment proof.
- Payment changes to verified only after an authenticated provider callback with signature/replay validation and amount/order matching, or an authorized staff confirmation. No provider is selected yet; implement no production payment claim until a verified contract exists.
- Apply idempotency to order creation and payment events; handle replayed callbacks safely.

## 3. Secrets and configuration

Keep Sarvam and Gnani credentials, database credentials, signing keys, and future payment secrets on the server in environment-specific secret storage. Never commit secrets, expose them in client bundles, prompts, logs, error messages, or screenshots. Use placeholder names in `.env.example`; keep real env files ignored. Rotate compromised credentials. Do not put provider credentials in QR codes.

## 4. API and application protection

Validate types, lengths, enum values, quantities, IDs, and outlet/session ownership server-side. Use allowlisted CORS origins, HTTPS in deployment, secure cookie settings if cookies are selected, CSRF defenses where cookie auth requires them, and rate limits for session creation, conversation/voice requests, confirmation, and callbacks. Bound provider token and output budgets. Use generic external errors with a request/correlation ID; retain safe diagnostic detail server-side. Prevent injection by using safe database query construction and bounded request bodies. Avoid storing audio/transcripts unless required and explicitly approved by a documented retention policy.

## 5. Privacy, audio, logs

Show microphone purpose and request permission only on user action. Recording must have visible active state and a stop/cancel action. Define whether audio is sent to the speech provider, provider retention, user notice/consent, and deletion before enabling real traffic. Prefer transient processing and do not persist raw audio by default. Logs must exclude secrets, raw audio, full transcripts, payment credentials, session tokens, and unnecessary personal data. Log security-relevant events, order/payment state changes, and provider failures using redacted identifiers and access controls.

## 6. Data lifecycle and security checklist

Set explicit retention/deletion for sessions, draft carts, orders, audit records, and provider diagnostics before deployment. Use least-privilege database/service credentials, backups with access controls, dependency review, and a documented incident/credential rotation path.

- [ ] Server-side menu, price, status, session, and role validation
- [ ] Separate customer sessions and outlet authorization tests
- [ ] Draft-cart isolation, session-bound expiry and concurrency safety preserved after the move to MongoDB
- [ ] Explicit order confirmation and idempotent creation
- [ ] Payment callback verification or authorized staff confirmation; no client/spoken proof
- [ ] Secrets server-side; error/log redaction
- [ ] Audio consent, retention, provider handling, and deletion defined
- [ ] Rate limits, bounded input, CORS/HTTPS configured for deployment
- [ ] Dependency and deployment configuration reviewed
