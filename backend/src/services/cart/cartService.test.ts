/**
 * Cart draft service behaviour: pricing, validation, availability drift,
 * session/outlet isolation and concurrent edits.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CART_LINES } from '@vop/shared';
import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';
import { compareListingOrder, type MenuRepository } from '../menu/menuRepository.js';
import { SAMPLE_MENU } from '../menu/inMemoryMenuRepository.js';
import { createMenuService } from '../menu/menuService.js';
import { createCartService, toDraftSummary } from './cartService.js';
import { createCartStore } from './cartStore.js';

/**
 * `expiresAtMs` is the session's absolute deadline, which caps a draft's own.
 * Deliberately far in the future here, so these tests exercise the draft TTL
 * rather than the clamp; `mongoCartStore.integration.test.ts` covers the clamp.
 */
const SESSION_DEADLINE_MS = Number.MAX_SAFE_INTEGER;
const SESSION = {
  sessionId: 'session-a',
  outletId: 'demo-outlet',
  expiresAtMs: SESSION_DEADLINE_MS,
} as const;
const OTHER_SESSION = {
  sessionId: 'session-b',
  outletId: 'demo-outlet',
  expiresAtMs: SESSION_DEADLINE_MS,
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

function service() {
  const menuService = createMenuService(repository());
  const cartStore = createCartStore();
  return {
    cartStore,
    cartService: createCartService({ menuService, cartStore }),
  };
}

/** Replaces one item in the mutable dataset. */
function patchItem(publicId: string, patch: Partial<MenuItemDoc>): void {
  dataset.items = dataset.items.map((item) =>
    item.publicId === publicId ? { ...item, ...patch } : item,
  );
}

beforeEach(() => {
  dataset = {
    outlets: [...SAMPLE_MENU.outlets],
    categories: [...SAMPLE_MENU.categories],
    items: [...SAMPLE_MENU.items],
  };
});

describe('cart draft basics', () => {
  it('starts empty, at revision 0, with no stored record', async () => {
    const { cartService, cartStore } = service();

    const cart = await cartService.getCart(SESSION);

    expect(cart.items).toEqual([]);
    expect(cart.revision).toBe(0);
    expect(cart.subtotalMinor).toBe(0);
    expect(cart.totalMinor).toBe(0);
    expect(cart.currency).toBe('INR');
    expect(cart.hasUnavailableItems).toBe(false);
    expect(cart.outletId).toBe('demo-outlet');
    expect(cart.menuVersion).toEqual(expect.any(String));
    // A read must not create state.
    expect(await cartStore.size()).toBe(0);
  });

  it('prices an added line from the menu in integer paise', async () => {
    const { cartService } = service();

    const cart = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 2,
      optionIds: ['opt-ghee'],
    });

    expect(cart.revision).toBe(1);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toEqual({
      lineId: expect.any(String),
      menuItemId: 'item-masala-dosa',
      name: 'Masala Dosa',
      quantity: 2,
      optionIds: ['opt-ghee'],
      unitPriceMinor: 10_500,
      lineTotalMinor: 21_000,
      available: true,
      issues: [],
    });
    expect(cart.subtotalMinor).toBe(21_000);
    expect(cart.totalMinor).toBe(21_000);
  });

  it('ignores any price-like field a client sends', async () => {
    const { cartService } = service();

    const cart = await cartService.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
      unitPriceMinor: 1,
      priceMinor: 1,
      lineTotalMinor: 1,
    } as never);

    expect(cart.items[0]?.unitPriceMinor).toBe(4000);
    expect(cart.subtotalMinor).toBe(4000);
  });

  it('sums several lines and survives a round trip through getCart', async () => {
    const { cartService } = service();

    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 2 });
    await cartService.addItem(SESSION, {
      menuItemId: 'item-filter-coffee',
      quantity: 1,
      optionIds: ['opt-less-sugar'],
    });

    const cart = await cartService.getCart(SESSION);

    expect(cart.revision).toBe(2);
    expect(cart.items.map((line) => line.menuItemId)).toEqual([
      'item-idli',
      'item-filter-coffee',
    ]);
    expect(cart.subtotalMinor).toBe(8000 + 3000);
  });
});

describe('option handling', () => {
  it('merges an identical selection regardless of option order', async () => {
    const { cartService } = service();

    await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
      optionIds: ['opt-ghee', 'opt-extra-chutney'],
    });
    const cart = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 2,
      optionIds: ['opt-extra-chutney', 'opt-ghee'],
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.quantity).toBe(3);
    expect(cart.items[0]?.optionIds).toEqual(['opt-extra-chutney', 'opt-ghee']);
    expect(cart.items[0]?.unitPriceMinor).toBe(8000 + 2500 + 1000);
  });

  it('keeps different option selections as separate lines', async () => {
    const { cartService } = service();

    await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
      optionIds: ['opt-ghee'],
    });
    const cart = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
    });

    expect(cart.items).toHaveLength(2);
    expect(cart.subtotalMinor).toBe(10_500 + 8000);
  });

  it('refuses an unknown option (422) and an inactive one (409)', async () => {
    const { cartService } = service();

    await expect(
      cartService.addItem(SESSION, {
        menuItemId: 'item-masala-dosa',
        quantity: 1,
        optionIds: ['opt-nope'],
      }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      cartService.addItem(SESSION, {
        menuItemId: 'item-masala-dosa',
        quantity: 1,
        optionIds: ['opt-seasonal'],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a repeated option', async () => {
    const { cartService } = service();

    await expect(
      cartService.addItem(SESSION, {
        menuItemId: 'item-masala-dosa',
        quantity: 1,
        optionIds: ['opt-ghee', 'opt-ghee'],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('validation and bounds', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['over the cap', 21],
    ['not a number', '2'],
    ['missing', undefined],
  ])('refuses a %s quantity with 400', async (_label, quantity) => {
    const { cartService } = service();

    await expect(
      cartService.addItem(SESSION, {
        menuItemId: 'item-idli',
        quantity,
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a missing menuItemId with 400', async () => {
    const { cartService } = service();

    await expect(
      cartService.addItem(SESSION, { quantity: 1 } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an unknown item (422) and an unavailable one (409)', async () => {
    const { cartService } = service();

    await expect(
      cartService.addItem(SESSION, { menuItemId: 'ghost-item', quantity: 1 }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      cartService.addItem(SESSION, { menuItemId: 'item-medu-vada', quantity: 1 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a merge that would exceed the per-line quantity cap', async () => {
    const { cartService } = service();

    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 20 });

    await expect(
      cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
    ).rejects.toMatchObject({ status: 409 });

    const cart = await cartService.getCart(SESSION);
    expect(cart.items[0]?.quantity).toBe(20);
  });

  it('refuses a draft beyond the line cap', async () => {
    for (let index = 0; index < MAX_CART_LINES + 1; index += 1) {
      dataset.items.push({
        publicId: `item-bulk-${index}`,
        outletId: 'demo-outlet',
        name: `Bulk ${index}`,
        priceMinor: 100,
        currency: 'INR',
        active: true,
        sortOrder: 100 + index,
        options: [],
      });
    }
    const { cartService } = service();

    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      await cartService.addItem(SESSION, {
        menuItemId: `item-bulk-${index}`,
        quantity: 1,
      });
    }

    await expect(
      cartService.addItem(SESSION, {
        menuItemId: `item-bulk-${MAX_CART_LINES}`,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const cart = await cartService.getCart(SESSION);
    expect(cart.items).toHaveLength(MAX_CART_LINES);
    // A refused add may not touch an existing line either.
    expect(cart.subtotalMinor).toBe(100 * MAX_CART_LINES);
  });
});

describe('updating and removing lines', () => {
  it('changes a quantity and reprices the line', async () => {
    const { cartService } = service();
    const added = await cartService.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });
    const lineId = added.items[0]!.lineId;

    const cart = await cartService.updateItem(SESSION, lineId, { quantity: 3 });

    expect(cart.revision).toBe(2);
    expect(cart.items[0]?.quantity).toBe(3);
    expect(cart.items[0]?.lineTotalMinor).toBe(12_000);
  });

  it('does not move the revision when the quantity is unchanged', async () => {
    const { cartService } = service();
    const added = await cartService.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 2,
    });

    const cart = await cartService.updateItem(SESSION, added.items[0]!.lineId, {
      quantity: 2,
    });

    expect(cart.revision).toBe(1);
  });

  it('replaces options, revalidating them', async () => {
    const { cartService } = service();
    const added = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
    });
    const lineId = added.items[0]!.lineId;

    const cart = await cartService.updateItem(SESSION, lineId, {
      quantity: 1,
      optionIds: ['opt-ghee'],
    });
    expect(cart.items[0]?.unitPriceMinor).toBe(10_500);

    await expect(
      cartService.updateItem(SESSION, lineId, {
        quantity: 1,
        optionIds: ['opt-seasonal'],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses an option change that collides with another line', async () => {
    const { cartService } = service();
    const first = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
      optionIds: ['opt-ghee'],
    });
    const second = await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
    });
    const plainLineId = second.items.find(
      (line) => line.lineId !== first.items[0]!.lineId,
    )!.lineId;

    await expect(
      cartService.updateItem(SESSION, plainLineId, {
        quantity: 1,
        optionIds: ['opt-ghee'],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('removes a line and reports an unknown line as 404', async () => {
    const { cartService } = service();
    const added = await cartService.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });

    const cart = await cartService.removeItem(SESSION, added.items[0]!.lineId);
    expect(cart.items).toEqual([]);
    expect(cart.revision).toBe(2);

    await expect(cartService.removeItem(SESSION, 'no-such-line')).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('clears every line, and clearing an empty draft is a no-op', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    const cleared = await cartService.clear(SESSION);
    expect(cleared.items).toEqual([]);
    expect(cleared.subtotalMinor).toBe(0);
    expect(cleared.revision).toBe(2);

    const again = await cartService.clear(SESSION);
    expect(again.revision).toBe(2);
  });
});

describe('availability drift', () => {
  it('marks a line unorderable when its item is switched off, excluding it from the total', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 2 });
    await cartService.addItem(SESSION, {
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });

    patchItem('item-idli', { active: false });
    const cart = await cartService.getCart(SESSION);

    const idli = cart.items.find((line) => line.menuItemId === 'item-idli');
    expect(idli).toMatchObject({
      available: false,
      issues: ['itemUnavailable'],
      unitPriceMinor: 0,
      lineTotalMinor: 0,
      // The line keeps its name so the customer can see what to remove.
      name: 'Idli',
      quantity: 2,
    });
    expect(cart.hasUnavailableItems).toBe(true);
    expect(cart.subtotalMinor).toBe(3000);
  });

  it('marks a line unorderable when a selected option is switched off', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
      optionIds: ['opt-ghee'],
    });

    patchItem('item-masala-dosa', {
      options: [
        {
          publicId: 'opt-ghee',
          label: 'Ghee roast',
          priceDeltaMinor: 2500,
          active: false,
        },
      ],
    });
    const cart = await cartService.getCart(SESSION);

    expect(cart.items[0]).toMatchObject({
      available: false,
      issues: ['optionUnavailable'],
      lineTotalMinor: 0,
    });
    expect(cart.subtotalMinor).toBe(0);
  });

  it('keeps a line whose item has left the menu, labelled from the add-time snapshot', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    dataset.items = dataset.items.filter((item) => item.publicId !== 'item-idli');
    const cart = await cartService.getCart(SESSION);

    expect(cart.items[0]).toMatchObject({
      menuItemId: 'item-idli',
      name: 'Idli',
      available: false,
      issues: ['itemNotOnMenu'],
    });
    expect(cart.hasUnavailableItems).toBe(true);
  });

  it('prices a line that becomes orderable again', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    patchItem('item-idli', { active: false });
    expect((await cartService.getCart(SESSION)).subtotalMinor).toBe(0);

    patchItem('item-idli', { active: true, priceMinor: 4500 });
    const cart = await cartService.getCart(SESSION);

    expect(cart.items[0]?.available).toBe(true);
    // The current price, not the price at the time it was added.
    expect(cart.subtotalMinor).toBe(4500);
  });
});

describe('isolation and concurrency', () => {
  it('keeps one draft per session', async () => {
    const { cartService } = service();

    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });
    const other = await cartService.getCart(OTHER_SESSION);

    expect(other.items).toEqual([]);
    expect(other.revision).toBe(0);
    expect((await cartService.getCart(SESSION)).items).toHaveLength(1);
  });

  it('never reveals a draft under a different outlet scope', async () => {
    const { cartService, cartStore } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    expect(await cartStore.get(SESSION.sessionId, 'other-outlet')).toBeUndefined();
    expect((await cartStore.get(SESSION.sessionId, 'demo-outlet'))?.lines).toHaveLength(
      1,
    );
  });

  it('refuses a line of another session as not found', async () => {
    const { cartService } = service();
    const mine = await cartService.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });

    await expect(
      cartService.removeItem(OTHER_SESSION, mine.items[0]!.lineId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('applies concurrent adds without losing one', async () => {
    const { cartService } = service();

    const carts = await Promise.all([
      cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
      cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
      cartService.addItem(SESSION, { menuItemId: 'item-filter-coffee', quantity: 2 }),
    ]);

    const cart = await cartService.getCart(SESSION);
    expect(cart.revision).toBe(3);
    expect(carts.map((entry) => entry.revision).sort()).toEqual([1, 2, 3]);
    expect(cart.items.find((line) => line.menuItemId === 'item-idli')?.quantity).toBe(
      2,
    );
    expect(cart.subtotalMinor).toBe(8000 + 6000);
  });

  it('does not let a failed mutation block the next one', async () => {
    const { cartService } = service();

    const results = await Promise.allSettled([
      cartService.addItem(SESSION, { menuItemId: 'ghost-item', quantity: 1 }),
      cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
    ]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    expect((await cartService.getCart(SESSION)).items).toHaveLength(1);
  });

  it('refuses a mutation whose expected revision is stale', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    await expect(
      cartService.addItem(
        SESSION,
        { menuItemId: 'item-filter-coffee', quantity: 1 },
        { expectedRevision: 0 },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const cart = await cartService.addItem(
      SESSION,
      { menuItemId: 'item-filter-coffee', quantity: 1 },
      { expectedRevision: 1 },
    );
    expect(cart.revision).toBe(2);
  });
});

describe('conversation draft summary', () => {
  it('carries no money and omits unorderable lines', async () => {
    const { cartService } = service();
    await cartService.addItem(SESSION, {
      menuItemId: 'item-masala-dosa',
      quantity: 1,
      optionIds: ['opt-ghee'],
    });
    await cartService.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });
    patchItem('item-idli', { active: false });

    const summary = toDraftSummary(await cartService.getCart(SESSION));

    expect(summary).toEqual({
      items: [
        {
          menuItemId: 'item-masala-dosa',
          name: 'Masala Dosa',
          quantity: 1,
          optionIds: ['opt-ghee'],
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/Minor/);
  });
});
