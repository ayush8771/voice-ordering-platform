/**
 * Shared contracts between the backend API and the React clients.
 *
 * Scope rule (docs/ARCHITECTURE.md section 5): anything in this package is a
 * contract both owners depend on, so additions are reviewed by Ayush and Anvesh
 * before either side implements against them.
 *
 * Menu, ordering-session and quote shapes are now here (menu + touch ordering
 * milestone). Order creation and payment shapes are deliberately still absent.
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
   */
  readonly menuVersion: string;
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
  readonly name: string;
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
