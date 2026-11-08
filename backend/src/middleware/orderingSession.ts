/**
 * Ordering-session authentication for customer endpoints.
 *
 * NEEDS JOINT AGREEMENT: docs/API.md leaves session transport open. The
 * implemented choice is `Authorization: Bearer <sessionId>`:
 * - a header keeps the capability out of URLs and server access logs, where a
 *   query parameter would land (docs/SECURITY.md section 5);
 * - it is not a cookie, so no CSRF defence is required for cross-origin kiosk
 *   and QR clients (docs/SECURITY.md section 4).
 *
 * The session ID itself is never logged. `req.orderingSession.sessionRef` is
 * the hashed value safe to log.
 */

import type { RequestHandler } from 'express';
import { ApiError } from './errors.js';
import type {
  OrderingSession,
  OrderingSessionService,
} from '../services/sessions/orderingSessionService.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Present only on routes guarded by `requireOrderingSession`. */
    orderingSession?: OrderingSession;
  }
}

/** Reads `Authorization: Bearer <sessionId>`, tolerating header case. */
function readBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

export function requireOrderingSession(
  sessions: OrderingSessionService,
): RequestHandler {
  return (req, _res, next) => {
    const sessionId = readBearer(req.headers.authorization);
    if (sessionId === undefined) {
      next(ApiError.unauthorized('An ordering session bearer token is required'));
      return;
    }

    const session = sessions.find(sessionId);
    if (session === undefined) {
      // Unknown and expired are reported identically, so a caller cannot
      // distinguish a wrong guess from a timed-out session.
      next(ApiError.unauthorized('Ordering session is invalid or has expired'));
      return;
    }

    req.orderingSession = session;
    next();
  };
}

/** Narrows the optional request field for handlers behind the guard. */
export function getOrderingSession(req: {
  orderingSession?: OrderingSession;
}): OrderingSession {
  if (req.orderingSession === undefined) {
    // Reaching this means a route was mounted without the guard.
    throw new Error('Route requires requireOrderingSession middleware');
  }
  return req.orderingSession;
}
