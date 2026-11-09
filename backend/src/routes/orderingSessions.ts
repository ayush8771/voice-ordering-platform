/**
 * `POST /api/v1/ordering-sessions` and `DELETE /api/v1/ordering-sessions`.
 *
 * `POST` creates the anonymous, outlet-scoped capability that customer
 * ordering endpoints require. The outlet must exist and be active, so a
 * session cannot be minted for an outlet that is not taking orders.
 *
 * The response body carries the session ID once; it is never logged
 * (docs/SECURITY.md section 5).
 *
 * `DELETE` is the explicit revocation route docs/SECURITY.md section 1 and
 * docs/DATABASE.md section 2 record as missing: `workflows/endOrderingSession.ts`
 * already supports ending a session and clearing its draft, but nothing
 * exposed it, so "end my order" could not revoke the capability early and a
 * leaked token stayed live until its own TTL. Wired here, plus the
 * conversation session's in-memory state when a conversational provider is
 * configured, so nothing about a closed session lingers except the
 * commercial order record itself.
 */

import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import { isValidPublicId } from '../models/menu.js';
import type { CartStore } from '../services/cart/cartStore.js';
import type { ConversationService } from '../services/conversation/service.js';
import type { MenuService } from '../services/menu/menuService.js';
import {
  validateCreateSessionBody,
  type OrderingSessionService,
} from '../services/sessions/orderingSessionService.js';
import { endOrderingSession } from '../workflows/endOrderingSession.js';

/** Reads `Authorization: Bearer <sessionId>`, tolerating header case. */
function readBearer(header: unknown): string {
  if (typeof header !== 'string') return '';
  return /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? '';
}

export function createOrderingSessionRouter(
  sessions: OrderingSessionService,
  menuService: MenuService,
  cartStore: CartStore,
  /** Absent when no conversational provider is configured. */
  conversationService?: ConversationService,
): Router {
  const router = Router();

  router.post('/ordering-sessions', async (req, res, next) => {
    try {
      const { outletId, channel } = validateCreateSessionBody(req.body);

      // Bounded before it reaches a query, exactly as on the menu route. A
      // malformed ID is reported as not found rather than as a 400, so the
      // response does not describe the ID format to a prober and an unknown,
      // inactive and malformed outlet stay indistinguishable.
      if (!isValidPublicId(outletId)) {
        throw ApiError.notFound('Outlet not found');
      }

      // Resolves the outlet through the menu service, which already reports an
      // unknown or inactive outlet as 404 without disclosing which.
      await menuService.getSnapshot(outletId);

      const created = await sessions.create(outletId, channel);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/ordering-sessions', async (req, res, next) => {
    try {
      const sessionId = readBearer(req.headers.authorization);
      if (sessionId === '') {
        throw ApiError.unauthorized('An ordering session bearer token is required');
      }

      // Deliberately not behind `requireOrderingSession`: ending an already
      // expired or already-ended session must still succeed, because the
      // whole point is a customer or client that calls this defensively on
      // close. Both underlying deletes are idempotent (docs/DATABASE.md
      // section 2), so this never discloses whether the session was live.
      await endOrderingSession({ sessions, cartStore }, sessionId);
      conversationService?.endSession(sessionId);

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
