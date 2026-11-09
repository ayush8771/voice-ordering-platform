/**
 * HTTP contract for the cart draft endpoints: status codes, the `If-Match`
 * revision check, session authentication and outlet scope.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { createCartService, createCartStore } from '../services/cart/index.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../services/menu/inMemoryMenuRepository.js';
import { createMenuService } from '../services/menu/menuService.js';
import { createOrderingSessionService } from '../services/sessions/orderingSessionService.js';

function app() {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const orderingSessions = createOrderingSessionService();
  const cartService = createCartService({ menuService, cartStore: createCartStore() });

  return createApp(loadConfig({ NODE_ENV: 'test' }), {
    menuService,
    cartService,
    orderingSessions,
  });
}

async function session(
  server: ReturnType<typeof app>,
  outletId = 'demo-outlet',
): Promise<string> {
  const response = await request(server)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'kiosk' });

  expect(response.status).toBe(201);
  return response.body.sessionId as string;
}

describe('GET /api/v1/cart', () => {
  it('returns an empty draft for a fresh session', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      cartId: expect.any(String),
      outletId: 'demo-outlet',
      menuVersion: expect.any(String),
      revision: 0,
      items: [],
      subtotalMinor: 0,
      totalMinor: 0,
      currency: 'INR',
      hasUnavailableItems: false,
      updatedAt: expect.any(String),
    });
  });

  it('requires an ordering session', async () => {
    const response = await request(app()).get('/api/v1/cart');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /api/v1/cart/items', () => {
  it('adds a priced line', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] });

    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      menuItemId: 'item-masala-dosa',
      name: 'Masala Dosa',
      quantity: 2,
      unitPriceMinor: 10_500,
      lineTotalMinor: 21_000,
      available: true,
    });
    expect(response.body.totalMinor).toBe(21_000);
  });

  it('never reads a client-supplied price', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        menuItemId: 'item-idli',
        quantity: 1,
        unitPriceMinor: 1,
        lineTotalMinor: 1,
      });

    expect(response.status).toBe(200);
    expect(response.body.totalMinor).toBe(4000);
  });

  it.each([
    ['an invalid quantity', { menuItemId: 'item-idli', quantity: 0 }, 400],
    ['an unknown item', { menuItemId: 'ghost', quantity: 1 }, 422],
    ['a sold-out item', { menuItemId: 'item-medu-vada', quantity: 1 }, 409],
    [
      'an unknown option',
      { menuItemId: 'item-masala-dosa', quantity: 1, optionIds: ['nope'] },
      422,
    ],
  ])('rejects %s with %i', async (_label, body, status) => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(response.status).toBe(status);
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('refuses a body naming another outlet', async () => {
    const server = app();
    const token = await session(server, 'demo-outlet');

    const response = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId: 'other-outlet', menuItemId: 'item-poha', quantity: 1 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('keeps each session draft separate', async () => {
    const server = app();
    const first = await session(server);
    const second = await session(server);

    await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${first}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });

    const mine = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${first}`);
    const theirs = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${second}`);

    expect(mine.body.items).toHaveLength(1);
    expect(theirs.body.items).toEqual([]);
    expect(theirs.body.cartId).not.toBe(mine.body.cartId);
  });
});

describe('cart revision checks', () => {
  it('applies a mutation that matches If-Match and refuses a stale one', async () => {
    const server = app();
    const token = await session(server);

    const added = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });
    expect(added.body.revision).toBe(1);

    const matched = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '1')
      .send({ menuItemId: 'item-filter-coffee', quantity: 1 });
    expect(matched.status).toBe(200);
    expect(matched.body.revision).toBe(2);

    const stale = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '1')
      .send({ menuItemId: 'item-cold-coffee', quantity: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.error.details).toEqual([{ revision: 2 }]);
  });

  it('rejects a malformed If-Match', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '"W/abc"');

    expect(response.status).toBe(400);
  });
});

describe('PATCH and DELETE /api/v1/cart/items/:lineId', () => {
  it('updates a quantity and removes a line', async () => {
    const server = app();
    const token = await session(server);

    const added = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });
    const lineId = added.body.items[0].lineId as string;

    const patched = await request(server)
      .patch(`/api/v1/cart/items/${lineId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 3 });
    expect(patched.status).toBe(200);
    expect(patched.body.items[0].quantity).toBe(3);
    expect(patched.body.subtotalMinor).toBe(12_000);

    const removed = await request(server)
      .delete(`/api/v1/cart/items/${lineId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.items).toEqual([]);
  });

  it('reports an unknown or malformed line as 404', async () => {
    const server = app();
    const token = await session(server);

    for (const lineId of ['11111111-1111-4111-8111-111111111111', 'x'.repeat(200)]) {
      const response = await request(server)
        .delete(`/api/v1/cart/items/${lineId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('cannot touch another session line', async () => {
    const server = app();
    const owner = await session(server);
    const intruder = await session(server);

    const added = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${owner}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });
    const lineId = added.body.items[0].lineId as string;

    const response = await request(server)
      .delete(`/api/v1/cart/items/${lineId}`)
      .set('Authorization', `Bearer ${intruder}`);

    expect(response.status).toBe(404);

    const owned = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${owner}`);
    expect(owned.body.items).toHaveLength(1);
  });
});

describe('DELETE /api/v1/cart', () => {
  it('clears the draft', async () => {
    const server = app();
    const token = await session(server);

    await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 2 });

    const response = await request(server)
      .delete('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.subtotalMinor).toBe(0);
  });

  it('requires a session for every cart route', async () => {
    const server = app();

    const responses = await Promise.all([
      request(server).post('/api/v1/cart/items').send({}),
      request(server).patch('/api/v1/cart/items/abc').send({ quantity: 1 }),
      request(server).delete('/api/v1/cart/items/abc'),
      request(server).delete('/api/v1/cart'),
    ]);

    for (const response of responses) expect(response.status).toBe(401);
  });
});

describe('cart and quote agree', () => {
  it('prices the same selection identically', async () => {
    const server = app();
    const token = await session(server);

    const cart = await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] });

    const quote = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        outletId: 'demo-outlet',
        items: [
          { menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] },
        ],
      });

    expect(quote.status).toBe(200);
    expect(cart.body.totalMinor).toBe(quote.body.totalMinor);
    expect(cart.body.menuVersion).toBe(quote.body.menuVersion);
  });
});

describe('POST /api/v1/cart/quote', () => {
  it('quotes the draft as stored, with no body required', async () => {
    const server = app();
    const token = await session(server);

    await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] });

    const quote = await request(server)
      .post('/api/v1/cart/quote')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.items).toEqual([
      expect.objectContaining({
        menuItemId: 'item-masala-dosa',
        quantity: 2,
        optionIds: ['opt-ghee'],
      }),
    ]);

    const cart = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(quote.body.totalMinor).toBe(cart.body.totalMinor);
  });

  it('rejects an empty draft', async () => {
    const server = app();
    const token = await session(server);

    const response = await request(server)
      .post('/api/v1/cart/quote')
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a session', async () => {
    const response = await request(app()).post('/api/v1/cart/quote').send();
    expect(response.status).toBe(401);
  });
});
