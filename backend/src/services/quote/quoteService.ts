/**
 * Quote service: the only place a price is calculated.
 *
 * Rules (docs/API.md, docs/SECURITY.md section 2, docs/DATABASE.md section 4):
 * - the client sends item IDs, option IDs and quantities, and nothing else;
 *   any price-looking field in the request is ignored, never read;
 * - every amount is derived from the current menu snapshot;
 * - arithmetic is integer paise only;
 * - an unknown item or option is a 422, an existing-but-unavailable item or
 *   option is a 409, so the client can tell "wrong" from "sold out";
 * - a quote is not an order: it creates nothing and commits nothing.
 */

import { randomUUID } from 'node:crypto';
import {
  MAX_LINE_QUANTITY,
  MAX_QUOTE_LINES,
  type QuoteLine,
  type QuoteRequest,
  type QuoteResponse,
} from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import type { MenuItemDoc } from '../../models/menu.js';
import { addMinor, assertMinorUnits, multiplyMinor } from '../../models/money.js';
import type { MenuService, MenuSnapshot } from '../menu/menuService.js';
import type { QuoteStore } from './quoteStore.js';

/** The authenticated session a quote is issued to. */
export interface QuoteSessionScope {
  readonly sessionId: string;
  readonly outletId: string;
}

export interface QuoteService {
  /**
   * Prices a draft for one outlet-scoped session.
   *
   * The scope comes from the authenticated session, never from the request
   * body, so a client cannot quote against another outlet.
   */
  createQuote(
    request: QuoteRequest,
    session: QuoteSessionScope,
  ): Promise<QuoteResponse>;
}

export interface QuoteServiceDeps {
  readonly menuService: MenuService;
  readonly quoteStore: QuoteStore;
  readonly now?: () => number;
}

/** How long a quote may be presented before it must be refreshed. */
export const QUOTE_TTL_MS = 5 * 60 * 1000;

/** Prices one unit: item price plus every selected option delta. */
function priceLine(
  item: MenuItemDoc,
  optionIds: readonly string[],
): { readonly unitPriceMinor: number; readonly optionIds: readonly string[] } {
  const options = item.options ?? [];
  let unitPriceMinor = assertMinorUnits(
    item.priceMinor,
    `menuItem ${item.publicId} priceMinor`,
  );

  for (const optionId of optionIds) {
    const option = options.find((candidate) => candidate.publicId === optionId);
    if (option === undefined) {
      throw ApiError.unprocessable('Selected option does not exist for this item', [
        { menuItemId: item.publicId, optionId },
      ]);
    }
    if (!option.active) {
      throw ApiError.conflict('Selected option is unavailable', [
        { menuItemId: item.publicId, optionId },
      ]);
    }

    // A delta may be negative, so the running total is checked rather than
    // assumed: a misconfigured discount must not produce a negative price.
    const next = unitPriceMinor + option.priceDeltaMinor;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw ApiError.conflict('This combination cannot be priced', [
        { menuItemId: item.publicId, optionId },
      ]);
    }
    unitPriceMinor = next;
  }

  return { unitPriceMinor, optionIds };
}

/** Validates the request body shape before any menu work. */
function validateRequest(request: unknown): QuoteRequest {
  if (typeof request !== 'object' || request === null) {
    throw ApiError.validation('A quote request object is required');
  }

  const body = request as Record<string, unknown>;
  const outletId = typeof body['outletId'] === 'string' ? body['outletId'].trim() : '';
  if (outletId === '') {
    throw ApiError.validation('outletId is required');
  }

  const rawItems = body['items'];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw ApiError.validation('items must be a non-empty array');
  }
  if (rawItems.length > MAX_QUOTE_LINES) {
    throw ApiError.validation(`items must contain at most ${MAX_QUOTE_LINES} lines`);
  }

  const items = rawItems.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw ApiError.validation(`items[${index}] must be an object`);
    }
    const line = raw as Record<string, unknown>;

    const menuItemId =
      typeof line['menuItemId'] === 'string' ? line['menuItemId'].trim() : '';
    if (menuItemId === '') {
      throw ApiError.validation(`items[${index}].menuItemId is required`);
    }

    const quantity = line['quantity'];
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_LINE_QUANTITY
    ) {
      throw ApiError.validation(
        `items[${index}].quantity must be an integer 1-${MAX_LINE_QUANTITY}`,
      );
    }

    const rawOptions = line['optionIds'];
    if (rawOptions !== undefined && !Array.isArray(rawOptions)) {
      throw ApiError.validation(`items[${index}].optionIds must be an array`);
    }
    const optionIds = (rawOptions ?? []).map((option, optionIndex) => {
      if (typeof option !== 'string' || option.trim() === '') {
        throw ApiError.validation(
          `items[${index}].optionIds[${optionIndex}] must be a non-empty string`,
        );
      }
      return option.trim();
    });

    if (new Set(optionIds).size !== optionIds.length) {
      throw ApiError.validation(`items[${index}].optionIds must not repeat an option`);
    }

    return { menuItemId, quantity, optionIds };
  });

  return { outletId, items };
}

function buildLine(
  snapshot: MenuSnapshot,
  requested: {
    menuItemId: string;
    quantity: number;
    optionIds: readonly string[];
  },
): QuoteLine {
  const item = snapshot.itemsById.get(requested.menuItemId);
  if (item === undefined) {
    throw ApiError.unprocessable('Selected item is not on this menu', [
      { menuItemId: requested.menuItemId },
    ]);
  }
  if (!item.active) {
    throw ApiError.conflict('Selected item is unavailable', [
      { menuItemId: requested.menuItemId },
    ]);
  }

  const { unitPriceMinor } = priceLine(item, requested.optionIds);

  return {
    menuItemId: item.publicId,
    // The name is snapshotted from the menu, never echoed from the client.
    name: item.name,
    quantity: requested.quantity,
    optionIds: requested.optionIds,
    unitPriceMinor,
    lineTotalMinor: multiplyMinor(
      unitPriceMinor,
      requested.quantity,
      `line ${item.publicId}`,
    ),
  };
}

export function createQuoteService(deps: QuoteServiceDeps): QuoteService {
  const now = deps.now ?? Date.now;

  return {
    async createQuote(
      rawRequest: QuoteRequest,
      session: QuoteSessionScope,
    ): Promise<QuoteResponse> {
      const request = validateRequest(rawRequest);

      if (request.outletId !== session.outletId) {
        // The session is valid but scoped elsewhere (docs/SECURITY.md section 1).
        throw ApiError.forbidden('This session cannot quote for that outlet');
      }

      const snapshot = await deps.menuService.getSnapshot(request.outletId);

      const items = request.items.map((requested) =>
        buildLine(snapshot, {
          menuItemId: requested.menuItemId,
          quantity: requested.quantity,
          optionIds: requested.optionIds ?? [],
        }),
      );

      const subtotalMinor = items.reduce(
        (total, line) => addMinor(total, line.lineTotalMinor, 'subtotalMinor'),
        0,
      );

      const createdAt = now();
      const response: QuoteResponse = {
        quoteId: randomUUID(),
        outletId: request.outletId,
        menuVersion: snapshot.menuVersion,
        items,
        subtotalMinor,
        // No tax or service-charge rule is configured; charge rules are an open
        // decision (docs/PRD.md section 9). The total is kept as its own field
        // so adding one later is not a breaking contract change.
        totalMinor: subtotalMinor,
        currency: snapshot.outlet.currency,
        expiresAt: new Date(createdAt + QUOTE_TTL_MS).toISOString(),
      };

      deps.quoteStore.put(response, session.sessionId);
      return response;
    },
  };
}
