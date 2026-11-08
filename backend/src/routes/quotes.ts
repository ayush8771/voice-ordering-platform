/**
 * `POST /api/v1/quotes`.
 *
 * Requires an ordering session. The route does transport only: validation and
 * all pricing live in the quote service (docs/ARCHITECTURE.md section 5).
 *
 * A quote creates no order and changes no payment state.
 */

import { Router } from 'express';
import {
  getOrderingSession,
  requireOrderingSession,
} from '../middleware/orderingSession.js';
import type { QuoteService } from '../services/quote/quoteService.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';

export function createQuoteRouter(
  quoteService: QuoteService,
  sessions: OrderingSessionService,
): Router {
  const router = Router();

  router.post('/quotes', requireOrderingSession(sessions), async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const quote = await quoteService.createQuote(req.body, {
        sessionId: session.sessionId,
        outletId: session.outletId,
      });

      res.status(200).json(quote);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
