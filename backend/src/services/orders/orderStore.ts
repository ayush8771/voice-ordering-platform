/**
 * MongoDB-backed orders (docs/DATABASE.md section 2).
 *
 * This is the only persistent store in the ordering path with no expiry: an
 * order is a commercial record, not session state, so it outlives both the
 * session and the draft that produced it.
 *
 * Concurrency properties, both enforced by the server rather than by a lock,
 * so they hold with more than one backend instance:
 *
 * - **Pickup tokens** are allocated by one `findOneAndUpdate` with `$inc` and
 *   `upsert`, which MongoDB applies atomically to a single document. Two
 *   simultaneous orders therefore get two different numbers; neither can read
 *   the same counter value.
 * - **Idempotency** is enforced by a unique index on
 *   `{ outletId, sessionKeyHash, idempotencyKey }`. Two concurrent retries of
 *   one request both attempt the insert and exactly one wins; the loser gets a
 *   duplicate-key error and is reported as a replay of the winner, so a double
 *   tap can never create two orders.
 *
 * Failure handling: a missing connection or driver error is a retryable 503,
 * never an order reported as created (docs/ARCHITECTURE.md section 6).
 */

import { MongoServerError, type Collection, type Db } from 'mongodb';
import { ApiError } from '../../middleware/errors.js';
import {
  ORDER_COLLECTIONS,
  type OrderDoc,
  type PickupTokenCounterDoc,
} from '../../models/orders.js';

const DUPLICATE_KEY = 11000;

export interface OrderStore {
  /**
   * Next pickup token for this outlet and outlet-local day.
   *
   * Monotonic, never reused within the day and never wrapped. A number may be
   * skipped when an insert is afterwards found to be an idempotent replay;
   * that is deliberate - allocating before the insert is what keeps allocation
   * a single atomic operation - and a gap in called-out tokens is harmless.
   */
  allocateToken(outletId: string, dateKey: string): Promise<number>;
  /** The order already stored for an idempotency key, if any. */
  findByIdempotency(
    outletId: string,
    sessionKeyHash: string,
    idempotencyKey: string,
  ): Promise<OrderDoc | undefined>;
  /**
   * Inserts a new order, or reports the stored one when this
   * `{ outletId, sessionKeyHash, idempotencyKey }` has already been used.
   */
  insert(doc: OrderDoc): Promise<{ readonly doc: OrderDoc; readonly replayed: boolean }>;
  /** The order behind an order-read capability, or undefined. */
  findByAccessHash(
    publicOrderId: string,
    accessTokenHash: string,
  ): Promise<OrderDoc | undefined>;
}

/**
 * Index creation, idempotent so startup and a later migration may both call it.
 *
 * - unique `{ outletId, sessionKeyHash, idempotencyKey }`: the idempotency
 *   constraint from docs/DATABASE.md section 3, and the thing that makes a
 *   concurrent retry safe rather than merely unlikely;
 * - unique `{ outletId, tokenDateKey, token }`: the token scope, now that the
 *   reset policy is decided (daily, per outlet, in the outlet's timezone). It
 *   is a second line of defence - the counter is already atomic - so a bug
 *   that reused a token would fail the write instead of confusing a counter;
 * - `{ outletId, orderStatus, createdAt }`: the merchant queue read.
 *
 * No TTL index: orders are not expired or hard-deleted in normal operation
 * (docs/DATABASE.md section 4).
 */
export async function ensureOrderIndexes(db: Db): Promise<void> {
  const orders = db.collection(ORDER_COLLECTIONS.orders);
  await orders.createIndex(
    { outletId: 1, sessionKeyHash: 1, idempotencyKey: 1 },
    { name: 'order_idempotency', unique: true },
  );
  await orders.createIndex(
    { outletId: 1, tokenDateKey: 1, token: 1 },
    { name: 'order_token_scope', unique: true },
  );
  await orders.createIndex(
    { outletId: 1, orderStatus: 1, createdAt: 1 },
    { name: 'order_queue' },
  );
}

function unavailable(): ApiError {
  return ApiError.unavailable('Order storage is temporarily unavailable. Please retry.');
}

export function createMongoOrderStore(resolveDb: () => Db): OrderStore {
  function orders(): Collection<OrderDoc> {
    try {
      return resolveDb().collection<OrderDoc>(ORDER_COLLECTIONS.orders);
    } catch {
      throw unavailable();
    }
  }

  function counters(): Collection<PickupTokenCounterDoc> {
    try {
      return resolveDb().collection<PickupTokenCounterDoc>(
        ORDER_COLLECTIONS.pickupTokenCounters,
      );
    } catch {
      throw unavailable();
    }
  }

  async function lookup(
    outletId: string,
    sessionKeyHash: string,
    idempotencyKey: string,
  ): Promise<OrderDoc | undefined> {
    const stored = await orders().findOne({
      outletId,
      sessionKeyHash,
      idempotencyKey,
    });
    return stored ?? undefined;
  }

  return {
    async allocateToken(outletId, dateKey) {
      try {
        const counter = await counters().findOneAndUpdate(
          { _id: `${outletId}:${dateKey}` },
          {
            $inc: { lastToken: 1 },
            $set: { updatedAt: new Date() },
            $setOnInsert: { outletId, dateKey },
          },
          { upsert: true, returnDocument: 'after' },
        );
        if (counter === null) throw unavailable();
        return counter.lastToken;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw unavailable();
      }
    },

    async findByIdempotency(outletId, sessionKeyHash, idempotencyKey) {
      try {
        return await lookup(outletId, sessionKeyHash, idempotencyKey);
      } catch {
        throw unavailable();
      }
    },

    async insert(doc) {
      try {
        // Checked before the insert so a retry whose quote has since expired
        // still replays: the stored order is the answer, not the quote.
        const existing = await lookup(
          doc.outletId,
          doc.sessionKeyHash,
          doc.idempotencyKey,
        );
        if (existing !== undefined) return { doc: existing, replayed: true };

        await orders().insertOne(doc);
        return { doc, replayed: false };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) {
          // Lost a race against a concurrent retry of the same request. The
          // winner's order is the result; the token this caller allocated is
          // simply skipped.
          try {
            const winner = await lookup(
              doc.outletId,
              doc.sessionKeyHash,
              doc.idempotencyKey,
            );
            if (winner !== undefined) return { doc: winner, replayed: true };
          } catch {
            throw unavailable();
          }
          // A duplicate on the token index instead: the counter and the index
          // disagree, which is a fault worth surfacing as retryable rather
          // than guessing.
          throw unavailable();
        }
        throw unavailable();
      }
    },

    async findByAccessHash(publicOrderId, accessTokenHash) {
      try {
        // Both halves in the filter: a wrong capability is indistinguishable
        // from an unknown order (docs/SECURITY.md section 1).
        const doc = await orders().findOne({ _id: publicOrderId, accessTokenHash });
        return doc ?? undefined;
      } catch {
        throw unavailable();
      }
    },
  };
}
