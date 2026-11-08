/**
 * Quote pricing and validation.
 *
 * These are the money tests: anything that could let a client influence a
 * price, or let an unavailable selection be priced, belongs here
 * (docs/TESTING.md sections 2 and 3).
 */

import { describe, expect, it } from 'vitest';
import { MAX_LINE_QUANTITY, MAX_QUOTE_LINES } from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../menu/inMemoryMenuRepository.js';
import { createMenuService } from '../menu/menuService.js';
import { createQuoteService, QUOTE_TTL_MS } from './quoteService.js';
import { createQuoteStore } from './quoteStore.js';

const SESSION = { sessionId: 'sess_1', outletId: 'demo-outlet' };

function service(nowMs = 1_700_000_000_000) {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const quoteStore = createQuoteStore(100, () => nowMs);
  return {
    quoteStore,
    quoteService: createQuoteService({ menuService, quoteStore, now: () => nowMs }),
  };
}

async function quoteError(body: unknown): Promise<ApiError> {
  const { quoteService } = service();
  const error = await quoteService
    .createQuote(body as never, SESSION)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('pricing', () => {
  it('prices a single line from the current menu', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      { outletId: 'demo-outlet', items: [{ menuItemId: 'item-idli', quantity: 3 }] },
      SESSION,
    );

    expect(quote.items).toEqual([
      {
        menuItemId: 'item-idli',
        name: 'Idli',
        quantity: 3,
        optionIds: [],
        unitPriceMinor: 4000,
        lineTotalMinor: 12000,
      },
    ]);
    expect(quote.subtotalMinor).toBe(12000);
    expect(quote.totalMinor).toBe(12000);
    expect(quote.currency).toBe('INR');
  });

  it('adds every selected option delta to the unit price', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [
          {
            menuItemId: 'item-masala-dosa',
            quantity: 2,
            optionIds: ['opt-extra-chutney', 'opt-ghee'],
          },
        ],
      },
      SESSION,
    );

    // 8000 + 1000 + 2500 = 11500 per unit.
    expect(quote.items[0]?.unitPriceMinor).toBe(11500);
    expect(quote.items[0]?.lineTotalMinor).toBe(23000);
    expect(quote.subtotalMinor).toBe(23000);
  });

  it('accepts a zero-delta option without changing the price', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [
          {
            menuItemId: 'item-filter-coffee',
            quantity: 1,
            optionIds: ['opt-less-sugar'],
          },
        ],
      },
      SESSION,
    );

    expect(quote.items[0]?.unitPriceMinor).toBe(3000);
  });

  it('sums several lines and keeps submitted order without merging', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [
          { menuItemId: 'item-idli', quantity: 1 },
          { menuItemId: 'item-filter-coffee', quantity: 2 },
          { menuItemId: 'item-idli', quantity: 1 },
        ],
      },
      SESSION,
    );

    expect(quote.items.map((line) => line.menuItemId)).toEqual([
      'item-idli',
      'item-filter-coffee',
      'item-idli',
    ]);
    expect(quote.subtotalMinor).toBe(4000 + 6000 + 4000);
  });

  it('ignores any price-like field a client sends', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [
          {
            menuItemId: 'item-idli',
            quantity: 1,
            // A hostile client's attempt at a discount.
            priceMinor: 1,
            unitPriceMinor: 1,
            lineTotalMinor: 1,
          } as never,
        ],
        subtotalMinor: 1,
        totalMinor: 1,
      } as never,
      SESSION,
    );

    expect(quote.items[0]?.unitPriceMinor).toBe(4000);
    expect(quote.subtotalMinor).toBe(4000);
    expect(quote.totalMinor).toBe(4000);
  });

  it('snapshots the name from the menu, not from the request', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1, name: 'Free Idli' } as never],
      },
      SESSION,
    );

    expect(quote.items[0]?.name).toBe('Idli');
  });

  it('echoes the current menu version and an expiry', async () => {
    const nowMs = 1_700_000_000_000;
    const { quoteService } = service(nowMs);
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));

    const quote = await quoteService.createQuote(
      { outletId: 'demo-outlet', items: [{ menuItemId: 'item-idli', quantity: 1 }] },
      SESSION,
    );

    expect(quote.menuVersion).toBe(
      (await menuService.getSnapshot('demo-outlet')).menuVersion,
    );
    expect(quote.expiresAt).toBe(new Date(nowMs + QUOTE_TTL_MS).toISOString());
    expect(quote.quoteId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores the quote against the requesting session only', async () => {
    const { quoteService, quoteStore } = service();

    const quote = await quoteService.createQuote(
      { outletId: 'demo-outlet', items: [{ menuItemId: 'item-idli', quantity: 1 }] },
      SESSION,
    );

    expect(quoteStore.get(quote.quoteId, 'sess_1')?.quote.quoteId).toBe(quote.quoteId);
    expect(quoteStore.get(quote.quoteId, 'sess_other')).toBeUndefined();
  });
});

describe('availability and selection errors', () => {
  it('rejects an unknown item as 422', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-biryani', quantity: 1 }],
    });

    expect(error.status).toBe(422);
    expect(error.details).toEqual([{ menuItemId: 'item-biryani' }]);
  });

  it('rejects an unavailable item as 409', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-medu-vada', quantity: 1 }],
    });

    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });

  it('rejects an option that does not exist on the item as 422', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-idli', quantity: 1, optionIds: ['opt-ghee'] }],
    });

    expect(error.status).toBe(422);
    expect(error.details).toEqual([{ menuItemId: 'item-idli', optionId: 'opt-ghee' }]);
  });

  it('rejects an inactive option as 409', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [
        { menuItemId: 'item-masala-dosa', quantity: 1, optionIds: ['opt-seasonal'] },
      ],
    });

    expect(error.status).toBe(409);
  });

  it('rejects an item belonging to another outlet', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-poha', quantity: 1 }],
    });

    expect(error.status).toBe(422);
  });

  it('rejects a quote for an unknown outlet', async () => {
    const { quoteService } = service();

    await expect(
      quoteService.createQuote(
        { outletId: 'ghost-outlet', items: [{ menuItemId: 'item-idli', quantity: 1 }] },
        { sessionId: 'sess_1', outletId: 'ghost-outlet' },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a body outlet that differs from the session outlet', async () => {
    const { quoteService } = service();

    await expect(
      quoteService.createQuote(
        { outletId: 'other-outlet', items: [{ menuItemId: 'item-poha', quantity: 1 }] },
        SESSION,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('request validation', () => {
  it('rejects a missing or empty items array', async () => {
    expect((await quoteError({ outletId: 'demo-outlet' })).status).toBe(400);
    expect((await quoteError({ outletId: 'demo-outlet', items: [] })).status).toBe(400);
  });

  it('rejects a missing outletId', async () => {
    expect(
      (await quoteError({ items: [{ menuItemId: 'item-idli', quantity: 1 }] })).status,
    ).toBe(400);
  });

  it('rejects a non-object body', async () => {
    expect((await quoteError('give me food')).status).toBe(400);
    expect((await quoteError(null)).status).toBe(400);
  });

  it.each([0, -1, 2.5, MAX_LINE_QUANTITY + 1, '2', null])(
    'rejects quantity %p',
    async (quantity) => {
      const error = await quoteError({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity }],
      });
      expect(error.status).toBe(400);
    },
  );

  it('accepts the maximum quantity and the maximum line count', async () => {
    const { quoteService } = service();

    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: Array.from({ length: MAX_QUOTE_LINES }, () => ({
          menuItemId: 'item-idli',
          quantity: MAX_LINE_QUANTITY,
        })),
      },
      SESSION,
    );

    expect(quote.items).toHaveLength(MAX_QUOTE_LINES);
    expect(quote.subtotalMinor).toBe(4000 * MAX_LINE_QUANTITY * MAX_QUOTE_LINES);
  });

  it('rejects more lines than the cap', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: Array.from({ length: MAX_QUOTE_LINES + 1 }, () => ({
        menuItemId: 'item-idli',
        quantity: 1,
      })),
    });

    expect(error.status).toBe(400);
  });

  it('rejects a repeated option on one line', async () => {
    const error = await quoteError({
      outletId: 'demo-outlet',
      items: [
        {
          menuItemId: 'item-masala-dosa',
          quantity: 1,
          optionIds: ['opt-ghee', 'opt-ghee'],
        },
      ],
    });

    expect(error.status).toBe(400);
  });

  it('rejects malformed option lists', async () => {
    expect(
      (
        await quoteError({
          outletId: 'demo-outlet',
          items: [{ menuItemId: 'item-idli', quantity: 1, optionIds: 'opt-ghee' }],
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await quoteError({
          outletId: 'demo-outlet',
          items: [{ menuItemId: 'item-idli', quantity: 1, optionIds: [''] }],
        })
      ).status,
    ).toBe(400);
  });

  it('rejects a non-object line', async () => {
    expect(
      (await quoteError({ outletId: 'demo-outlet', items: ['item-idli'] })).status,
    ).toBe(400);
  });
});

describe('negative and oversized amounts', () => {
  it('refuses a combination that would price below zero', async () => {
    const dataset = {
      ...SAMPLE_MENU,
      items: [
        {
          publicId: 'item-weird',
          outletId: 'demo-outlet',
          name: 'Misconfigured',
          priceMinor: 1000,
          currency: 'INR' as const,
          active: true,
          sortOrder: 1,
          options: [
            {
              publicId: 'opt-too-big-discount',
              label: 'Bad discount',
              priceDeltaMinor: -5000,
              active: true,
            },
          ],
        },
      ],
    };
    const menuService = createMenuService(createInMemoryMenuRepository(dataset));
    const quoteService = createQuoteService({
      menuService,
      quoteStore: createQuoteStore(),
    });

    await expect(
      quoteService.createQuote(
        {
          outletId: 'demo-outlet',
          items: [
            {
              menuItemId: 'item-weird',
              quantity: 1,
              optionIds: ['opt-too-big-discount'],
            },
          ],
        },
        SESSION,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a line total beyond the supported maximum', async () => {
    const dataset = {
      ...SAMPLE_MENU,
      items: [
        {
          publicId: 'item-huge',
          outletId: 'demo-outlet',
          name: 'Huge',
          priceMinor: 200_000_000,
          currency: 'INR' as const,
          active: true,
          sortOrder: 1,
        },
      ],
    };
    const menuService = createMenuService(createInMemoryMenuRepository(dataset));
    const quoteService = createQuoteService({
      menuService,
      quoteStore: createQuoteStore(),
    });

    await expect(
      quoteService.createQuote(
        {
          outletId: 'demo-outlet',
          items: [{ menuItemId: 'item-huge', quantity: 5 }],
        },
        SESSION,
      ),
    ).rejects.toThrow(/exceeds the maximum supported amount/);
  });
});
