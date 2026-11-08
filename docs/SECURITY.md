# Security Guidelines

**Status:** Baseline requirements; authentication, hosting, and payment provider are unresolved. This document does not imply a production security review.

## 1. Identity and authorization

Staff authentication provider and session mechanism are open decisions. Until chosen, do not invent an auth vendor or treat a hidden URL as staff authentication. Enforce merchant/staff authorization on every protected server action, scoped to the outlet. Customer sessions are anonymous, short-lived, outlet-scoped capabilities; use unpredictable identifiers, expire/revoke them, and prevent one session from reading or mutating another session's drafts/orders. Public QR codes identify an outlet, not a trusted staff role.

**As implemented** for customer sessions (full contract in [API.md](API.md)): a 256-bit CSPRNG bearer token carried only in `Authorization: Bearer`, expiring on a 10-minute sliding idle window or a 30-minute absolute cap, whichever is first; the token is never logged and logs carry a SHA-256 prefix instead; every scoped request is checked against the session's outlet. Still outstanding here: **rate limiting** on session creation and conversation requests, and an **explicit revocation** route (the session service supports ending a session, but nothing exposes it, so "end my order" cannot yet revoke the capability early). Session persistence is undecided, so sessions live in memory and a restart ends them.

## 2. Order, voice, and payment trust boundaries

- The backend is authoritative for menu availability, option validity, prices, totals, order status, and payment status.
- Require explicit customer confirmation of a fresh server-calculated order summary before creating the order.
- Treat transcripts, LLM output, structured output, and tool arguments as untrusted input. The LLM may propose draft updates only through a strict internal contract; require backend validation and customer review/confirmation.
- Keep Sarvam credentials server-side. Tool names and schemas are allowlisted in the server; the backend authorizes and validates every invocation and response before calling domain services. Never expose order creation, payment verification, or final confirmation as model-controlled actions.
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

Set explicit retention/deletion for sessions, orders, audit records, and provider diagnostics before deployment. Use least-privilege database/service credentials, backups with access controls, dependency review, and a documented incident/credential rotation path.

- [ ] Server-side menu, price, status, session, and role validation
- [ ] Separate customer sessions and outlet authorization tests
- [ ] Explicit order confirmation and idempotent creation
- [ ] Payment callback verification or authorized staff confirmation; no client/spoken proof
- [ ] Secrets server-side; error/log redaction
- [ ] Audio consent, retention, provider handling, and deletion defined
- [ ] Rate limits, bounded input, CORS/HTTPS configured for deployment
- [ ] Dependency and deployment configuration reviewed
