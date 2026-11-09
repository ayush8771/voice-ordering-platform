/**
 * Cart-to-quote consistency: a quote built from the server-held draft rather
 * than a client-resent copy of it (docs/API.md "Cart draft endpoints").
 *
 * Real cart, menu and quote services throughout; nothing here is faked.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../models/menu.js';
import {
  compareListingOrder,
  type MenuRepository,
} from '../services/menu/menuRepository.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { createMenuService } from '../services/menu/menuService.js';
import { createCartService, type CartService } from '../services/cart/cartService.js';
import { createCartStore } from '../services/cart/cartStore.js';
import {
  createQuoteService,
  type QuoteService,
} from '../services/quote/quoteService.js';
import { createQuoteStore } from '../services/quote/quoteStore.js';
import { createQuoteFromCart } from './quoteFromCart.js';

const SCOPE = {
  sessionId: 'session-a',
  outletId: 'demo-outlet',
  expiresAtMs: Number.MAX_SAFE_INTEGER,
} as const;

/** Mutable dataset, so a test can take an item off the menu mid-draft. */
interface MutableDataset {
  outlets: OutletDoc[];
  categories: MenuCategoryDoc[];
  items: MenuItemDoc[];
}

let dataset: MutableDataset;

function repository(): MenuRepository {
  return {
    findActiveOutlet(outletId) {
      return Promise.resolve(
        dataset.outlets.find((outlet) => outlet.publicId === outletId && outlet.active),
      );
    },
    listCategories(outletId) {
      return Promise.resolve(
        dataset.categories
          .filter((category) => category.outletId === outletId && category.active)
          .sort(compareListingOrder),
      );
    },
    listItems(outletId) {
      return Promise.resolve(
        dataset.items
          .filter((item) => item.outletId === outletId)
          .sort(compareListingOrder),
      );
    },
  };
}

/** Replaces one item in the mutable dataset, in place for every service below. */
function patchItem(publicId: string, patch: Partial<MenuItemDoc>): void {
  dataset.items = dataset.items.map((item) =>
    item.publicId === publicId ? { ...item, ...patch } : item,
  );
}

function harness(): { cartService: CartService; quoteService: QuoteService } {
  const menuService = createMenuService(repository());
  const cartService = createCartService({ menuService, cartStore: createCartStore() });
  const quoteService = createQuoteService({
    menuService,
    quoteStore: createQuoteStore(),
  });
  return { cartService, quoteService };
}

beforeEach(() => {
  dataset = {
    outlets: [...SAMPLE_MENU.outlets],
    categories: [...SAMPLE_MENU.categories],
    items: [...SAMPLE_MENU.items],
  };
});

describe('createQuoteFromCart', () => {
  it('quotes exactly the lines in the stored draft, priced by the server', async () => {
    const { cartService, quoteService } = harness();
    await cartService.addItem(SCOPE, { menuItemId: 'item-masala-dosa', quantity: 2 });
    await cartService.addItem(SCOPE, { menuItemId: 'item-idli', quantity: 1 });

    const quote = await createQuoteFromCart({ cartService, quoteService }, SCOPE);

    expect(quote.items).toEqual([
      expect.objectContaining({ menuItemId: 'item-masala-dosa', quantity: 2 }),
      expect.objectContaining({ menuItemId: 'item-idli', quantity: 1 }),
    ]);
    expect(quote.totalMinor).toBe(8000 * 2 + 4000);
    expect(quote.outletId).toBe('demo-outlet');
  });

  it('matches the total a separately-read cart would show', async () => {
    const { cartService, quoteService } = harness();
    await cartService.addItem(SCOPE, { menuItemId: 'item-masala-dosa', quantity: 3 });

    const cart = await cartService.getCart(SCOPE);
    const quote = await createQuoteFromCart({ cartService, quoteService }, SCOPE);

    expect(quote.totalMinor).toBe(cart.totalMinor);
  });

  it('refuses an empty draft rather than quoting nothing', async () => {
    const { cartService, quoteService } = harness();

    await expect(
      createQuoteFromCart({ cartService, quoteService }, SCOPE),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('blocks the whole quote, naming every bad line, while a draft item is unavailable', async () => {
    const { cartService, quoteService } = harness();
    await cartService.addItem(SCOPE, { menuItemId: 'item-idli', quantity: 1 });
    await cartService.addItem(SCOPE, { menuItemId: 'item-filter-coffee', quantity: 1 });

    // Both items go off the menu after being added - the same "degrades
    // instead of failing the read" case the cart already covers.
    patchItem('item-idli', { active: false });
    patchItem('item-filter-coffee', { active: false });

    await expect(
      createQuoteFromCart({ cartService, quoteService }, SCOPE),
    ).rejects.toMatchObject({
      status: 409,
      details: [
        { menuItemId: 'item-idli', lineId: expect.any(String) },
        { menuItemId: 'item-filter-coffee', lineId: expect.any(String) },
      ],
    });
  });

  it('names only the unavailable line when a good one sits next to it', async () => {
    const { cartService, quoteService } = harness();
    await cartService.addItem(SCOPE, { menuItemId: 'item-idli', quantity: 1 });
    await cartService.addItem(SCOPE, { menuItemId: 'item-filter-coffee', quantity: 1 });
    patchItem('item-filter-coffee', { active: false });

    // Still blocked outright - a mixed draft is not quoted with the bad line
    // dropped - but `details` does not drag in the idli line that is fine.
    await expect(
      createQuoteFromCart({ cartService, quoteService }, SCOPE),
    ).rejects.toMatchObject({
      status: 409,
      details: [{ menuItemId: 'item-filter-coffee' }],
    });
  });

  it('keeps one session out of another session draft', async () => {
    const { cartService, quoteService } = harness();
    await cartService.addItem(SCOPE, { menuItemId: 'item-idli', quantity: 1 });

    const other = { ...SCOPE, sessionId: 'session-b' };
    await expect(
      createQuoteFromCart({ cartService, quoteService }, other),
    ).rejects.toMatchObject({ status: 400 });
  });
});
