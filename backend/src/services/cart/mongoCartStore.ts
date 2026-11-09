/**
 * MongoDB-backed draft carts (docs/DATABASE.md section 2).
 *
 * Selections only: a stored line holds item ID, option IDs and quantity, never
 * a price or total, so every amount in a cart response is recomputed from the
 * live menu on read and a client value can never become a stored one
 * (docs/SECURITY.md section 2). The single denormalized field is
 * `nameSnapshot`, used only to label a line whose item has left the menu.
 *
 * Isolation is in the filter, not after it: every read and write matches both
 * the session (as its hash, the `_id`) and `outletId`, so no document can be
 * returned under another session or another outlet
 * (docs/SECURITY.md section 1). The session ID itself is never stored.
 *
 * Concurrency without a single process: `save` is a conditional write matching
 * the revision the caller read. Two instances editing one draft cannot lose an
 * update - the loser gets `CartRevisionConflictError` and the cart service
 * either retries or reports `409`.
 *
 * Expiry is enforced on read because the ordering session's deadline is
 * authoritative; the TTL index is cleanup only.
 *
 * Failure handling: a missing connection or driver error is a retryable 503,
 * never a draft reported as saved (docs/ARCHITECTURE.md section 6).
 */

import { randomUUID } from 'node:crypto';
import { MongoServerError, type Collection, type Db } from 'mongodb';
import { ApiError } from '../../middleware/errors.js';
import { SESSION_COLLECTIONS, type CartDraftDoc } from '../../models/sessions.js';
import { hashSessionKey } from '../sessions/sessionKey.js';
import {
  CART_TTL_MS,
  CartRevisionConflictError,
  DEFAULT_MAX_CARTS,
  type CartRecord,
  type CartStore,
} from './cartStore.js';

/** MongoDB's duplicate-key error: two instances inserted a first draft at once. */
const DUPLICATE_KEY = 11000;

/**
 * Index creation, idempotent so startup and a later migration may both call it.
 *
 * One draft per session needs no unique index: the session hash *is* the `_id`,
 * so uniqueness is enforced by the primary key. Only the TTL index is added,
 * and it is cleanup alone - `expiresAt` is checked in every query filter, so a
 * document MongoDB has not yet collected is still refused
 * (docs/DATABASE.md section 3).
 */
export async function ensureCartDraftIndexes(db: Db): Promise<void> {
  await db
    .collection(SESSION_COLLECTIONS.cartDrafts)
    .createIndex({ expiresAt: 1 }, { name: 'cart_draft_ttl', expireAfterSeconds: 0 });
}

function unavailable(): ApiError {
  return ApiError.unavailable('Draft storage is temporarily unavailable. Please retry.');
}

function toRecord(doc: CartDraftDoc, sessionId: string): CartRecord {
  return {
    cartId: doc.cartId,
    sessionId,
    outletId: doc.outletId,
    revision: doc.revision,
    lines: doc.lines.map((line) => ({
      lineId: line.lineId,
      menuItemId: line.menuItemId,
      optionIds: line.optionIds,
      quantity: line.quantity,
      nameSnapshot: line.nameSnapshot,
    })),
    updatedAtMs: doc.updatedAt.getTime(),
    expiresAtMs: doc.expiresAt.getTime(),
  };
}

export function createMongoCartStore(
  resolveDb: () => Db,
  options: {
    readonly ttlMs?: number;
    readonly maxCarts?: number;
    readonly now?: () => number;
  } = {},
): CartStore {
  const ttlMs = options.ttlMs ?? CART_TTL_MS;
  const maxCarts = options.maxCarts ?? DEFAULT_MAX_CARTS;
  const now = options.now ?? Date.now;

  function collection(): Collection<CartDraftDoc> {
    try {
      return resolveDb().collection<CartDraftDoc>(SESSION_COLLECTIONS.cartDrafts);
    } catch {
      throw unavailable();
    }
  }

  return {
    async get(sessionId, outletId) {
      const current = new Date(now());
      let doc: CartDraftDoc | null;
      try {
        doc = await collection().findOne({
          _id: hashSessionKey(sessionId),
          // Both halves of the scope, and the deadline, in the filter itself.
          outletId,
          expiresAt: { $gt: current },
        });
      } catch {
        throw unavailable();
      }
      return doc === null ? undefined : toRecord(doc, sessionId);
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
        expiresAtMs: Math.min(current + ttlMs, sessionExpiresAtMs),
      };
    },

    async save(record, sessionExpiresAtMs) {
      const drafts = collection();
      const key = hashSessionKey(record.sessionId);
      const current = new Date(now());
      // Clamped to the owning session: a draft must not be readable, or even
      // present, after the capability that reads it has died.
      const expiresAt = new Date(
        Math.min(current.getTime() + ttlMs, sessionExpiresAtMs),
      );
      const previousRevision = record.revision - 1;

      if (previousRevision === 0) {
        // First mutation of this draft. Refuse rather than evict when the store
        // is full: evicting would silently empty another customer's cart (same
        // choice as the session service).
        let live: number;
        try {
          live = await drafts.countDocuments({ expiresAt: { $gt: current } });
        } catch {
          throw unavailable();
        }
        if (live >= maxCarts) {
          throw ApiError.unavailable('Too many active drafts. Please retry.');
        }
      }

      const doc: CartDraftDoc = {
        _id: key,
        cartId: record.cartId,
        outletId: record.outletId,
        revision: record.revision,
        lines: record.lines,
        updatedAt: current,
        expiresAt,
      };

      try {
        if (previousRevision === 0) {
          // An expired document may still be present, so this replaces rather
          // than inserts, but only when nothing usable is stored: the filter
          // demands either no live draft or one still at revision 0.
          const result = await drafts.replaceOne(
            {
              _id: key,
              $or: [
                { expiresAt: { $lte: current } },
                { outletId: record.outletId, revision: 0 },
              ],
            },
            doc,
            { upsert: true },
          );
          if (result.matchedCount === 0 && result.upsertedCount === 0) {
            throw new CartRevisionConflictError(undefined);
          }
        } else {
          const result = await drafts.updateOne(
            {
              _id: key,
              outletId: record.outletId,
              revision: previousRevision,
              expiresAt: { $gt: current },
            },
            {
              $set: {
                revision: record.revision,
                lines: record.lines,
                updatedAt: current,
                expiresAt,
              },
            },
          );
          if (result.matchedCount === 0) {
            // Either another instance moved the draft, or it expired.
            const stored = await drafts.findOne(
              { _id: key, outletId: record.outletId, expiresAt: { $gt: current } },
              { projection: { revision: 1 } },
            );
            throw new CartRevisionConflictError(stored?.revision);
          }
        }
      } catch (error) {
        if (error instanceof CartRevisionConflictError) throw error;
        if (error instanceof ApiError) throw error;
        // A concurrent first insert lost the race for the primary key. That is
        // a revision conflict, not an outage: the draft now exists at a
        // revision this caller has not seen.
        if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
          throw new CartRevisionConflictError(undefined);
        }
        throw unavailable();
      }

      return toRecord(doc, record.sessionId);
    },

    async delete(sessionId) {
      try {
        await collection().deleteOne({ _id: hashSessionKey(sessionId) });
      } catch {
        throw unavailable();
      }
    },

    async size() {
      try {
        return await collection().countDocuments({ expiresAt: { $gt: new Date(now()) } });
      } catch {
        throw unavailable();
      }
    },
  };
}
