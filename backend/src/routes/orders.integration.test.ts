/**
 * HTTP integration tests for order creation and order reads over a real
 * `mongod` (docs/TESTING.md section 2).
 *
 * A real database is not optional here: the two properties that matter -
 * atomic pickup-token allocation and the unique idempotency constraint - are
 * enforced by MongoDB, so testing them against a stub would prove nothing.
 *
 * Production wiring is used as-is (`connectToMongo` plus `createApp` with no
 * injected doubles), so the quote store order creation reads is the same
 * in-memory store the quote route wrote to, exactly as in a deployed instance.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { loadConfig, type AppConfig } from '../config/env.js';
import { connectToMongo, disconnectFromMongo, getDb } from '../db/mongo.js';
import {
  MONGO_HOOK_TIMEOUT_MS,
  startTestMongo,
  type TestMongo,
} from '../db/testMongoServer.js';
import { COLLECTIONS } from '../models/menu.js';
import { ORDER_COLLECTIONS, type OrderDoc } from '../models/orders.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { ensureMenuIndexes } from '../services/menu/mongoMenuRepository.js';
import { ensureCartDraftIndexes } from '../services/cart/index.js';
import { createMongoOrderStore, ensureOrderIndexes } from '../services/orders/index.js';
import { ensureOrderingSessionIndexes } from '../services/sessions/mongoOrderingSessionService.js';

let mongo: TestMongo;
let config: AppConfig;

beforeAll(async () => {
  mongo = await startTestMongo('vop_orders_integration');
  config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: mongo.uri,
    MONGODB_DB_NAME: mongo.dbName,
  });
  await connectToMongo(config);
}, MONGO_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await disconnectFromMongo();
  await mongo?.stop();
});

afterEach(async () => {
  await mongo.reset();
});

beforeEach(async () => {
  const db = getDb();
  await ensureMenuIndexes(db);
  await ensureOrderingSessionIndexes(db);
  await ensureCartDraftIndexes(db);
  await ensureOrderIndexes(db);
  await db
    .collection(COLLECTIONS.outlets)
    .insertMany(structuredClone([...SAMPLE_MENU.outlets]));
  await db
    .collection(COLLECTIONS.menuCategories)
    .insertMany(structuredClone([...SAMPLE_MENU.categories]));
  await db
    .collection(COLLECTIONS.menuItems)
    .insertMany(structuredClone([...SAMPLE_MENU.items]));
});

function newApp(): Express {
  return createApp(config);
}

async function mint(app: Express, outletId = 'demo-outlet'): Promise<string> {
  const response = await request(app)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'qr' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.sessionId as string;
}

/** Prices one item through the real quote route and returns the quote ID. */
async function quote(
  app: Express,
  sessionId: string,
  outletId = 'demo-outlet',
  quantity = 2,
): Promise<{ readonly quoteId: string; readonly totalMinor: number }> {
  const response = await request(app)
    .post('/api/v1/quotes')
    .set('Authorization', `Bearer ${sessionId}`)
    .send({ outletId, items: [{ menuItemId: 'item-masala-dosa', quantity }] });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { quoteId: response.body.quoteId, totalMinor: response.body.totalMinor };
}

function create(
  app: Express,
  sessionId: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
) {
  return request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${sessionId}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

function confirmBody(quoteId: string, paymentMethod = 'cashAtCounter') {
  return { outletId: 'demo-outlet', quoteId, paymentMethod, customerConfirmed: true };
}

describe('POST /api/v1/orders', () => {
  it('creates an order from a quote, priced by the server', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const { quoteId, totalMinor } = await quote(app, sessionId);

    const response = await create(app, sessionId, 'key-1', confirmBody(quoteId));

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      token: '1',
      outletId: 'demo-outlet',
      channel: 'qr',
      orderStatus: 'accepted',
      paymentMethod: 'cashAtCounter',
      // Cash is owed at the counter; nothing here verifies receipt.
      paymentStatus: 'dueAtCounter',
      totalMinor,
      subtotalMinor: totalMinor,
      currency: 'INR',
    });
    expect(response.body.items).toEqual([
      {
        menuItemId: 'item-masala-dosa',
        nameAtOrder: 'Masala Dosa',
        displayNameAtOrder: 'Masala Dosa',
        quantity: 2,
        optionIds: [],
        unitPriceMinor: 8000,
        lineTotalMinor: 16000,
      },
    ]);
    expect(typeof response.body.orderId).toBe('string');
    expect(typeof response.body.orderAccessToken).toBe('string');
  });

  it('leaves a UPI order pending, never verified', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const { quoteId } = await quote(app, sessionId);

    const response = await create(
      app,
      sessionId,
      'key-upi',
      confirmBody(quoteId, 'upiQr'),
    );

    expect(response.status).toBe(201);
    expect(response.body.paymentStatus).toBe('pending');
  });

  it('stores no bearer token and no raw access token', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const { quoteId } = await quote(app, sessionId);
    const created = await create(app, sessionId, 'key-2', confirmBody(quoteId));

    const doc = await getDb()
      .collection<OrderDoc>(ORDER_COLLECTIONS.orders)
      .findOne({ _id: created.body.orderId });

    expect(doc).not.toBeNull();
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain(created.body.orderAccessToken);
    expect(doc?.sessionKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc?.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc?.tokenDateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('clears the draft but keeps the session usable for another order', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const added = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${sessionId}`)
      .send({ menuItemId: 'item-masala-dosa', quantity: 1 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);

    const first = await quote(app, sessionId);
    const order = await create(app, sessionId, 'key-3', confirmBody(first.quoteId));
    expect(order.status).toBe(201);

    const cart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${sessionId}`);
    expect(cart.status).toBe(200);
    expect(cart.body.items).toEqual([]);
    expect(cart.body.revision).toBe(0);

    // The session is retained: a second order in the same sitting works and
    // takes the next token.
    const second = await quote(app, sessionId);
    const again = await create(app, sessionId, 'key-4', confirmBody(second.quoteId));
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.token).toBe('2');
  });

  describe('idempotency', () => {
    it('replays the original order for the same key and payload', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const first = await create(app, sessionId, 'key-same', confirmBody(quoteId));
      const second = await create(app, sessionId, 'key-same', confirmBody(quoteId));

      expect(first.status).toBe(201);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(second.body.orderId).toBe(first.body.orderId);
      expect(second.body.token).toBe(first.body.token);
      // The capability is issued once: only its hash was stored.
      expect(second.body.orderAccessToken).toBeUndefined();
      expect(
        await getDb().collection(ORDER_COLLECTIONS.orders).countDocuments(),
      ).toBe(1);
    });

    it('replays even after the quote has gone', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);
      const first = await create(app, sessionId, 'key-ghost', confirmBody(quoteId));
      expect(first.status).toBe(201);

      // A fresh app has an empty in-memory quote store: the restart case.
      // The order still replays, because the stored order answers, not the quote.
      const replay = await request(newApp())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${sessionId}`)
        .set('Idempotency-Key', 'key-ghost')
        .send(confirmBody(quoteId));

      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.orderId).toBe(first.body.orderId);
    });

    it('refuses the same key with a different payload', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      expect((await create(app, sessionId, 'key-x', confirmBody(quoteId))).status).toBe(
        201,
      );
      const conflicting = await create(
        app,
        sessionId,
        'key-x',
        confirmBody(quoteId, 'upiQr'),
      );

      expect(conflicting.status).toBe(409);
      expect(conflicting.body.error.code).toBe('CONFLICT');
      expect(
        await getDb().collection(ORDER_COLLECTIONS.orders).countDocuments(),
      ).toBe(1);
    });

    it('creates one order when the same key is sent concurrently', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          create(app, sessionId, 'key-race', confirmBody(quoteId)),
        ),
      );

      const bodies = responses.map((response) => response.body);
      expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
      expect(new Set(bodies.map((body) => body.orderId)).size).toBe(1);
      expect(
        await getDb().collection(ORDER_COLLECTIONS.orders).countDocuments(),
      ).toBe(1);
    });
  });

  describe('pickup tokens', () => {
    it('never issues one number twice under concurrent orders', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const quotes = await Promise.all([
        quote(app, sessionId),
        quote(app, sessionId),
        quote(app, sessionId),
        quote(app, sessionId),
      ]);

      const responses = await Promise.all(
        quotes.map((issued, index) =>
          create(app, sessionId, `key-concurrent-${index}`, confirmBody(issued.quoteId)),
        ),
      );

      for (const response of responses) {
        expect(response.status, JSON.stringify(response.body)).toBe(201);
      }
      const tokens = responses.map((response) => response.body.token as string).sort();
      expect(tokens).toEqual(['1', '2', '3', '4']);
    });

    it('counts per outlet and per outlet-local day, and does not wrap', async () => {
      const store = createMongoOrderStore(getDb);

      expect(await store.allocateToken('demo-outlet', '2026-11-09')).toBe(1);
      expect(await store.allocateToken('demo-outlet', '2026-11-09')).toBe(2);
      // A second outlet has its own series on the same day.
      expect(await store.allocateToken('other-outlet', '2026-11-09')).toBe(1);
      // The next day restarts; the previous day's counter is untouched.
      expect(await store.allocateToken('demo-outlet', '2026-11-10')).toBe(1);
      expect(await store.allocateToken('demo-outlet', '2026-11-09')).toBe(3);
    });
  });

  describe('refusals', () => {
    it('requires explicit customer confirmation', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const response = await create(app, sessionId, 'key-noconfirm', {
        outletId: 'demo-outlet',
        quoteId,
        paymentMethod: 'cashAtCounter',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/customerConfirmed/);
      expect(
        await getDb().collection(ORDER_COLLECTIONS.orders).countDocuments(),
      ).toBe(0);
    });

    it('does not accept a truthy value as confirmation', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const response = await create(app, sessionId, 'key-truthy', {
        ...confirmBody(quoteId),
        customerConfirmed: 'yes',
      });

      expect(response.status).toBe(400);
    });

    it('requires an Idempotency-Key', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${sessionId}`)
        .send(confirmBody(quoteId));

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/Idempotency-Key/);
    });

    it('requires an ordering session', async () => {
      const response = await request(newApp())
        .post('/api/v1/orders')
        .set('Idempotency-Key', 'key-nosession')
        .send(confirmBody('whatever'));

      expect(response.status).toBe(401);
    });

    it('refuses an outlet other than the session scope', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      const response = await create(app, sessionId, 'key-outlet', {
        ...confirmBody(quoteId),
        outletId: 'other-outlet',
      });

      expect(response.status).toBe(403);
    });

    it("refuses another session's quote as unknown", async () => {
      const app = newApp();
      const owner = await mint(app);
      const other = await mint(app);
      const { quoteId } = await quote(app, owner);

      const response = await create(app, other, 'key-stolen', confirmBody(quoteId));

      expect(response.status).toBe(409);
    });

    it('refuses a quote whose menu has changed', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      await getDb()
        .collection(COLLECTIONS.menuItems)
        .updateOne(
          { outletId: 'demo-outlet', publicId: 'item-masala-dosa' },
          { $set: { priceMinor: 9000 } },
        );

      const response = await create(app, sessionId, 'key-stale', confirmBody(quoteId));

      expect(response.status).toBe(409);
      expect(response.body.error.message).toMatch(/menu changed/i);
      expect(
        await getDb().collection(ORDER_COLLECTIONS.orders).countDocuments(),
      ).toBe(0);
    });

    it('refuses a quote whose item has since been switched off', async () => {
      const app = newApp();
      const sessionId = await mint(app);
      const { quoteId } = await quote(app, sessionId);

      await getDb()
        .collection(COLLECTIONS.menuItems)
        .updateOne(
          { outletId: 'demo-outlet', publicId: 'item-masala-dosa' },
          { $set: { active: false } },
        );

      const response = await create(app, sessionId, 'key-off', confirmBody(quoteId));

      // The menu fingerprint moves too, so the stale-quote check fires first;
      // either way no order is created at a price nobody agreed to.
      expect(response.status).toBe(409);
    });
  });
});

describe('GET /api/v1/orders/:orderId', () => {
  it('returns the order to its own read capability, with no session', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const { quoteId } = await quote(app, sessionId);
    const created = await create(app, sessionId, 'key-read', confirmBody(quoteId));

    const response = await request(app)
      .get(`/api/v1/orders/${created.body.orderId}`)
      .set('Authorization', `Bearer ${created.body.orderAccessToken}`);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.orderId).toBe(created.body.orderId);
    expect(response.body.token).toBe('1');
    // The capability is never echoed back by a read.
    expect(response.body.orderAccessToken).toBeUndefined();
  });

  it('reports a wrong capability, a session token and an unknown ID alike', async () => {
    const app = newApp();
    const sessionId = await mint(app);
    const { quoteId } = await quote(app, sessionId);
    const created = await create(app, sessionId, 'key-probe', confirmBody(quoteId));
    const orderId = created.body.orderId as string;

    for (const token of [`${created.body.orderAccessToken}x`, sessionId, 'short']) {
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(404);
    }

    const unknown = await request(app)
      .get('/api/v1/orders/11111111-2222-3333-4444-555555555555')
      .set('Authorization', `Bearer ${created.body.orderAccessToken}`);
    expect(unknown.status).toBe(404);
  });

  it('requires a capability at all', async () => {
    const response = await request(newApp()).get('/api/v1/orders/anything');
    expect(response.status).toBe(401);
  });
});
