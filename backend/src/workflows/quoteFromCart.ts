/**
 * Quoting the server-held draft, not a client-resent copy of it.
 *
 * docs/API.md keeps `POST /api/v1/quotes` as an independent, client-supplied
 * selection - useful for a client that holds its own draft - but says nothing
 * ties a quote to the session's actual cart. A client building its review
 * screen from the cart (docs/UX_FLOWS.md flow 3) would otherwise have to
 * re-serialize `CartLine[]` into `QuoteRequest.items[]` by hand, and nothing
 * stops that copy from drifting from the draft the customer actually edited.
 *
 * This workflow closes that gap the same way `conversationTurn.ts` closes the
 * model-to-draft one: an application-level function above both services,
 * neither of which depends on the other. It reads the authoritative draft
 * through the cart service and quotes exactly those lines through the
 * ordinary quote service - the same pricing and validation path a
 * client-supplied quote request takes, so a cart total and a quote total for
 * the same draft can never disagree.
 *
 * Checked here, before the quote service ever sees the request:
 * - **the draft is empty** - `quoteService.createQuote` already refuses an
 *   empty `items` array, so this only gives it the clearer, cart-specific
 *   message a customer facing an empty cart should see;
 * - **the draft has a line that cannot be ordered right now** - refused as a
 *   single `409` naming every such line, which is the server-side form of the
 *   obligation docs/UX_FLOWS.md flow 2 puts on a client ("block checkout ...
 *   while any such line remains, and say that is why"). Without this check a
 *   bad line would still be refused - `assertSelection` inside the quote
 *   service rejects it too - but only the first one found, and with the
 *   quote service's generic wording rather than the cart's own issue reasons.
 */

import type { QuoteResponse } from '@vop/shared';
import { ApiError } from '../middleware/errors.js';
import type { CartService, CartSessionScope } from '../services/cart/cartService.js';
import type { QuoteService } from '../services/quote/quoteService.js';

export interface QuoteFromCartDeps {
  readonly cartService: CartService;
  readonly quoteService: QuoteService;
}

export async function createQuoteFromCart(
  deps: QuoteFromCartDeps,
  scope: CartSessionScope,
): Promise<QuoteResponse> {
  const cart = await deps.cartService.getCart(scope);

  if (cart.items.length === 0) {
    throw ApiError.validation(
      'The draft is empty. Add an item before requesting a quote.',
    );
  }

  if (cart.hasUnavailableItems) {
    throw ApiError.conflict(
      'Resolve the unavailable draft items before requesting a quote',
      cart.items
        .filter((line) => !line.available)
        .map((line) => ({ menuItemId: line.menuItemId, lineId: line.lineId })),
    );
  }

  // Selections only - no price, name or lineId travels into the quote
  // request, exactly what a hand-built `QuoteRequest` would carry.
  return deps.quoteService.createQuote(
    {
      outletId: scope.outletId,
      items: cart.items.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        optionIds: line.optionIds,
      })),
    },
    { sessionId: scope.sessionId, outletId: scope.outletId },
  );
}
