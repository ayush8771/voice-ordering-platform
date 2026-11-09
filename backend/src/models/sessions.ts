/**
 * Persisted shapes for ordering sessions and draft carts
 * (docs/DATABASE.md section 2).
 *
 * Two rules shape both documents:
 *
 * - **No bearer token is stored.** A session ID is an unguessable capability,
 *   so only its SHA-256 hash is persisted, and it is the `_id`. A dump of
 *   either collection therefore cannot be replayed as a session
 *   (docs/SECURITY.md section 1). The hash is also the uniqueness constraint,
 *   which is why neither collection needs a unique index of its own.
 * - **Selections only, never money.** A draft line holds item ID, option IDs
 *   and quantity. Every amount in a cart response is recomputed from the
 *   current menu on read (docs/SECURITY.md section 2).
 *
 * Timestamps are stored as UTC `Date`s (docs/DATABASE.md section 1); the
 * services convert to epoch milliseconds at the boundary. `Date` is also what
 * a TTL index requires.
 */

import type { Channel } from '@vop/shared';

export const SESSION_COLLECTIONS = {
  orderingSessions: 'orderingSessions',
  cartDrafts: 'cartDrafts',
} as const;

export interface OrderingSessionDoc {
  /** SHA-256 hex of the session ID. The raw ID is never stored. */
  readonly _id: string;
  /** Short hash prefix, the only session identifier safe to log. */
  readonly sessionRef: string;
  readonly outletId: string;
  readonly channel: Channel;
  readonly createdAt: Date;
  /** Absolute deadline. Also the TTL field: cleanup only, never the check. */
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  /** Idle deadline, never later than `expiresAt`. */
  readonly idleExpiresAt: Date;
}

export interface CartDraftLineDoc {
  readonly lineId: string;
  readonly menuItemId: string;
  /** Sorted and de-duplicated, so two equal selections compare equal. */
  readonly optionIds: readonly string[];
  readonly quantity: number;
  /** Menu name at add time. Labelling only, never pricing. */
  readonly nameSnapshot: string;
}

export interface CartDraftDoc {
  /** SHA-256 hex of the owning session ID: one draft per session. */
  readonly _id: string;
  readonly cartId: string;
  readonly outletId: string;
  /** Optimistic-concurrency token; every accepted mutation increments it. */
  readonly revision: number;
  readonly lines: readonly CartDraftLineDoc[];
  readonly updatedAt: Date;
  /** TTL field, bounded by the owning session's absolute deadline. */
  readonly expiresAt: Date;
}
