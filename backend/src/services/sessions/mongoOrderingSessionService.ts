/**
 * MongoDB-backed ordering sessions (docs/DATABASE.md section 2).
 *
 * Why persisted: a session is the only capability that can read a customer's
 * draft, so losing it on a restart or landing on a second backend instance
 * would empty a cart mid-order. Sessions and drafts therefore share one store
 * and one lifetime.
 *
 * What is stored: never the session ID. The `_id` is its SHA-256 hash, so the
 * collection holds no replayable bearer token and still gets uniqueness for
 * free (docs/SECURITY.md section 1).
 *
 * Expiry is enforced in the filter of every read, not by a sweep: the TTL index
 * is cleanup only, and a document that outlives its deadline is already
 * unreadable. `find` checks both deadlines and slides the idle window in a
 * single `findOneAndUpdate`, so two concurrent requests cannot interleave a
 * read and a write and revive an expired session.
 *
 * Failure handling: a missing connection or a driver error is a retryable 503
 * and never a reported success (docs/ARCHITECTURE.md section 6). The database
 * is resolved per call because the API may start before it is reachable.
 */

import { randomBytes } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { Channel, CreateOrderingSessionResponse } from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import { SESSION_COLLECTIONS, type OrderingSessionDoc } from '../../models/sessions.js';
import {
  DEFAULT_MAX_SESSIONS,
  deriveSessionRef,
  SESSION_IDLE_TTL_MS,
  SESSION_TTL_MS,
  type OrderingSession,
  type OrderingSessionService,
} from './orderingSessionService.js';
import { hashSessionKey } from './sessionKey.js';

/**
 * Index creation, idempotent so startup and a later migration may both call it.
 *
 * Only a TTL index is needed: `_id` already indexes the lookup key, and the
 * TTL is cleanup alone - `expiresAt` is checked in every query filter, so a
 * document MongoDB has not yet collected is still refused
 * (docs/DATABASE.md section 3).
 */
export async function ensureOrderingSessionIndexes(db: Db): Promise<void> {
  await db
    .collection(SESSION_COLLECTIONS.orderingSessions)
    .createIndex(
      { expiresAt: 1 },
      { name: 'session_ttl', expireAfterSeconds: 0 },
    );
}

function toSession(doc: OrderingSessionDoc, sessionId: string): OrderingSession {
  return {
    sessionId,
    sessionRef: doc.sessionRef,
    outletId: doc.outletId,
    channel: doc.channel,
    createdAtMs: doc.createdAt.getTime(),
    expiresAtMs: doc.expiresAt.getTime(),
    lastSeenAtMs: doc.lastSeenAt.getTime(),
    idleExpiresAtMs: doc.idleExpiresAt.getTime(),
  };
}

/** Every database fault reaching a caller is retryable, never a 500. */
function unavailable(): ApiError {
  return ApiError.unavailable('Ordering is temporarily unavailable. Please retry.');
}

export function createMongoOrderingSessionService(
  resolveDb: () => Db,
  options: {
    readonly ttlMs?: number;
    readonly idleTtlMs?: number;
    readonly maxSessions?: number;
    readonly now?: () => number;
  } = {},
): OrderingSessionService {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const idleTtlMs = options.idleTtlMs ?? SESSION_IDLE_TTL_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const now = options.now ?? Date.now;

  function collection(): Collection<OrderingSessionDoc> {
    try {
      return resolveDb().collection<OrderingSessionDoc>(
        SESSION_COLLECTIONS.orderingSessions,
      );
    } catch {
      throw unavailable();
    }
  }

  /** Live on both deadlines, asserted in the query rather than after it. */
  function liveFilter(current: Date): Record<string, unknown> {
    return { expiresAt: { $gt: current }, idleExpiresAt: { $gt: current } };
  }

  return {
    async create(outletId: string, channel: Channel) {
      const sessions = collection();
      const current = new Date(now());

      // Refuse rather than evict: evicting would silently break a customer who
      // is mid-order (docs/ARCHITECTURE.md section 6). Counted with the same
      // live filter a read uses, so expired documents awaiting TTL collection
      // do not consume the budget.
      let live: number;
      try {
        live = await sessions.countDocuments(liveFilter(current));
      } catch {
        throw unavailable();
      }
      if (live >= maxSessions) {
        throw ApiError.unavailable('Too many active ordering sessions. Please retry.');
      }

      const sessionId = randomBytes(32).toString('base64url');
      const expiresAt = new Date(current.getTime() + ttlMs);
      const doc: OrderingSessionDoc = {
        _id: hashSessionKey(sessionId),
        sessionRef: deriveSessionRef(sessionId),
        outletId,
        channel,
        createdAt: current,
        expiresAt,
        lastSeenAt: current,
        idleExpiresAt: new Date(
          Math.min(current.getTime() + idleTtlMs, expiresAt.getTime()),
        ),
      };

      try {
        await sessions.insertOne(doc);
      } catch {
        // Nothing was written, so no session ID is handed out.
        throw unavailable();
      }

      const response: CreateOrderingSessionResponse = {
        sessionId,
        outletId,
        channel,
        // Still the absolute deadline, as docs/API.md documents it.
        expiresAt: expiresAt.toISOString(),
      };
      return response;
    },

    async find(sessionId: string) {
      const sessions = collection();
      const current = new Date(now());
      const nextIdle = new Date(current.getTime() + idleTtlMs);

      let doc: OrderingSessionDoc | null;
      try {
        // One conditional write: the expiry check and the idle slide cannot be
        // separated by another request. The pipeline form is what lets the new
        // idle deadline be clamped to this document's own `expiresAt`.
        doc = await sessions.findOneAndUpdate(
          { _id: hashSessionKey(sessionId), ...liveFilter(current) },
          [
            {
              $set: {
                lastSeenAt: current,
                idleExpiresAt: { $min: ['$expiresAt', nextIdle] },
              },
            },
          ],
          { returnDocument: 'after' },
        );
      } catch {
        throw unavailable();
      }

      // Unknown and expired are indistinguishable, so a caller cannot tell a
      // wrong guess from a timed-out session.
      return doc === null ? undefined : toSession(doc, sessionId);
    },

    async end(sessionId: string) {
      try {
        await collection().deleteOne({ _id: hashSessionKey(sessionId) });
      } catch {
        throw unavailable();
      }
    },

    async size() {
      try {
        return await collection().countDocuments(liveFilter(new Date(now())));
      } catch {
        throw unavailable();
      }
    },
  };
}
