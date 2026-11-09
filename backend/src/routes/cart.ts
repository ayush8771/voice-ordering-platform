/**
 * Cart draft routes. All require an ordering session; the draft is the
 * session's own and the session's outlet is the only scope
 * (docs/SECURITY.md section 1).
 *
 * NEEDS JOINT AGREEMENT: docs/API.md has no cart endpoints. These are additive
 * - `POST /api/v1/quotes` is unchanged and a client may keep holding its draft
 * locally - but a server-side draft is what lets the shared conversational
 * layer amend the same draft the touch UI shows.
 *
 *   GET    /api/v1/cart                 current draft, priced from the live menu
 *   POST   /api/v1/cart/items           add a selection (merges an identical one)
 *   PATCH  /api/v1/cart/items/:lineId   change quantity, optionally options
 *   DELETE /api/v1/cart/items/:lineId   remove one line
 *   DELETE /api/v1/cart                 clear every line
 *   POST   /api/v1/cart/quote           quote the draft as it stands, for confirmation
 *
 * Transport only: validation, pricing and all draft rules live in the cart and
 * quote services (docs/ARCHITECTURE.md section 5). No endpoint here creates an
 * order or touches payment state.
 *
 * `POST /api/v1/cart/quote` is `workflows/quoteFromCart.ts`: it quotes the
 * session's own stored draft rather than requiring the caller to resend its
 * lines to `POST /api/v1/quotes`, which is the only way today a quote is
 * guaranteed to match what the cart endpoints actually show the customer.
 *
 * `?lang=en|kn|hi` on any of them sets `CartLine.displayName` (and the display
 * names of the quote `POST /cart/quote` issues). It is display only: the stored
 * draft, the prices and every validation rule are identical whatever it says.
 *
 * Optimistic concurrency: send `If-Match: <revision>` on a mutation to have it
 * refused with `409` if the draft moved since the caller read it. Omitting the
 * header means "apply to whatever is there", which is still safe because
 * mutations for one session are serialized server-side.
 */

import { Router, type Request } from 'express';
import type { AddCartItemRequest, UpdateCartItemRequest } from '@vop/shared';
import { ApiError } from '../middleware/errors.js';
import {
  getOrderingSession,
  requireOrderingSession,
} from '../middleware/orderingSession.js';
import { readLanguageParam } from '../models/language.js';
import type {
  CartMutationOptions,
  CartService,
  CartSessionScope,
} from '../services/cart/cartService.js';
import type { QuoteService } from '../services/quote/quoteService.js';
import type {
  OrderingSession,
  OrderingSessionService,
} from '../services/sessions/orderingSessionService.js';
import { createQuoteFromCart } from '../workflows/quoteFromCart.js';

/** Longest `lineId` accepted before it is looked up: a UUID is 36 characters. */
const MAX_LINE_ID_CHARS = 64;

function readMutationOptions(req: Request): CartMutationOptions {
  const language = readLanguageParam(req.query['lang']);
  const header = req.headers['if-match'];

  if (header === undefined) return { language };
  if (typeof header !== 'string') {
    throw ApiError.validation('If-Match must be a single draft revision');
  }

  // Weak validators and entity-tag quoting are not accepted: the value is the
  // `revision` integer from a cart response, verbatim.
  const revision = Number(header.trim());
  if (!Number.isInteger(revision) || revision < 0) {
    throw ApiError.validation('If-Match must be a draft revision number');
  }
  return { expectedRevision: revision, language };
}

function readLineId(raw: unknown): string {
  const lineId = typeof raw === 'string' ? raw.trim() : '';
  if (lineId === '' || lineId.length > MAX_LINE_ID_CHARS) {
    // Reported as absent rather than as a 400, so a prober learns nothing
    // about the ID format from a malformed value.
    throw ApiError.notFound('Draft line not found');
  }
  return lineId;
}

/**
 * The draft scope, taken only from the authenticated session.
 *
 * `expiresAtMs` travels with it so the store can clamp a draft's deadline to
 * the session's; no request can widen it.
 */
function toScope(session: OrderingSession): CartSessionScope {
  return {
    sessionId: session.sessionId,
    outletId: session.outletId,
    expiresAtMs: session.expiresAtMs,
  };
}

/** Rejects a body that names an outlet other than the session's. */
function assertOutletScope(body: unknown, outletId: string): void {
  if (typeof body !== 'object' || body === null) return;
  const candidate = (body as Record<string, unknown>)['outletId'];
  if (candidate === undefined) return;
  if (candidate !== outletId) {
    throw ApiError.forbidden('This session cannot edit a draft for that outlet');
  }
}

export function createCartRouter(
  cartService: CartService,
  quoteService: QuoteService,
  sessions: OrderingSessionService,
): Router {
  const router = Router();
  router.use('/cart', requireOrderingSession(sessions));

  router.get('/cart', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const language = readLanguageParam(req.query['lang']);
      res.status(200).json(await cartService.getCart(toScope(session), { language }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/cart/items', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      assertOutletScope(req.body, session.outletId);

      // The body is handed to the service unvalidated on purpose: it owns the
      // rules, exactly as the quote route does.
      const cart = await cartService.addItem(
        toScope(session),
        req.body as AddCartItemRequest,
        readMutationOptions(req),
      );

      res.status(200).json(cart);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/cart/items/:lineId', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      assertOutletScope(req.body, session.outletId);

      const cart = await cartService.updateItem(
        toScope(session),
        readLineId(req.params.lineId),
        req.body as UpdateCartItemRequest,
        readMutationOptions(req),
      );

      res.status(200).json(cart);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/cart/items/:lineId', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const cart = await cartService.removeItem(
        toScope(session),
        readLineId(req.params.lineId),
        readMutationOptions(req),
      );

      res.status(200).json(cart);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/cart', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const cart = await cartService.clear(toScope(session), readMutationOptions(req));

      res.status(200).json(cart);
    } catch (error) {
      next(error);
    }
  });

  router.post('/cart/quote', async (req, res, next) => {
    try {
      const session = getOrderingSession(req);
      const quote = await createQuoteFromCart(
        { cartService, quoteService },
        toScope(session),
        readLanguageParam(req.query['lang']),
      );
      res.status(200).json(quote);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
