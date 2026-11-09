/**
 * Draft carts, keyed by ordering session.
 *
 * Only *selections* are stored - item ID, option IDs and quantity. No price,
 * no name, no total: every amount in a cart response is recomputed from the
 * current menu on read, so a price can never go stale in storage and a client
 * value can never become a stored one (docs/SECURITY.md section 2). The one
 * denormalized field is `nameSnapshot`, used solely to label a line whose item
 * has since left the menu; it is never used for pricing.
 *
 * This is the in-memory, single-process implementation, kept for unit tests
 * and for running the API without a database. Production wires the
 * MongoDB-backed store in `mongoCartStore.ts`, so a restart or a second
 * backend instance no longer empties a draft mid-order
 * (docs/DATABASE.md section 2). Both are bounded and both refuse rather than
 * evict when full.
 *
 * `save` is a conditional write in both implementations: it applies only on
 * top of the revision the caller read. That is what makes a draft safe to edit
 * from two surfaces at once without a single process holding a lock.
 *
 * Isolation (docs/SECURITY.md section 1): the key is the session ID, which is
 * itself outlet-bound, and `get` additionally refuses a record whose outlet
 * does not match the caller's scope. One session can never see another's
 * draft, and a draft can never be read under the wrong outlet.
 */

import { randomUUID } from 'node:crypto';
import { ApiError } from '../../middleware/errors.js';

/** One stored selection. */
export interface CartLineRecord {
  readonly lineId: string;
  readonly menuItemId: string;
  /** Normalized: sorted and de-duplicated, so lines compare reliably. */
  readonly optionIds: readonly string[];
  readonly quantity: number;
  /** Menu name at the time the line was added. Labelling only, never pricing. */
  readonly nameSnapshot: string;
}

export interface CartRecord {
  readonly cartId: string;
  readonly sessionId: string;
  readonly outletId: string;
  /** Incremented by every accepted mutation; the optimistic-concurrency token. */
  readonly revision: number;
  readonly lines: readonly CartLineRecord[];
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * A `save` whose expected revision no longer matched the stored draft.
 *
 * Distinct from the `409` a caller's own `If-Match` earns, because a mutation
 * sent without `If-Match` may simply be retried against the fresh draft: the
 * caller never claimed to have seen a particular revision.
 */
export class CartRevisionConflictError extends Error {
  constructor(readonly storedRevision: number | undefined) {
    super('The draft changed since it was read');
    this.name = 'CartRevisionConflictError';
  }
}

export interface CartStore {
  /** The session's draft, or undefined when absent, expired or wrong-outlet. */
  get(sessionId: string, outletId: string): Promise<CartRecord | undefined>;
  /**
   * Creates an empty record without storing it; stored on first mutation.
   *
   * `sessionExpiresAtMs` is the owning session's absolute deadline and caps
   * the draft's own.
   */
  create(sessionId: string, outletId: string, sessionExpiresAtMs: number): CartRecord;
  /**
   * Persists a mutated record, refreshing its deadline to
   * `min(now + ttl, sessionExpiresAtMs)`.
   *
   * Conditional on `record.revision - 1` being what is stored, so a draft
   * another instance moved in the meantime is never overwritten. Throws
   * `CartRevisionConflictError` when it is not.
   */
  save(record: CartRecord, sessionExpiresAtMs: number): Promise<CartRecord>;
  delete(sessionId: string): Promise<void>;
  size(): Promise<number>;
}

/**
 * Draft lifetime from the last write, matched to the ordering session's
 * absolute cap.
 *
 * It is only the first half of the deadline: every write clamps to
 * `min(now + CART_TTL_MS, session.expiresAtMs)`, so a draft refreshed late in
 * a session's life cannot outlive the only capability that can read it. The
 * session's own expiry stays authoritative (docs/DATABASE.md section 2).
 */
export const CART_TTL_MS = 30 * 60 * 1000;

export const DEFAULT_MAX_CARTS = 5000;

export function createCartStore(
  options: {
    readonly ttlMs?: number;
    readonly maxCarts?: number;
    readonly now?: () => number;
  } = {},
): CartStore {
  const ttlMs = options.ttlMs ?? CART_TTL_MS;
  const maxCarts = options.maxCarts ?? DEFAULT_MAX_CARTS;
  const now = options.now ?? Date.now;
  const carts = new Map<string, CartRecord>();

  /** The clamped deadline both `create` and `save` apply. */
  function deadline(current: number, sessionExpiresAtMs: number): number {
    return Math.min(current + ttlMs, sessionExpiresAtMs);
  }

  function prune(): void {
    const current = now();
    for (const [sessionId, record] of carts) {
      if (record.expiresAtMs <= current) carts.delete(sessionId);
    }
  }

  /** The live record for a session, dropping it if its deadline has passed. */
  function live(sessionId: string): CartRecord | undefined {
    const record = carts.get(sessionId);
    if (record === undefined) return undefined;
    if (record.expiresAtMs <= now()) {
      carts.delete(sessionId);
      return undefined;
    }
    return record;
  }

  return {
    async get(sessionId, outletId) {
      const record = live(sessionId);
      if (record === undefined) return undefined;
      // Defence in depth: a session is outlet-bound at creation, so this can
      // only fire if that invariant is ever broken.
      if (record.outletId !== outletId) return undefined;
      return record;
    },

    create(sessionId, outletId, sessionExpiresAtMs) {
      const current = now();
      return {
        cartId: randomUUID(),
        sessionId,
        outletId,
        revision: 0,
        lines: [],
        updatedAtMs: current,
        expiresAtMs: deadline(current, sessionExpiresAtMs),
      };
    },

    async save(record, sessionExpiresAtMs) {
      prune();

      // Same conditional write the MongoDB store performs, so the in-memory
      // store cannot pass a test the persistent one would fail.
      const existing = live(record.sessionId);
      const scoped =
        existing !== undefined && existing.outletId === record.outletId
          ? existing
          : undefined;
      if ((scoped?.revision ?? 0) !== record.revision - 1) {
        throw new CartRevisionConflictError(scoped?.revision);
      }

      if (existing === undefined && carts.size >= maxCarts) {
        // Evicting someone else's draft to make room would silently empty the
        // cart of a customer who is mid-order, so a full store refuses the
        // new draft instead (same choice as the session service).
        throw ApiError.unavailable('Too many active drafts. Please retry.');
      }

      const current = now();
      const stored: CartRecord = {
        ...record,
        updatedAtMs: current,
        expiresAtMs: deadline(current, sessionExpiresAtMs),
      };
      carts.set(record.sessionId, stored);
      return stored;
    },

    async delete(sessionId) {
      carts.delete(sessionId);
    },

    async size() {
      prune();
      return carts.size;
    },
  };
}
