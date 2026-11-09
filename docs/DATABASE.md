# Database

**Engine:** MongoDB (confirmed). **Hosting/ODM:** undecided. Schemas below are provisional domain designs, not implemented schema declarations.

## 1. Naming and common fields

Use collection names consistently (suggested plural camelCase); document fields use camelCase. Use MongoDB ObjectId internally. Public IDs/tokens must be unguessable or outlet-scoped and must not expose sequential database IDs. Store timestamps as UTC dates (`createdAt`, `updatedAt`). Store money as integer minor units (paise) plus currency `INR`; never use floating-point arithmetic.

## 2. Provisional collections

### `outlets`
Purpose: outlet identity and ordering configuration. Suggested fields: `_id`, `name`, `slug`, `timezone`, `currency`, `active`, `createdAt`, `updatedAt`. Keep secrets and provider credentials outside public outlet documents.

### `menuCategories` (as implemented)

**NEEDS JOINT AGREEMENT:** not previously described here. Purpose: grouping for menu browsing. Fields: `publicId`, `outletId`, `name`, `sortOrder`, `active`, `updatedAt`. Kept as its own collection rather than embedded in items so a rename or reorder does not rewrite every item.

### `menuItems`
Purpose: independently editable item availability and options. Fields: `_id`, `outletId`, `name` (localized map or supported names to be decided), `description`, `priceMinor`, `currency`, `active`, `options[]` (option ID, label, price delta, active), `sortOrder`, `updatedAt`. Exact localization and option model remain open.

**As implemented:** the public identifier is a separate `publicId` string field rather than the `_id`, so no internal database ID is ever exposed (section 1). Options are embedded as `{ publicId, label, priceDeltaMinor, active }` - a flat, optional, multi-select list with no required groups and no mutually exclusive sets, because the customisation model is an open decision. `active` is the merchant availability switch; an inactive item is still served to clients as `available: false`.

**As implemented - localization (previously open).** Every customer-visible string keeps its plain English field and gains an optional `translations` overlay: `translations: { kn?: { name?, description? }, hi?: { name?, description? } }` on an item, `{ kn?: { label? }, hi?: { label? } }` on each embedded option, and `{ kn?: { name? }, hi?: { name? } }` on a `menuCategories` or `outlets` document. The decisions behind that shape:

- **English is canonical, not a translation entry.** `en` is deliberately not a key: the base field *is* the English value, so there is no second place an English name can live and no way for the two to disagree. Resolution falls back per field to the base ([API.md](API.md) menu section), which is why every key is optional - partial translation is the normal state of a merchant's menu.
- **Embedded, not its own collection.** A translation is read on every menu read and edited with the item it belongs to, so a separate collection would add a query and a join for data that has no life of its own. A rename of a *category* still does not rewrite items, because `menuCategories` keeps its own document.
- **No index covers it.** Nothing queries by translated text: the public menu and the conversational menu lookup both resolve translations in application code after the existing outlet-scoped read. Translated search therefore scans the outlet's items, which is the same work the existing English search already did.
- **Nothing about a translation is a price or an availability fact**, so `menuVersion` excludes it and a text-only edit cannot invalidate an in-flight quote ([API.md](API.md) menu section).
- All fields are optional, so existing documents and the development seed need no migration; the seed carries deliberately partial Kannada and Hindi text so fallback is exercised rather than assumed.

### `orderingSessions`
Purpose: isolate anonymous kiosk/QR customer drafts. Fields: `_id` or opaque session ID, `outletId`, `channel` (`qr` | `kiosk`), `createdAt`, `expiresAt`, `status`. Do not store raw audio.

**As implemented.** The session record **is** persisted, so a restart or a second backend instance no longer ends an open session - the draft a session owns would otherwise be unreachable, which is the same failure persisting drafts was meant to remove.

- **No bearer token is stored.** `_id` is the SHA-256 hex of the session ID; the raw ID is never written, so a dump of this collection cannot be replayed as a session ([SECURITY.md](SECURITY.md) section 1). The hash is also the uniqueness constraint, so no unique index is declared. `sessionRef` (its 12-character prefix) is stored because it is the only session identifier safe to log.
- Fields: `_id` (hash), `sessionRef`, `outletId`, `channel`, `createdAt`, `expiresAt` (absolute deadline), `lastSeenAt`, `idleExpiresAt`. No audio, transcript or personal data.
- **Both deadlines are enforced in the query filter**, never by a sweep: `expiresAt` carries a TTL index for cleanup only, and a document MongoDB has not yet collected is still refused. The published contract is unchanged - `expiresAt` in the create response remains the absolute deadline ([API.md](API.md)).
- The lookup is **one conditional write**: `findOneAndUpdate` checks both deadlines and slides `idleExpiresAt` in a single operation, with the new idle deadline clamped to the document's own `expiresAt` by an aggregation-pipeline update. Two concurrent requests therefore cannot interleave a read and a write and revive an expired session.
- The bound on live sessions is counted with the same live filter and **refuses** rather than evicts, so a customer mid-order is never dropped to make room. An unreachable database is a retryable `503`, and no session ID is issued unless the insert succeeded.

### `cartDrafts` (as implemented)

Purpose: the per-session draft cart that is now the primary customer ordering interface ([API.md](API.md) cart section). Persisted in MongoDB, so a backend restart or a second backend instance does not empty a customer's draft mid-order.

**As implemented:** `_id` is the SHA-256 hex of the owning session ID - one draft per session, enforced by the primary key rather than by a unique index, and again storing no bearer token. Other fields: `cartId`, `outletId`, `revision`, `lines[]` (`lineId`, `menuItemId`, `optionIds[]`, `quantity`, `nameSnapshot`), `updatedAt`, `expiresAt`. A write is a conditional update matching `{ _id, outletId, revision: <the revision read>, expiresAt: { $gt: now } }`; the first write of a draft is an upsert whose filter still demands that nothing usable is stored, so a losing racer gets a duplicate-key error reported as a revision conflict rather than overwriting an accepted edit. A conflict on a mutation that carried no `If-Match` is retried against the fresh draft (at most three attempts), because such a caller asked to apply to whatever is there; a stale `If-Match` is still `409`.

The requirements this satisfies:

- **Selections only.** A stored line holds item ID, option IDs and quantity - never a price, total or client-supplied amount. Every amount in a cart response is recomputed from the current menu on read, which is what keeps a stored price from going stale and a client value from becoming a stored one (section 1, [SECURITY.md](SECURITY.md) section 2). The one denormalized field is an add-time item-name snapshot, used solely to label a line whose item has left the menu, never for pricing.
- **Session expiry stays authoritative.** **As implemented:** every write sets `expiresAt` to `min(now + 30 minutes, session.expiresAt)`, so a draft written late in a session's life cannot outlive it, and expiry is still checked on read. The session's absolute deadline travels with the authenticated scope and no request body can widen it. A draft is usable exactly as long as its ordering session is: the session's deadlines ([API.md](API.md) ordering-session section) decide, and the draft's own retention never extends them. A draft outliving its session must not be readable, so expiry is enforced on read rather than left to a background sweep, and a TTL index is cleanup only.
- **Isolation in the query, not after it.** Every read and write is filtered by both session and outlet, so no document can be returned under another session or another outlet ([SECURITY.md](SECURITY.md) section 1). A line ID from another draft must be indistinguishable from an unknown one.
- **Concurrency safety without a single process.** The integer `revision` is the concurrency token: a mutation applies as a conditional write matching the expected revision and increments it, so two surfaces (voice and touch) editing one draft cannot lose an update and a stale `If-Match` is refused with `409` ([API.md](API.md)). The current in-process lock is not sufficient once more than one backend instance runs.
- One draft per ordering session; at most 30 lines and quantity 1-20 per line, as the API already enforces.
- **As implemented - order creation.** A successful order deletes the draft and **keeps the session**: a session may create more than one order ("zero or more confirmed orders", section 3), so the next cart read returns a fresh empty draft at revision `0`. The deletion lives in the application-level workflow `workflows/confirmOrder.ts`, for the same reason the end-of-session cleanup does: the order service must not know what a cart is, and the cart store must not know that an order exists. The order is created first because it is the commercial record, and a draft that cannot be deleted never fails the request - it is already unreadable and expires on its own deadline.
- Retention: a draft is customer order-building data, not a commercial record. **As implemented:** ending a session deletes its draft through the application-level workflow `workflows/endOrderingSession.ts`, not through either service - the session service does not know what a cart is and the cart store does not know when a capability is revoked. The draft is deleted *first*, because the draft key is a hash of the session ID and nothing can name it once the session record is gone; both deletes are idempotent and retried (three attempts). If the draft still cannot be deleted the session is ended anyway and the result says so: the capability is what the customer asked to revoke, and the orphan is already unreadable and expires on its own deadline. A session that cannot be ended is rethrown as a retryable `503`. **As implemented:** `DELETE /api/v1/ordering-sessions` ([API.md](API.md)) is the route that reaches this workflow, so a customer ending their session - or a client doing it defensively on close - clears the draft and revokes the capability in one call. It is also deleted on expiry or when the session ends, and no draft is retained after order creation - the order's own item snapshot is the record (`orders` above). No audio, transcript or personal data is stored on a draft.
- An unreachable or full draft store is a retryable `503`; it must never be reported as a saved draft.

### `orders`
Purpose: confirmed immutable commercial snapshot and operational lifecycle. Fields: `_id`, `publicOrderId`, `outletId`, `sessionId` (or safe reference), `channel`, `token`, `items[]` snapshot (`menuItemId`, `nameAtOrder`, `quantity`, `options[]`, `unitPriceMinor`, `lineTotalMinor`), `subtotalMinor`, `totalMinor`, `currency`, `paymentMethod` (`upiQr` | `cashAtCounter`), `paymentStatus` (`pending` | `dueAtCounter` | `verified` | `failed` | `refunded` reserved for future), `orderStatus` (`accepted` | `preparing` | `ready` | `collected` | `cancelled`), `idempotencyKey`, `createdAt`, `updatedAt`, `statusHistory[]` (state, actor kind/id, timestamp).

**As implemented.**

- `_id` **is** the `publicOrderId` (a random UUID) rather than an ObjectId. The deviation is deliberate: the unguessable public ID exposes nothing sequential, needs one index fewer, and makes the customer read path a primary-key lookup. Both fields are present, so no client contract or later migration sees a difference.
- `sessionId` is stored as the **safe reference** this document allows, never raw: `sessionKeyHash` (SHA-256 of the session ID - the same hash drafts are keyed by, so an order and its draft correlate without either storing a bearer token) plus `sessionRef`, the 12-character prefix that is safe to log ([SECURITY.md](SECURITY.md) section 1).
- Added fields: `tokenDateKey` (outlet-local `YYYY-MM-DD`, the token's reset window), `accessTokenHash` (SHA-256 of the order-read capability; the capability itself is never stored), `requestFingerprint` (hash of `quoteId` + `paymentMethod`, needed to tell an idempotent replay from a reused key with a different payload), `quoteId` and `menuVersion` (what the customer confirmed, and the menu it was priced against).
- `items[]` carries `optionIds[]` rather than an `options[]` object array: an order's option snapshot needs the IDs that were priced, and labels come from the menu.
- **As implemented - `checkoutLanguage` and a second name snapshot.** The order stores `checkoutLanguage` (copied from the confirmed quote, never from the confirming request) and each item stores `displayNameAtOrder` beside `nameAtOrder`. `nameAtOrder` stays the canonical English operational record, so a kitchen ticket and a merchant report read the same whatever the customer ordered in; `displayNameAtOrder` is frozen at acceptance so a later menu or translation edit cannot rewrite what the customer was shown. Both fields are optional on the document: an order written before this milestone reads back as English, which is what it was displayed as.
- Order items are a price snapshot: amounts are recomputed at confirmation from the live menu and then frozen, so a later menu edit cannot rewrite an accepted order.
- No TTL index and no hard delete: an order is a commercial record, not session state. Retention policy remains **open**.

### `pickupTokenCounters` (as implemented)
Purpose: one sequential pickup-token counter per outlet per outlet-local day. **NEEDS JOINT AGREEMENT:** not previously described here. Fields: `_id` (`${outletId}:${dateKey}`), `outletId`, `dateKey`, `lastToken`, `updatedAt`.

- **The token reset policy, previously open in section 3, is now decided: daily, per outlet, in the outlet's own timezone.** A kitchen in `Asia/Kolkata` must not see tokens reset mid-service because UTC rolled over at 05:30 IST, so the outlet's `timezone` decides the day. Every seeded outlet therefore carries a timezone, and the seed script verifies it before writing; an outlet without a valid one cannot allocate a token and fails loudly rather than defaulting to a zone the merchant never chose.
- **Allocation is one `findOneAndUpdate` with `$inc` and `upsert`**, which MongoDB applies atomically to a single document, so two simultaneous orders get two different numbers without a lock and without depending on a single backend instance.
- Tokens are only ever incremented - **never wrapped** - so a number is never reused while the order holding it is still waiting. A number may be skipped when the following insert turns out to be an idempotent replay.
- Its own collection rather than a field on the outlet, so the hot increment on order creation never contends with menu reads.

### `staffUsers` (provisional)
Purpose: merchant access, only if authenticated staff accounts are in MVP. Fields and provider linkage depend on the still-undecided authentication approach; never invent a provider or store plaintext credentials.

## 3. Relationships and indexes

- One outlet has many menu items, sessions, and orders.
- One session can create zero or more confirmed orders; each order is bound to exactly one outlet/session.
- Order items retain snapshots so later menu edits do not rewrite accepted orders.
- Index menu items by `{ outletId, active, sortOrder }`.
- **As implemented** (`ensureMenuIndexes`): unique `{ publicId }` on `outlets`, unique `{ outletId, publicId }` on `menuCategories` and `menuItems`, plus listing indexes `{ outletId, active, sortOrder }` on both. Creation is idempotent, so the seed script and a later migration step can both call it. All of this is verified against a real `mongod`, including that the unique constraints actually reject a duplicate and that the outlet-scoped ones still allow the same `publicId` under a different outlet (`mongoMenuRepository.integration.test.ts`).
- **Listing order (as implemented).** Menu reads sort by `{ sortOrder, name, publicId }`. No collation is supplied, so MongoDB uses its default simple binary collation, which compares UTF-8 bytes and is therefore Unicode code-point order. `publicId` is included to make the sort total, so repeated reads and any later paging are stable.
  - The in-memory repository used in unit tests must reproduce this exactly, which is why it uses the shared `compareListingOrder` rather than `localeCompare`. The two previously disagreed: `localeCompare` orders `idli` before `Idli` while MongoDB orders `Idli` first, so unit tests were asserting an order production never produced.
  - **OPEN:** locale-aware ordering, so Kannada, Devanagari and Latin item names interleave the way a reader of that language expects, needs a collation locale per outlet (and a matching collation on the index for the sort to use it). That is a product decision tied to language support ([PRD.md](PRD.md)) and is not made. Until it is, ordering is deterministic but not linguistically sorted, and merchants express display order through `sortOrder`.
- Index orders by `{ outletId, orderStatus, createdAt }` for the dashboard.
- Unique index `{ outletId, token, tokenDateOrWindow }` for token scope, after reset policy is decided.
- Unique idempotency constraint scoped to `{ outletId, sessionId, idempotencyKey }` for order creation.
- **As implemented** (`ensureOrderIndexes`, idempotent): unique `order_idempotency` on `{ outletId, sessionKeyHash, idempotencyKey }` - the safe reference stands in for `sessionId`, and this index is what makes concurrent retries of one order safe rather than merely unlikely; unique `order_token_scope` on `{ outletId, tokenDateKey, token }` - the reset window is the decided daily outlet-local one, and the index is a second line of defence behind the already-atomic counter; and `order_queue` on `{ outletId, orderStatus, createdAt }` for the merchant dashboard read. Unlike the session and draft indexes these are **not cleanup**: a deployment without them loses the idempotency guarantee, so startup creates them before serving.
- Expiring sessions may use a TTL index only after draft retention requirements are decided.
- **As implemented** for `orderingSessions` and `cartDrafts`: the only declared index on each is a TTL index on `expiresAt` (`session_ttl`, `cart_draft_ttl`, both `expireAfterSeconds: 0`), created idempotently at startup. Nothing else is needed, because the session hash is the `_id`: it indexes the only lookup key and enforces one session per token and one draft per session. Every query additionally carries `outletId`, so isolation is enforced in the filter, and both deadlines are checked in the filter too - the TTL is cleanup only and never the thing that decides whether a session or draft is usable. Verified against a real `mongod`, including that an expired document is refused while it is still present (`mongoOrderingSessionService.integration.test.ts`, `mongoCartStore.integration.test.ts`).

## 4. Validation, deletion, auditing

Validate every field at the API boundary and enforce domain invariants in services. Quantity must be a bounded positive integer. Item and option IDs must belong to the same active outlet; option combinations must be allowed; server computes all prices. A draft line is validated against the current menu on every mutation and repriced on every read, so a draft never carries a price of its own; a line whose item or option has since gone away is reported with zero amounts and an issue code rather than priced from anything stored ([API.md](API.md) cart section). Use atomic writes/transactions as supported by the chosen MongoDB deployment; do not assume transaction availability. Orders should not be hard-deleted during normal operation. Cancellation is a status transition with actor and reason; retention/deletion policy remains open. Record meaningful order/payment/status actions without storing sensitive audio or payment credentials.

## 5. Sensitive data and migrations

Avoid collecting customer identity or contact data in the MVP unless necessary. Never store card/UPI credentials. Provider secrets stay in server-side secret storage. Audio retention is off by default pending provider/privacy review. Schema changes require documented migration/compatibility steps, backup plan, and tests on representative data. Development seed data must be synthetic and clearly separated from real outlet/customer data.

**As implemented:** `npm run seed --workspace backend` upserts an obviously synthetic sample menu (`Demo Tiffin Centre`) keyed by `{ outletId, publicId }`, so re-running it is safe. It refuses to run when `NODE_ENV=production`.
