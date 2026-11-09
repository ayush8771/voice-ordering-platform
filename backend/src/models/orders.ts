/**
 * Order persistence documents (docs/DATABASE.md section 2).
 *
 * An order is the one immutable commercial record in the system, so it carries
 * its own price snapshot: later menu edits must not rewrite what a customer
 * agreed to pay.
 *
 * Two rules carried over from sessions and drafts:
 *
 * - **No bearer token is stored.** docs/DATABASE.md lists `sessionId` "or safe
 *   reference" on an order; the safe reference is used, because storing the raw
 *   ID would contradict docs/SECURITY.md section 1. `sessionKeyHash` is the
 *   SHA-256 of the session ID (the same hash drafts are keyed by, so an order
 *   and its draft can be correlated without either storing the token), and
 *   `sessionRef` is the 12-character prefix that is safe to log. The separate
 *   order-read capability is likewise stored only as `accessTokenHash`.
 * - **Money is integer minor units**, never floating point.
 *
 * Deviation from docs/DATABASE.md: `_id` is the `publicOrderId` (a random
 * UUID) rather than an ObjectId. The document says to use ObjectId internally
 * and expose a separate public ID; using the unguessable public ID as the
 * primary key exposes nothing sequential, needs one index fewer, and makes the
 * read path a primary-key lookup. Both fields are present so a client contract
 * or a later migration sees no difference.
 */

import type { Channel, OrderStatus, PaymentMethod, PaymentStatus } from '@vop/shared';
import type { Currency } from './money.js';

export const ORDER_COLLECTIONS = {
  orders: 'orders',
  /**
   * One counter per outlet per outlet-local day. Its own collection rather
   * than a field on the outlet, so the hot `$inc` on order creation never
   * contends with menu reads.
   */
  pickupTokenCounters: 'pickupTokenCounters',
} as const;

export interface OrderItemDoc {
  readonly menuItemId: string;
  readonly nameAtOrder: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
}

/** Who caused a state and when. No audio, transcript or payment credential. */
export interface OrderStatusEventDoc {
  readonly status: OrderStatus;
  readonly actorKind: 'customer' | 'staff' | 'system';
  readonly actorId?: string;
  readonly at: Date;
}

export interface OrderDoc {
  /** The `publicOrderId`; unguessable, so it is safe as the primary key. */
  readonly _id: string;
  readonly publicOrderId: string;
  readonly outletId: string;
  /** SHA-256 hex of the owning session ID. The raw ID is never stored. */
  readonly sessionKeyHash: string;
  /** Hash prefix, the only session identifier safe to log. */
  readonly sessionRef: string;
  readonly channel: Channel;
  /** Pickup token, sequential within `tokenDateKey`. Display value. */
  readonly token: string;
  /** Outlet-local calendar day, `YYYY-MM-DD`; the token's reset window. */
  readonly tokenDateKey: string;
  /** SHA-256 hex of the order-read capability. The token itself is not stored. */
  readonly accessTokenHash: string;
  readonly items: readonly OrderItemDoc[];
  readonly subtotalMinor: number;
  readonly totalMinor: number;
  readonly currency: Currency;
  readonly paymentMethod: PaymentMethod;
  readonly paymentStatus: PaymentStatus;
  readonly orderStatus: OrderStatus;
  readonly idempotencyKey: string;
  /**
   * Hash of the request fields that define the order. A retry with the same
   * key but a different body is a caller bug and is refused with `409`
   * (docs/API.md conventions), which needs the original body's fingerprint.
   */
  readonly requestFingerprint: string;
  /** The quote the customer confirmed, and the menu it was priced against. */
  readonly quoteId: string;
  readonly menuVersion: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly statusHistory: readonly OrderStatusEventDoc[];
}

export interface PickupTokenCounterDoc {
  /** `${outletId}:${tokenDateKey}`: the counter's scope is its key. */
  readonly _id: string;
  readonly outletId: string;
  readonly dateKey: string;
  /** Last allocated token. Only ever incremented; never wraps. */
  readonly lastToken: number;
  readonly updatedAt: Date;
}
