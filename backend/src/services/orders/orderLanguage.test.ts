/**
 * The order's checkout language and its two name snapshots.
 *
 * The rule under test: the language is taken from the **quote** - what the
 * customer actually reviewed - and never from the confirming request, and the
 * order keeps both the canonical English name (the operational record) and the
 * localized one (what the customer saw), frozen at acceptance.
 *
 * No database: the order store is faked, as the money and idempotency rules it
 * backs are covered against a real `mongod` in `routes/orders.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { OrderDoc } from '../../models/orders.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../menu/inMemoryMenuRepository.js';
import { createMenuService } from '../menu/menuService.js';
import { createQuoteService } from '../quote/quoteService.js';
import { createQuoteStore } from '../quote/quoteStore.js';
import { createOrderService } from './orderService.js';
import type { OrderStore } from './orderStore.js';

const SCOPE = {
  sessionId: 'sess_1',
  sessionRef: 'sess_1',
  outletId: 'demo-outlet',
  channel: 'kiosk' as const,
};

function fakeOrderStore(): OrderStore {
  const orders = new Map<string, OrderDoc>();
  let token = 0;

  return {
    async allocateToken() {
      token += 1;
      return token;
    },
    async findByIdempotency(outletId, sessionKeyHash, idempotencyKey) {
      return orders.get(`${outletId}:${sessionKeyHash}:${idempotencyKey}`);
    },
    async insert(doc) {
      const key = `${doc.outletId}:${doc.sessionKeyHash}:${doc.idempotencyKey}`;
      const existing = orders.get(key);
      if (existing !== undefined) return { doc: existing, replayed: true };
      orders.set(key, doc);
      return { doc, replayed: false };
    },
    async findByAccessHash(publicOrderId, accessTokenHash) {
      return [...orders.values()].find(
        (doc) =>
          doc.publicOrderId === publicOrderId &&
          doc.accessTokenHash === accessTokenHash,
      );
    },
  };
}

function services() {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const quoteStore = createQuoteStore();
  return {
    quoteService: createQuoteService({ menuService, quoteStore }),
    orderService: createOrderService({
      menuService,
      quoteStore,
      orderStore: fakeOrderStore(),
    }),
  };
}

/** Quotes one Masala Dosa in `language` and confirms it. */
async function order(language?: 'en' | 'kn' | 'hi', key = 'key-1') {
  const { quoteService, orderService } = services();
  const quote = await quoteService.createQuote(
    {
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-masala-dosa', quantity: 1 }],
    },
    { sessionId: SCOPE.sessionId, outletId: SCOPE.outletId },
    language,
  );

  const created = await orderService.createOrder(
    {
      outletId: 'demo-outlet',
      quoteId: quote.quoteId,
      paymentMethod: 'cashAtCounter',
      customerConfirmed: true,
    },
    SCOPE,
    key,
  );

  return { orderService, order: created.order, quote };
}

describe('checkout language', () => {
  it('defaults to English, with both snapshots in English', async () => {
    const { order: created } = await order();

    expect(created.checkoutLanguage).toBe('en');
    expect(created.items[0]?.nameAtOrder).toBe('Masala Dosa');
    expect(created.items[0]?.displayNameAtOrder).toBe('Masala Dosa');
  });

  it('is taken from the quote the customer reviewed', async () => {
    const { order: created } = await order('kn');

    expect(created.checkoutLanguage).toBe('kn');
    // The operational name stays English; the customer's name travels with it.
    expect(created.items[0]?.nameAtOrder).toBe('Masala Dosa');
    expect(created.items[0]?.displayNameAtOrder).toBe('ಮಸಾಲೆ ದೋಸೆ');
  });

  it('freezes the localized name, so a later menu edit cannot rewrite it', async () => {
    const { orderService, order: created } = await order('hi');
    expect(created.orderAccessToken).toBeDefined();

    const read = await orderService.getOrder(
      created.orderId,
      created.orderAccessToken as string,
    );

    expect(read.checkoutLanguage).toBe('hi');
    expect(read.items[0]?.displayNameAtOrder).toBe('मसाला डोसा');
  });

  it('falls back to English for an item with no translation', async () => {
    const { quoteService, orderService } = services();
    const quote = await quoteService.createQuote(
      {
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-cold-coffee', quantity: 1 }],
      },
      { sessionId: SCOPE.sessionId, outletId: SCOPE.outletId },
      'kn',
    );

    const { order: created } = await orderService.createOrder(
      {
        outletId: 'demo-outlet',
        quoteId: quote.quoteId,
        paymentMethod: 'upiQr',
        customerConfirmed: true,
      },
      SCOPE,
      'key-2',
    );

    expect(created.checkoutLanguage).toBe('kn');
    expect(created.items[0]?.displayNameAtOrder).toBe('Cold Coffee');
  });

  it('does not change the money or the payment state', async () => {
    const en = await order('en');
    const kn = await order('kn');

    expect(kn.order.totalMinor).toBe(en.order.totalMinor);
    expect(kn.order.paymentStatus).toBe('dueAtCounter');
  });
});
