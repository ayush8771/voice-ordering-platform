/**
 * Shared contracts between the backend API and the React clients.
 *
 * Scope rule (docs/ARCHITECTURE.md section 5): anything in this package is a
 * contract both owners depend on, so additions are reviewed by Ayush and Anvesh
 * before either side implements against them.
 *
 * Deliberately NOT here yet: menu, quote and order request/response shapes.
 * Those are still provisional in docs/API.md and awaiting that joint review.
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

/** Supported interface languages (docs/PRD.md). */
export const LANGUAGES = ['kn', 'en', 'hi-en'] as const;
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
