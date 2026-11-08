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

**As implemented:** the public identifier is a separate `publicId` string field rather than the `_id`, so no internal database ID is ever exposed (section 1). `name` is a single string: localization per item is still open and was not invented. Options are embedded as `{ publicId, label, priceDeltaMinor, active }` - a flat, optional, multi-select list with no required groups and no mutually exclusive sets, because the customisation model is an open decision. `active` is the merchant availability switch; an inactive item is still served to clients as `available: false`.

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
- **As implemented** (`ensureMenuIndexes`): unique `{ publicId }` on `outlets`, unique `{ outletId, publicId }` on `menuCategories` and `menuItems`, plus listing indexes `{ outletId, active, sortOrder }` on both. Creation is idempotent, so the seed script and a later migration step can both call it. All of this is verified against a real `mongod`, including that the unique constraints actually reject a duplicate and that the outlet-scoped ones still allow the same `publicId` under a different outlet (`mongoMenuRepository.integration.test.ts`).
- **Listing order (as implemented).** Menu reads sort by `{ sortOrder, name, publicId }`. No collation is supplied, so MongoDB uses its default simple binary collation, which compares UTF-8 bytes and is therefore Unicode code-point order. `publicId` is included to make the sort total, so repeated reads and any later paging are stable.
  - The in-memory repository used in unit tests must reproduce this exactly, which is why it uses the shared `compareListingOrder` rather than `localeCompare`. The two previously disagreed: `localeCompare` orders `idli` before `Idli` while MongoDB orders `Idli` first, so unit tests were asserting an order production never produced.
  - **OPEN:** locale-aware ordering, so Kannada, Devanagari and Latin item names interleave the way a reader of that language expects, needs a collation locale per outlet (and a matching collation on the index for the sort to use it). That is a product decision tied to language support ([PRD.md](PRD.md)) and is not made. Until it is, ordering is deterministic but not linguistically sorted, and merchants express display order through `sortOrder`.
- Index orders by `{ outletId, orderStatus, createdAt }` for the dashboard.
- Unique index `{ outletId, token, tokenDateOrWindow }` for token scope, after reset policy is decided.
- Unique idempotency constraint scoped to `{ outletId, sessionId, idempotencyKey }` for order creation.
- Expiring sessions may use a TTL index only after draft retention requirements are decided.

## 4. Validation, deletion, auditing

Validate every field at the API boundary and enforce domain invariants in services. Quantity must be a bounded positive integer. Item and option IDs must belong to the same active outlet; option combinations must be allowed; server computes all prices. Use atomic writes/transactions as supported by the chosen MongoDB deployment; do not assume transaction availability. Orders should not be hard-deleted during normal operation. Cancellation is a status transition with actor and reason; retention/deletion policy remains open. Record meaningful order/payment/status actions without storing sensitive audio or payment credentials.

## 5. Sensitive data and migrations

Avoid collecting customer identity or contact data in the MVP unless necessary. Never store card/UPI credentials. Provider secrets stay in server-side secret storage. Audio retention is off by default pending provider/privacy review. Schema changes require documented migration/compatibility steps, backup plan, and tests on representative data. Development seed data must be synthetic and clearly separated from real outlet/customer data.

**As implemented:** `npm run seed --workspace backend` upserts an obviously synthetic sample menu (`Demo Tiffin Centre`) keyed by `{ outletId, publicId }`, so re-running it is safe. It refuses to run when `NODE_ENV=production`.
