/**
 * `POST /api/v1/ordering-sessions`.
 *
 * Creates the anonymous, outlet-scoped capability that customer ordering
 * endpoints require. The outlet must exist and be active, so a session cannot
 * be minted for an outlet that is not taking orders.
 *
 * The response body carries the session ID once; it is never logged
 * (docs/SECURITY.md section 5).
 */

import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import { isValidPublicId } from '../models/menu.js';
import type { MenuService } from '../services/menu/menuService.js';
import {
  validateCreateSessionBody,
  type OrderingSessionService,
} from '../services/sessions/orderingSessionService.js';

export function createOrderingSessionRouter(
  sessions: OrderingSessionService,
  menuService: MenuService,
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

      const created = sessions.create(outletId, channel);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
