/**
 * `POST /api/v1/quotes`.
 *
 * Requires an ordering session. The route does transport only: validation and
 * all pricing live in the quote service (docs/ARCHITECTURE.md section 5).
 *
 * A quote creates no order and changes no payment state.
 *
 * `?lang=en|kn|hi` sets the quote's display names and its recorded language;
 * omitting it means English. Prices, totals and validation do not depend on it.
 */

import { Router } from 'express';
import {
  getOrderingSession,
  requireOrderingSession,
} from '../middleware/orderingSession.js';
import { readLanguageParam } from '../models/language.js';
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
      const quote = await quoteService.createQuote(
        req.body,
        {
          sessionId: session.sessionId,
          outletId: session.outletId,
        },
        // `?lang=`, as on the menu: the language the customer is reviewing in,
        // and the one recorded on the order they confirm from this quote.
        readLanguageParam(req.query['lang']),
      );

      res.status(200).json(quote);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
