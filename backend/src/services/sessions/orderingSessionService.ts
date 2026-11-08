/**
 * Anonymous, outlet-scoped ordering sessions (docs/SECURITY.md section 1).
 *
 * A session ID is an unguessable bearer capability: 256 bits from the CSPRNG,
 * never logged, never placed in a URL or QR code. Logs carry a hashed
 * reference instead, the same approach the conversation service uses.
 *
 * In memory and bounded. Persisting customer drafts is undecided
 * (docs/DATABASE.md section 2), so a restart simply ends open sessions, which
 * is safe: no order exists until a customer confirms one.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Channel, CreateOrderingSessionResponse } from '@vop/shared';
import { CHANNELS } from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';

export interface OrderingSession {
  readonly sessionId: string;
  readonly sessionRef: string;
  readonly outletId: string;
  readonly channel: Channel;
  readonly createdAtMs: number;
  /** Absolute deadline: the session dies here however active it has been. */
  readonly expiresAtMs: number;
  /** Last successful authentication, which is what the idle window measures. */
  readonly lastSeenAtMs: number;
  /** Idle deadline, never later than `expiresAtMs`. */
  readonly idleExpiresAtMs: number;
}

export interface OrderingSessionService {
  create(outletId: string, channel: Channel): CreateOrderingSessionResponse;
  /**
   * Returns the live session, or undefined when unknown or expired.
   *
   * A successful lookup slides the idle window forward, so this is the
   * authentication step and not a pure read.
   */
  find(sessionId: string): OrderingSession | undefined;
  end(sessionId: string): void;
  size(): number;
}

/**
 * Absolute cap. A session is unusable this long after creation no matter how
 * active the customer has been, which bounds the lifetime of a leaked token.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Idle window, slid forward by every authenticated request.
 *
 * The absolute cap alone is not enough for the kiosk case: a customer who
 * walks away one minute into a session would otherwise leave a working bearer
 * token on that screen for the remaining 29 minutes. Ten minutes is long
 * enough for a customer who pauses to read the menu or talk to someone, and
 * short enough that an abandoned kiosk stops being a usable capability
 * (docs/SECURITY.md section 1).
 *
 * This is a backend-only tightening: `expiresAt` in the create response is
 * still the absolute deadline, so it remains the latest time a session can
 * work and no documented field changes meaning.
 */
export const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

export const DEFAULT_MAX_SESSIONS = 5000;

export function deriveSessionRef(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}

/** Validates the request body for `POST /api/v1/ordering-sessions`. */
export function validateCreateSessionBody(body: unknown): {
  readonly outletId: string;
  readonly channel: Channel;
} {
  if (typeof body !== 'object' || body === null) {
    throw ApiError.validation('A session request object is required');
  }
  const raw = body as Record<string, unknown>;

  const outletId = typeof raw['outletId'] === 'string' ? raw['outletId'].trim() : '';
  if (outletId === '') throw ApiError.validation('outletId is required');

  const channel = raw['channel'];
  if (typeof channel !== 'string' || !CHANNELS.includes(channel as Channel)) {
    throw ApiError.validation(`channel must be one of ${CHANNELS.join(', ')}`);
  }

  return { outletId, channel: channel as Channel };
}

export function createOrderingSessionService(
  options: {
    /** Absolute lifetime. */
    readonly ttlMs?: number;
    /** Idle lifetime, slid forward on each successful `find`. */
    readonly idleTtlMs?: number;
    readonly maxSessions?: number;
    readonly now?: () => number;
  } = {},
): OrderingSessionService {
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const idleTtlMs = options.idleTtlMs ?? SESSION_IDLE_TTL_MS;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, OrderingSession>();

  /** Expired on either deadline. */
  function isExpired(session: OrderingSession, current: number): boolean {
    return session.expiresAtMs <= current || session.idleExpiresAtMs <= current;
  }

  function prune(): void {
    const current = now();
    for (const [sessionId, session] of sessions) {
      if (isExpired(session, current)) sessions.delete(sessionId);
    }
  }

  return {
    create(outletId, channel) {
      prune();
      if (sessions.size >= maxSessions) {
        // Refuse rather than evict: evicting would silently break a customer
        // who is mid-order (docs/ARCHITECTURE.md section 6).
        throw ApiError.unavailable('Too many active ordering sessions. Please retry.');
      }

      const sessionId = randomBytes(32).toString('base64url');
      const createdAtMs = now();
      const expiresAtMs = createdAtMs + ttlMs;
      const session: OrderingSession = {
        sessionId,
        sessionRef: deriveSessionRef(sessionId),
        outletId,
        channel,
        createdAtMs,
        expiresAtMs,
        lastSeenAtMs: createdAtMs,
        idleExpiresAtMs: Math.min(createdAtMs + idleTtlMs, expiresAtMs),
      };
      sessions.set(sessionId, session);

      return {
        sessionId,
        outletId,
        channel,
        expiresAt: new Date(session.expiresAtMs).toISOString(),
      };
    },

    find(sessionId) {
      const session = sessions.get(sessionId);
      if (session === undefined) return undefined;

      const current = now();
      if (isExpired(session, current)) {
        sessions.delete(sessionId);
        return undefined;
      }

      // Slide the idle window, never past the absolute deadline.
      const refreshed: OrderingSession = {
        ...session,
        lastSeenAtMs: current,
        idleExpiresAtMs: Math.min(current + idleTtlMs, session.expiresAtMs),
      };
      sessions.set(sessionId, refreshed);
      return refreshed;
    },

    end(sessionId) {
      sessions.delete(sessionId);
    },

    size() {
      prune();
      return sessions.size;
    },
  };
}
