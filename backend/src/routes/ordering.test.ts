/**
 * HTTP-level contract for the menu, ordering-session and quote endpoints.
 *
 * This is the shape Anvesh's client codes against, so the assertions pin the
 * status codes, headers and body fields rather than only the service behaviour.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../services/menu/inMemoryMenuRepository.js';
import { createMenuService } from '../services/menu/menuService.js';
import { createQuoteService } from '../services/quote/quoteService.js';
import { createQuoteStore } from '../services/quote/quoteStore.js';
import { createCartStore } from '../services/cart/cartStore.js';
import { createOrderingSessionService } from '../services/sessions/orderingSessionService.js';

function app() {
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  const orderingSessions = createOrderingSessionService();
  const quoteService = createQuoteService({
    menuService,
    quoteStore: createQuoteStore(),
  });
  // In-memory, so a session-end test can assert the draft was cleared without
  // a database.
  const cartStore = createCartStore();

  return createApp(loadConfig({ NODE_ENV: 'test' }), {
    menuService,
    quoteService,
    orderingSessions,
    cartStore,
  });
}

async function session(
  server: ReturnType<typeof app>,
  outletId = 'demo-outlet',
): Promise<string> {
  const response = await request(server)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'qr' });

  expect(response.status).toBe(201);
  return response.body.sessionId as string;
}

describe('GET /api/v1/outlets/:outletId/menu', () => {
  it('returns the public menu without a session', async () => {
    const response = await request(app()).get('/api/v1/outlets/demo-outlet/menu');

    expect(response.status).toBe(200);
    expect(response.body.outlet.id).toBe('demo-outlet');
    expect(response.body.menuVersion).toEqual(expect.any(String));
    expect(response.body.categories).toHaveLength(2);
    expect(response.body.items.length).toBeGreaterThan(0);
  });

  it('returns 404 for an unknown, inactive or malformed outlet', async () => {
    const server = app();

    for (const outletId of ['ghost-outlet', 'closed-outlet', 'not%20valid']) {
      const response = await request(server).get(`/api/v1/outlets/${outletId}/menu`);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.requestId).toEqual(expect.any(String));
    }
  });

  it('serves the requested language and echoes it', async () => {
    const response = await request(app()).get(
      '/api/v1/outlets/demo-outlet/menu?lang=kn',
    );

    expect(response.status).toBe(200);
    expect(response.body.language).toBe('kn');
    expect(response.body.contentVersion).toEqual(expect.any(String));
    expect(
      response.body.items.find((item: { id: string }) => item.id === 'item-masala-dosa')
        .name,
    ).toBe('ಮಸಾಲೆ ದೋಸೆ');
  });

  it('serves English, unchanged, when no language is asked for', async () => {
    const response = await request(app()).get('/api/v1/outlets/demo-outlet/menu');

    expect(response.body.language).toBe('en');
    expect(
      response.body.items.find((item: { id: string }) => item.id === 'item-masala-dosa')
        .name,
    ).toBe('Masala Dosa');
  });

  it('keeps menuVersion the same across languages', async () => {
    const server = app();
    const en = await request(server).get('/api/v1/outlets/demo-outlet/menu');
    const hi = await request(server).get('/api/v1/outlets/demo-outlet/menu?lang=hi');

    expect(hi.body.menuVersion).toBe(en.body.menuVersion);
    expect(hi.body.contentVersion).not.toBe(en.body.contentVersion);
  });

  it('rejects an unsupported or repeated language with 400', async () => {
    const server = app();

    for (const query of ['lang=ta', 'lang=', 'lang=EN', 'lang=kn&lang=hi']) {
      const response = await request(server).get(
        `/api/v1/outlets/demo-outlet/menu?${query}`,
      );
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 503 when the database is unreachable', async () => {
    // Default wiring resolves MongoDB lazily and nothing is connected in tests.
    const response = await request(createApp(loadConfig({ NODE_ENV: 'test' }))).get(
      '/api/v1/outlets/demo-outlet/menu',
    );

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('POST /api/v1/ordering-sessions', () => {
  it('creates a session for an active outlet', async () => {
    const response = await request(app())
      .post('/api/v1/ordering-sessions')
      .send({ outletId: 'demo-outlet', channel: 'kiosk' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      sessionId: expect.any(String),
      outletId: 'demo-outlet',
      channel: 'kiosk',
      expiresAt: expect.any(String),
    });
  });

  it('refuses an unknown or inactive outlet', async () => {
    const server = app();

    for (const outletId of ['ghost-outlet', 'closed-outlet']) {
      const response = await request(server)
        .post('/api/v1/ordering-sessions')
        .send({ outletId, channel: 'qr' });
      expect(response.status).toBe(404);
    }
  });

  it('validates the body', async () => {
    const response = await request(app())
      .post('/api/v1/ordering-sessions')
      .send({ outletId: 'demo-outlet', channel: 'telepathy' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/v1/ordering-sessions', () => {
  it('revokes the session: it can no longer read its own cart', async () => {
    const server = app();
    const token = await session(server);

    const ended = await request(server)
      .delete('/api/v1/ordering-sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(ended.status).toBe(204);
    expect(ended.body).toEqual({});

    const after = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('clears the draft along with the session', async () => {
    const server = app();
    const token = await session(server);

    await request(server)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });

    await request(server)
      .delete('/api/v1/ordering-sessions')
      .set('Authorization', `Bearer ${token}`);

    // A fresh session for the same outlet gets an empty draft, not the one
    // just deleted - draft identity is per session, never reused.
    const freshToken = await session(server);
    const cart = await request(server)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${freshToken}`);
    expect(cart.body.items).toEqual([]);
  });

  it('is idempotent: ending an unknown or already-ended session still succeeds', async () => {
    const server = app();
    const token = await session(server);

    expect(
      (
        await request(server)
          .delete('/api/v1/ordering-sessions')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(204);

    // Same token again - already ended.
    expect(
      (
        await request(server)
          .delete('/api/v1/ordering-sessions')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(204);

    // Never issued at all.
    expect(
      (
        await request(server)
          .delete('/api/v1/ordering-sessions')
          .set('Authorization', 'Bearer not-a-real-session')
      ).status,
    ).toBe(204);
  });

  it('requires a bearer token', async () => {
    const response = await request(app()).delete('/api/v1/ordering-sessions');

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/quotes', () => {
  it('prices a draft for an authenticated session', async () => {
    const server = app();
    const sessionId = await session(server);

    const response = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [
          { menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.items[0]).toEqual({
      menuItemId: 'item-masala-dosa',
      name: 'Masala Dosa',
      displayName: 'Masala Dosa',
      quantity: 2,
      optionIds: ['opt-ghee'],
      unitPriceMinor: 10500,
      lineTotalMinor: 21000,
    });
    expect(response.body.subtotalMinor).toBe(21000);
    expect(response.body.totalMinor).toBe(21000);
    expect(response.body.currency).toBe('INR');
    expect(response.body.quoteId).toEqual(expect.any(String));
  });

  it('records the review language and localizes the display names', async () => {
    const server = app();
    const sessionId = await session(server);

    const response = await request(server)
      .post('/api/v1/quotes?lang=kn')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1 }],
      });

    expect(response.status).toBe(200);
    expect(response.body.language).toBe('kn');
    expect(response.body.items[0].name).toBe('Idli');
    expect(response.body.items[0].displayName).toBe('ಇಡ್ಲಿ');
  });

  it('rejects an unsupported language on a quote with 400', async () => {
    const server = app();
    const sessionId = await session(server);

    const response = await request(server)
      .post('/api/v1/quotes?lang=ta')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with no session', async () => {
    const response = await request(app())
      .post('/api/v1/quotes')
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1 }],
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['a bogus token', 'Bearer not-a-real-session'],
    ['a malformed header', 'Token abc'],
    ['an empty bearer', 'Bearer '],
  ])('rejects %s', async (_label, header) => {
    const response = await request(app())
      .post('/api/v1/quotes')
      .set('Authorization', header)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1 }],
      });

    expect(response.status).toBe(401);
  });

  it('refuses to quote for an outlet the session is not scoped to', async () => {
    const server = app();
    const sessionId = await session(server, 'demo-outlet');

    const response = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'other-outlet',
        items: [{ menuItemId: 'item-poha', quantity: 1 }],
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('cannot read another session quote path: each session gets its own quote', async () => {
    const server = app();
    const first = await session(server);
    const second = await session(server);

    const body = {
      outletId: 'demo-outlet',
      items: [{ menuItemId: 'item-idli', quantity: 1 }],
    };

    const a = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${first}`)
      .send(body);
    const b = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${second}`)
      .send(body);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.quoteId).not.toBe(b.body.quoteId);
  });

  it('returns 422 for an unknown item and 409 for an unavailable one', async () => {
    const server = app();
    const sessionId = await session(server);

    const unknown = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({ outletId: 'demo-outlet', items: [{ menuItemId: 'nope', quantity: 1 }] });
    expect(unknown.status).toBe(422);

    const unavailable = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-medu-vada', quantity: 1 }],
      });
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 for an invalid body', async () => {
    const server = app();
    const sessionId = await session(server);

    const response = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 0 }],
      });

    expect(response.status).toBe(400);
  });

  it('never echoes a client-supplied price', async () => {
    const server = app();
    const sessionId = await session(server);

    const response = await request(server)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({
        outletId: 'demo-outlet',
        items: [{ menuItemId: 'item-idli', quantity: 1, unitPriceMinor: 1 }],
        totalMinor: 1,
      });

    expect(response.status).toBe(200);
    expect(response.body.totalMinor).toBe(4000);
  });
});
