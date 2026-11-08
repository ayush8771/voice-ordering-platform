# Database

**Engine:** MongoDB (confirmed). **Hosting/ODM:** undecided. Schemas below are provisional domain designs, not implemented schema declarations.

## 1. Naming and common fields

Use collection names consistently (suggested plural camelCase); document fields use camelCase. Use MongoDB ObjectId internally. Public IDs/tokens must be unguessable or outlet-scoped and must not expose sequential database IDs. Store timestamps as UTC dates (`createdAt`, `updatedAt`). Store money as integer minor units (paise) plus currency `INR`; never use floating-point arithmetic.

## 2. Provisional collections

### `outlets`
Purpose: outlet identity and ordering configuration. Suggested fields: `_id`, `name`, `slug`, `timezone`, `currency`, `active`, `createdAt`, `updatedAt`. Keep secrets and provider credentials outside public outlet documents.

### `menuItems`
Purpose: independently editable item availability and options. Fields: `_id`, `outletId`, `name` (localized map or supported names to be decided), `description`, `priceMinor`, `currency`, `active`, `options[]` (option ID, label, price delta, active), `sortOrder`, `updatedAt`. Exact localization and option model remain open.

### `orderingSessions`
Purpose: isolate anonymous kiosk/QR customer drafts. Fields: `_id` or opaque session ID, `outletId`, `channel` (`qr` | `kiosk`), `createdAt`, `expiresAt`, `status`. Do not store raw audio. Whether sessions need persistent server-side drafts is undecided; if persisted, TTL and consent/retention must be explicit.

### `orders`
Purpose: confirmed immutable commercial snapshot and operational lifecycle. Fields: `_id`, `publicOrderId`, `outletId`, `sessionId` (or safe reference), `channel`, `token`, `items[]` snapshot (`menuItemId`, `nameAtOrder`, `quantity`, `options[]`, `unitPriceMinor`, `lineTotalMinor`), `subtotalMinor`, `totalMinor`, `currency`, `paymentMethod` (`upiQr` | `cashAtCounter`), `paymentStatus` (`pending` | `dueAtCounter` | `verified` | `failed` | `refunded` reserved for future), `orderStatus` (`accepted` | `preparing` | `ready` | `collected` | `cancelled`), `idempotencyKey`, `createdAt`, `updatedAt`, `statusHistory[]` (state, actor kind/id, timestamp).

### `staffUsers` (provisional)
Purpose: merchant access, only if authenticated staff accounts are in MVP. Fields and provider linkage depend on the still-undecided authentication approach; never invent a provider or store plaintext credentials.

## 3. Relationships and indexes

- One outlet has many menu items, sessions, and orders.
- One session can create zero or more confirmed orders; each order is bound to exactly one outlet/session.
- Order items retain snapshots so later menu edits do not rewrite accepted orders.
- Index menu items by `{ outletId, active, sortOrder }`.
- Index orders by `{ outletId, orderStatus, createdAt }` for the dashboard.
- Unique index `{ outletId, token, tokenDateOrWindow }` for token scope, after reset policy is decided.
- Unique idempotency constraint scoped to `{ outletId, sessionId, idempotencyKey }` for order creation.
- Expiring sessions may use a TTL index only after draft retention requirements are decided.

## 4. Validation, deletion, auditing

Validate every field at the API boundary and enforce domain invariants in services. Quantity must be a bounded positive integer. Item and option IDs must belong to the same active outlet; option combinations must be allowed; server computes all prices. Use atomic writes/transactions as supported by the chosen MongoDB deployment; do not assume transaction availability. Orders should not be hard-deleted during normal operation. Cancellation is a status transition with actor and reason; retention/deletion policy remains open. Record meaningful order/payment/status actions without storing sensitive audio or payment credentials.

## 5. Sensitive data and migrations

Avoid collecting customer identity or contact data in the MVP unless necessary. Never store card/UPI credentials. Provider secrets stay in server-side secret storage. Audio retention is off by default pending provider/privacy review. Schema changes require documented migration/compatibility steps, backup plan, and tests on representative data. Development seed data must be synthetic and clearly separated from real outlet/customer data.
