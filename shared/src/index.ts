/**
 * Shared contracts between the backend API and the React clients.
 *
 * Scope rule (docs/ARCHITECTURE.md section 5): anything in this package is a
 * contract both owners depend on, so additions are reviewed by Ayush and Anvesh
 * before either side implements against them.
 *
 * Menu, ordering-session, quote, cart, order and conversational-turn shapes are
 * all here now. Payment-provider shapes are deliberately still absent: no
 * provider is selected.
 *
 * The multilingual content contract (en/kn/hi) is additive throughout: a
 * request that names no language is served exactly as before, every response
 * string is already resolved into one language, and the canonical English name
 * stays on every snapshot alongside the localized one.
 *
 * Three additions need Ayush/Anvesh sign-off because docs/API.md does not
 * describe them: menu categories, the `Authorization: Bearer <sessionId>`
 * session transport, and the 422-versus-409 split for invalid versus
 * unavailable selections. They are marked below.
 */

/** Stable error codes. Mirrors the envelope documented in docs/API.md. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Error envelope returned by every failing API response.
 * `message` is safe for display; internal detail stays server-side
 * (docs/SECURITY.md section 4).
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly unknown[];
  };
}

/**
 * Money is always integer minor units (paise) plus an ISO currency code.
 * Floating-point arithmetic on money is prohibited (docs/DATABASE.md section 1).
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: 'INR';
}

/** Ordering channel. Both channels share one backend (docs/PRD.md). */
export const CHANNELS = ['qr', 'kiosk'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Customer-selectable payment methods for the MVP. */
export const PAYMENT_METHODS = ['upiQr', 'cashAtCounter'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Payment state, tracked independently of kitchen state.
 * Only a verified provider callback or an authorized staff action may reach
 * 'verified' (docs/SECURITY.md section 2). No client may set it.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'dueAtCounter',
  'verified',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Kitchen/operational state, tracked independently of payment state. */
export const ORDER_STATUSES = [
  'accepted',
  'preparing',
  'ready',
  'collected',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Supported interface languages: the discrete set confirmed as available across
 * the Gnani products (docs/PRD.md).
 *
 * Code-switching within a single utterance (Hindi-English, Kannada-English) is a
 * capability to evaluate, not a confirmed feature, so it is deliberately NOT a
 * language identifier here. If testing shows it is supported, it is handled as
 * recognition behavior within one of these languages rather than a fourth value.
 */
export const LANGUAGES = ['en', 'kn', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * The language every endpoint falls back to, and the language a request that
 * names none is served in.
 *
 * `en` is also the *canonical* language: a stored menu string is English, and a
 * translation is an optional overlay on it. That is what keeps this addition
 * backward compatible - a client that never sends a language sees exactly what
 * it saw before.
 */
export const DEFAULT_LANGUAGE: Language = 'en';

/**
 * Translations for one piece of content, as an overlay on its English base.
 *
 * `en` is deliberately not a key: the base field *is* English, so there is no
 * second place an English string can live and no way for the two to disagree.
 * Every field is optional because partial translation is the normal state of a
 * merchant's menu, and resolution falls back per field (docs/API.md menu
 * section).
 */
export type Translations<Field extends string> = Partial<
  Record<Exclude<Language, 'en'>, Partial<Record<Field, string>>>
>;

export type MenuItemTranslations = Translations<'name' | 'description'>;
export type MenuOptionTranslations = Translations<'label'>;
export type MenuCategoryTranslations = Translations<'name'>;
export type OutletTranslations = Translations<'name'>;

/** Reported dependency reachability. 'unconfigured' is not a failure. */
export type DependencyState = 'ok' | 'unreachable' | 'unconfigured';

/**
 * Response of `GET /api/v1/health`. An infrastructure probe used to verify
 * client/server communication; it exposes no product or private data.
 */
export interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly apiVersion: string;
  readonly timestamp: string;
  readonly dependencies: {
    readonly mongodb: DependencyState;
  };
}

/** Base path for the versioned API (docs/API.md). */
export const API_BASE_PATH = '/api/v1';

// ---------------------------------------------------------------------------
// Menu contracts (`GET /api/v1/outlets/{outletId}/menu`)
//
// Every customer-facing string below is **already resolved** into one
// language: a client never receives a translation map and never resolves
// anything itself. The language is chosen with `?lang=` and echoed as
// `MenuResponse.language`; an untranslated field falls back to English, per
// field (docs/API.md menu section).
// ---------------------------------------------------------------------------

/**
 * One customisation a customer may add to an item.
 *
 * The implemented model is a flat, optional, multi-select list: no required
 * groups and no mutually exclusive sets. The full customisation model is an
 * open decision (docs/PRD.md section 9), so nothing richer is invented here.
 * A delta may be zero or negative, but never takes a line below zero.
 */
export interface MenuOption {
  readonly id: string;
  readonly label: string;
  readonly priceDeltaMinor: number;
}

/** A menu item exactly as the public menu exposes it. */
export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly priceMinor: number;
  readonly currency: 'INR';
  readonly available: boolean;
  /** NEEDS JOINT AGREEMENT: category grouping is not described in docs/API.md. */
  readonly categoryId?: string;
  readonly options: readonly MenuOption[];
}

/**
 * NEEDS JOINT AGREEMENT: categories are a product concept in docs/UX_FLOWS.md
 * flow 2 but absent from the docs/API.md menu response. Added additively - the
 * documented `items` array is unchanged - so a client may ignore it.
 */
export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

export interface MenuOutlet {
  readonly id: string;
  readonly name: string;
  readonly currency: 'INR';
}

export interface MenuResponse {
  readonly outlet: MenuOutlet;
  /**
   * Opaque fingerprint of the priced, available menu. It changes whenever any
   * price, availability or option changes, and is echoed by a quote so a stale
   * quote is detectable at confirmation.
   *
   * **Language-independent by construction**: it is derived from prices,
   * availability, options and the canonical English text only, so translating
   * an item cannot move it. Were it otherwise, a merchant fixing a Kannada
   * typo would turn every in-flight quote into a `409` "re-confirm" for a
   * change that altered no price (docs/API.md menu section).
   */
  readonly menuVersion: string;
  /** The language the strings in this response are in. Echoes the request. */
  readonly language: Language;
  /**
   * Fingerprint of the *displayed text* in this language, for caching only.
   * It changes when any translation in this language changes - including when
   * one is added or removed - and never gates an order.
   */
  readonly contentVersion: string;
  readonly categories: readonly MenuCategory[];
  readonly items: readonly MenuItem[];
}

// ---------------------------------------------------------------------------
// Ordering session contracts (`POST /api/v1/ordering-sessions`)
// ---------------------------------------------------------------------------

export interface CreateOrderingSessionRequest {
  readonly outletId: string;
  readonly channel: Channel;
}

/**
 * `sessionId` is an unguessable bearer capability: it must never be logged,
 * put in a URL, or shown in a QR code (docs/SECURITY.md sections 1 and 5).
 *
 * NEEDS JOINT AGREEMENT: docs/API.md leaves session transport open. The
 * implemented choice is the `Authorization: Bearer <sessionId>` header, not a
 * cookie, which avoids needing CSRF defences.
 */
export interface CreateOrderingSessionResponse {
  readonly sessionId: string;
  readonly outletId: string;
  readonly channel: Channel;
  readonly expiresAt: string;
}

// ---------------------------------------------------------------------------
// Quote contracts (`POST /api/v1/quotes`)
// ---------------------------------------------------------------------------

/** Bounds enforced by the server on every quote request. */
export const MAX_QUOTE_LINES = 30;
export const MAX_LINE_QUANTITY = 20;

/**
 * One requested line. A client sends IDs, options and quantities only: a
 * client-supplied price is never read (docs/API.md conventions).
 */
export interface QuoteLineRequest {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly optionIds?: readonly string[];
}

export interface QuoteRequest {
  readonly outletId: string;
  readonly items: readonly QuoteLineRequest[];
}

/** One priced line. Every money field is server-calculated. */
export interface QuoteLine {
  readonly menuItemId: string;
  /**
   * Canonical English name, snapshotted from the menu. Unchanged by language,
   * so a kitchen ticket and a merchant report read the same whatever the
   * customer ordered in.
   */
  readonly name: string;
  /**
   * The same name in the quote's language, for the review screen the customer
   * confirms from. Equal to `name` when the item is not translated.
   */
  readonly displayName: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  /** Item price plus the selected option deltas, for one unit. */
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

export interface QuoteResponse {
  readonly quoteId: string;
  readonly outletId: string;
  readonly menuVersion: string;
  /**
   * The language this quote's display names are in - the language the customer
   * reviewed in. `POST /api/v1/orders` takes the order's checkout language
   * from here rather than from the confirming request, so what is recorded is
   * what the customer actually saw.
   */
  readonly language: Language;
  /** Lines in the order submitted. Identical lines are not merged. */
  readonly items: readonly QuoteLine[];
  readonly subtotalMinor: number;
  /**
   * Equal to `subtotalMinor` in this milestone: no tax or service-charge rule
   * is configured, and docs/PRD.md section 9 keeps charge rules open. The field
   * exists separately so adding a charge later is not a breaking change.
   */
  readonly totalMinor: number;
  readonly currency: 'INR';
  readonly expiresAt: string;
}

// ---------------------------------------------------------------------------
// Cart draft contracts (`/api/v1/cart`)
// ---------------------------------------------------------------------------

/**
 * NEEDS JOINT AGREEMENT: docs/API.md describes no cart endpoints - it assumes
 * the client holds the draft and sends it to `POST /api/v1/quotes`. A
 * server-side draft is added because one shared conversational layer must be
 * able to amend the same draft the touch UI shows (docs/ARCHITECTURE.md
 * section 3): a client-only draft cannot be read by a backend conversation
 * tool. The quote contract is unchanged, so a client may ignore the cart
 * entirely and keep posting its own draft to `/quotes`.
 *
 * A cart is a draft and nothing more. It creates no order, reserves nothing,
 * holds no payment state, and is never evidence that a customer confirmed
 * anything (docs/SECURITY.md section 2).
 */

/** Bounds enforced on every cart mutation. */
export const MAX_CART_LINES = 30;
export const MAX_CART_LINE_QUANTITY = 20;

/** Why a line that is already in the draft can no longer be ordered. */
export const CART_LINE_ISSUES = [
  /** The item has left the menu entirely. */
  'itemNotOnMenu',
  /** The item exists but the merchant has switched it off. */
  'itemUnavailable',
  /** A selected option has left the item. */
  'optionNotOnItem',
  /** A selected option exists but is switched off. */
  'optionUnavailable',
  /** Current prices cannot produce a valid amount for this line. */
  'notPriceable',
] as const;
export type CartLineIssue = (typeof CART_LINE_ISSUES)[number];

/** One draft line. Every money field is server-calculated. */
export interface CartLine {
  /** Stable handle for updating or removing this line. Opaque to the client. */
  readonly lineId: string;
  readonly menuItemId: string;
  /**
   * Canonical English name, snapshotted from the menu on every read and never
   * echoed from the client.
   */
  readonly name: string;
  /**
   * The same name in the language this draft was read in (`?lang=`), or the
   * language of the conversational turn that returned it. Equal to `name` when
   * the item is not translated.
   */
  readonly displayName: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  /**
   * Zero when `issues` is non-empty: no stale price is ever reported, and an
   * unorderable line contributes nothing to the totals.
   */
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  /** False when `issues` is non-empty. */
  readonly available: boolean;
  readonly issues: readonly CartLineIssue[];
}

export interface CartResponse {
  readonly cartId: string;
  readonly outletId: string;
  /** Menu the prices below were taken from, recomputed on every response. */
  readonly menuVersion: string;
  /**
   * Monotonic counter, incremented by every accepted mutation. Send it back in
   * `If-Match` to make a mutation conditional.
   */
  readonly revision: number;
  /** Insertion order. Identical item+option selections are merged into one line. */
  readonly items: readonly CartLine[];
  /** Sum of available lines only. */
  readonly subtotalMinor: number;
  /**
   * Equal to `subtotalMinor`, for the same reason as on a quote: no charge rule
   * is configured (docs/PRD.md section 9).
   */
  readonly totalMinor: number;
  readonly currency: 'INR';
  /** True when at least one line carries an issue. Blocks checkout, not editing. */
  readonly hasUnavailableItems: boolean;
  readonly updatedAt: string;
}

export interface AddCartItemRequest {
  readonly menuItemId: string;
  readonly quantity: number;
  readonly optionIds?: readonly string[];
}

/** Quantity is required; `optionIds`, when present, replaces the selection. */
export interface UpdateCartItemRequest {
  readonly quantity: number;
  readonly optionIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Order contracts (`POST /api/v1/orders`, `GET /api/v1/orders/{orderId}`)
// ---------------------------------------------------------------------------

/**
 * Explicit customer confirmation is a required field, not an inference: a
 * draft, a quote, or a transcript is never evidence that a customer confirmed
 * (docs/SECURITY.md section 2). `customerConfirmed` must be literally `true`.
 *
 * `quoteId` is what fixes the priced selection. The server re-validates the
 * quote against the live menu anyway, so a quote is a record of what the
 * customer saw rather than a trusted price.
 */
export interface CreateOrderRequest {
  readonly outletId: string;
  readonly quoteId: string;
  readonly paymentMethod: PaymentMethod;
  readonly customerConfirmed: true;
}

/** Bound on the `Idempotency-Key` header value. */
export const MAX_IDEMPOTENCY_KEY_CHARS = 128;

/** One immutable ordered line. Prices are the ones calculated at order time. */
export interface OrderItem {
  readonly menuItemId: string;
  /**
   * Canonical English item name as it stood when the order was accepted. This
   * is the operational record: staff and kitchen read it whatever language the
   * customer ordered in.
   */
  readonly nameAtOrder: string;
  /**
   * The same name in the order's `checkoutLanguage`, frozen at acceptance, so
   * a customer tracking their order still reads it in the language they
   * ordered in. Equal to `nameAtOrder` when the item was not translated.
   */
  readonly displayNameAtOrder: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

/**
 * The customer-visible order.
 *
 * `token` is the pickup token: per outlet, per outlet-local day, sequential
 * from 1, and never reused within that day. It is deliberately not an
 * identifier - `orderId` is - because a token is called out loud at a counter.
 */
export interface OrderResponse {
  readonly orderId: string;
  readonly token: string;
  readonly outletId: string;
  readonly channel: Channel;
  readonly orderStatus: OrderStatus;
  /**
   * The language the customer confirmed in, taken from the quote rather than
   * from the confirming request. It is a record of what the customer saw, not
   * a display preference a later request may change.
   */
  readonly checkoutLanguage: Language;
  readonly paymentMethod: PaymentMethod;
  /**
   * `'dueAtCounter'` for cash, `'pending'` for UPI. Never `'verified'` here:
   * only a verified provider callback or an authorized staff action may reach
   * that, and neither exists yet (docs/SECURITY.md section 2).
   */
  readonly paymentStatus: PaymentStatus;
  readonly items: readonly OrderItem[];
  readonly subtotalMinor: number;
  readonly totalMinor: number;
  readonly currency: 'INR';
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * NEEDS JOINT AGREEMENT: `orderAccessToken` is not in docs/API.md.
 *
 * An ordering session expires 30 minutes after it is created, while a customer
 * may still be waiting for food. docs/API.md scopes `GET /api/v1/orders/{id}`
 * to the session, which would make an order unreadable exactly when the
 * customer wants to track it. So order creation issues a separate unguessable
 * read capability, stored only as a hash, which keeps working after the
 * session has gone.
 *
 * It is returned exactly once, on the first successful creation. An idempotent
 * replay cannot reissue it, because only its hash is stored, and so omits it.
 */
export interface CreateOrderResponse extends OrderResponse {
  readonly orderAccessToken?: string;
}

// ---------------------------------------------------------------------------
// Conversational turn contracts (`POST /api/v1/conversation/turns`)
// ---------------------------------------------------------------------------

/**
 * NEEDS JOINT AGREEMENT: docs/API.md describes the conversational service as an
 * internal contract with no HTTP route, but a QR or kiosk client cannot reach
 * it any other way - clients never call an LLM directly. The route exists in
 * `backend/src/routes/conversation.ts`; these are the client-visible shapes.
 *
 * Nothing here is authoritative. A draft action is a proposal that the backend
 * has already validated and applied (or refused) against the server-side
 * draft, and `cart` is the only truth about what is in the draft. Speech never
 * confirms an order (docs/SECURITY.md section 2).
 */
export const CONVERSATION_PHASES = [
  'browsing',
  'building',
  'review',
  'confirmation',
  'payment',
] as const;
export type ConversationPhase = (typeof CONVERSATION_PHASES)[number];

export interface ConversationTurnRequest {
  readonly language: Language;
  readonly phase: ConversationPhase;
  /** Transcript or typed text. Untrusted server-side. */
  readonly text: string;
  /** Set once the customer has declined a suggestion. */
  readonly customerDeclinedRecommendation?: boolean;
}

/** A menu item the assistant offered, already resolved against the live menu. */
export interface ConversationSuggestion {
  readonly menuItemId: string;
  readonly name: string;
  readonly kind: 'requested' | 'proactive';
}

/**
 * Client-visible subset of the backend's turn result. The backend type
 * (`workflows/conversationTurn.ts`) is the authority and carries audit fields
 * a client has no use for; a compile-time check in the route keeps this
 * assignable from it, so the two cannot drift apart silently.
 */
export interface ConversationTurnResponse {
  /** Absent when the provider failed; the draft is then untouched. */
  readonly assistantText: string | undefined;
  /** The authoritative draft after the turn. */
  readonly cart: CartResponse;
  readonly suggestions: readonly ConversationSuggestion[];
  /** True when the assistant needs the customer to disambiguate. */
  readonly needsClarification: boolean;
  readonly providerStatus: {
    readonly state: 'ok' | 'failed';
    /** `'touch'` whenever the conversational path produced nothing usable. */
    readonly fallback?: 'touch';
  };
}
