/**
 * Order routes.
 *
 *   POST /api/v1/orders              confirm and create an order
 *   GET  /api/v1/orders/:orderId     track one order
 *
 * `POST` requires an ordering session (`Authorization: Bearer <sessionId>`)
 * and an `Idempotency-Key` header. `201` for a new order, `200` for an
 * idempotent replay.
 *
 * `GET` deliberately does **not** require an ordering session. docs/API.md
 * scopes it to the session, but a session expires 30 minutes after it starts
 * while the customer may still be waiting for food, so the order carries its
 * own read capability, issued once at creation and stored only as a hash:
 * `Authorization: Bearer <orderAccessToken>`. NEEDS JOINT AGREEMENT. Staff
 * access to an order is a separate route and needs the staff authentication
 * mechanism docs/API.md records as undecided.
 *
 * Transport only: every rule lives in the order service and the confirm
 * workflow (docs/ARCHITECTURE.md section 5). No route here verifies a payment.
 */

import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import {
  getOrderingSession,
  requireOrderingSession,
} from '../middleware/orderingSession.js';
import type { CartStore } from '../services/cart/cartStore.js';
import {
  validateIdempotencyKey,
  type OrderService,
} from '../services/orders/orderService.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';
import { confirmOrder } from '../workflows/confirmOrder.js';

/** Reads `Authorization: Bearer <token>`, tolerating header case. */
function readBearer(header: unknown): string {
  if (typeof header !== 'string') return '';
  return /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? '';
}

export function createOrderRouter(
  orderService: OrderService,
  cartStore: CartStore,
  sessions: OrderingSessionService,
): Router {
  const router = Router();

  router.post('/orders', requireOrderingSession(sessions), async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const idempotencyKey = validateIdempotencyKey(req.headers['idempotency-key']);

      const result = await confirmOrder(
        { orderService, cartStore },
        {
          body: req.body,
          scope: {
            sessionId: session.sessionId,
            sessionRef: session.sessionRef,
            outletId: session.outletId,
            channel: session.channel,
          },
          idempotencyKey,
        },
      );

      res.status(result.created ? 201 : 200).json(result.order);
    } catch (error) {
      next(error);
    }
  });

  router.get('/orders/:orderId', async (req, res, next) => {
    try {
      const accessToken = readBearer(req.headers.authorization);
      if (accessToken === '') {
        throw ApiError.unauthorized('An order access token is required');
      }

      res
        .status(200)
        .json(await orderService.getOrder(req.params.orderId, accessToken));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
