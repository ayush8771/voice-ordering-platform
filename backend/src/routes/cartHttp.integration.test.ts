/**
 * HTTP integration tests for ordering sessions and draft carts over a real
 * `mongod`.
 *
 * The production wiring is used as-is: `connectToMongo` plus `createApp` with
 * no injected doubles, so the app resolves the database per call exactly as a
 * deployed instance does. That is the only way to catch a fault that lives in
 * the wiring rather than in a service (docs/TESTING.md section 2).
 *
 * The expired-session block is the one exception: it injects a session service
 * built on the same database with a short lifetime and a hand-moved clock,
 * because the real deadlines are 10 and 30 minutes.
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
import { SESSION_COLLECTIONS } from '../models/sessions.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { ensureMenuIndexes } from '../services/menu/mongoMenuRepository.js';
import { ensureCartDraftIndexes } from '../services/cart/index.js';
import {
  createMongoOrderingSessionService,
  ensureOrderingSessionIndexes,
} from '../services/sessions/mongoOrderingSessionService.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';

let mongo: TestMongo;
let config: AppConfig;

beforeAll(async () => {
  mongo = await startTestMongo('vop_http_integration');
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

/** Seeds the menu the way the seed script does, then the indexes. */
beforeEach(async () => {
  const db = getDb();
  await ensureMenuIndexes(db);
  await ensureOrderingSessionIndexes(db);
  await ensureCartDraftIndexes(db);
  await db.collection(COLLECTIONS.outlets).insertMany(structuredClone([...SAMPLE_MENU.outlets]));
  await db
    .collection(COLLECTIONS.menuCategories)
    .insertMany(structuredClone([...SAMPLE_MENU.categories]));
  await db.collection(COLLECTIONS.menuItems).insertMany(structuredClone([...SAMPLE_MENU.items]));
});

/** A fresh app over the same database: what a restart or a second instance is. */
function newApp(orderingSessions?: OrderingSessionService): Express {
  return createApp(config, orderingSessions === undefined ? {} : { orderingSessions });
}

async function mint(app: Express, outletId = 'demo-outlet'): Promise<string> {
  const response = await request(app)
    .post('/api/v1/ordering-sessions')
    .send({ outletId, channel: 'qr' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.sessionId as string;
}

function auth(app: Express, method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string) {
  return request(app)[method](path).set('Authorization', `Bearer ${token}`);
}

describe('POST /api/v1/ordering-sessions', () => {
  it('persists the session and returns the documented body', async () => {
    const app = newApp();
    const response = await request(app)
      .post('/api/v1/ordering-sessions')
      .send({ outletId: 'demo-outlet', channel: 'kiosk' });

    expect(response.status).toBe(201);
    expect(response.body.outletId).toBe('demo-outlet');
    expect(response.body.channel).toBe('kiosk');
    expect(response.body.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Number.isNaN(Date.parse(response.body.expiresAt))).toBe(false);

    const docs = await getDb()
      .collection(SESSION_COLLECTIONS.orderingSessions)
      .find({})
      .toArray();
    expect(docs).toHaveLength(1);
    // The token is never written, only its hash.
    expect(JSON.stringify(docs)).not.toContain(response.body.sessionId);
  });

  it('refuses an unknown outlet without minting anything', async () => {
    const app = newApp();
    const response = await request(app)
      .post('/api/v1/ordering-sessions')
      .send({ outletId: 'no-such-outlet', channel: 'qr' });

    expect(response.status).toBe(404);
    expect(
      await getDb().collection(SESSION_COLLECTIONS.orderingSessions).countDocuments(),
    ).toBe(0);
  });
});

describe('cart CRUD over HTTP', () => {
  it('walks add, read, update, remove and clear', async () => {
    const app = newApp();
    const token = await mint(app);

    const empty = await auth(app, 'get', '/api/v1/cart', token);
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
    expect(empty.body.revision).toBe(0);

    const added = await auth(app, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-idli',
      quantity: 2,
    });
    expect(added.status).toBe(200);
    expect(added.body.revision).toBe(1);
    expect(added.body.items).toHaveLength(1);
    // Priced from the live menu on read, never from storage.
    expect(added.body.items[0].unitPriceMinor).toBeGreaterThan(0);
    expect(added.body.subtotalMinor).toBe(added.body.items[0].lineTotalMinor);
    const lineId = added.body.items[0].lineId as string;

    const read = await auth(app, 'get', '/api/v1/cart', token);
    expect(read.body.cartId).toBe(added.body.cartId);
    expect(read.body.items).toHaveLength(1);

    const patched = await auth(app, 'patch', `/api/v1/cart/items/${lineId}`, token)
      .set('If-Match', String(read.body.revision))
      .send({ quantity: 3 });
    expect(patched.status).toBe(200);
    expect(patched.body.revision).toBe(2);
    expect(patched.body.items[0].quantity).toBe(3);

    const stale = await auth(app, 'patch', `/api/v1/cart/items/${lineId}`, token)
      .set('If-Match', '1')
      .send({ quantity: 4 });
    expect(stale.status).toBe(409);

    const removed = await auth(app, 'delete', `/api/v1/cart/items/${lineId}`, token);
    expect(removed.status).toBe(200);
    expect(removed.body.items).toEqual([]);

    await auth(app, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });
    const cleared = await auth(app, 'delete', '/api/v1/cart', token);
    expect(cleared.status).toBe(200);
    expect(cleared.body.items).toEqual([]);
  });

  it('stores selections only, with no money in the document', async () => {
    const app = newApp();
    const token = await mint(app);
    await auth(app, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-idli',
      quantity: 2,
    });

    const docs = await getDb().collection(SESSION_COLLECTIONS.cartDrafts).find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(JSON.stringify(docs)).not.toMatch(/Minor|currency/i);
    expect(JSON.stringify(docs)).not.toContain(token);
  });

  it('keeps one session draft invisible to another', async () => {
    const app = newApp();
    const mine = await mint(app);
    const theirs = await mint(app);

    await auth(app, 'post', '/api/v1/cart/items', mine).send({
      menuItemId: 'item-idli',
      quantity: 1,
    });

    const other = await auth(app, 'get', '/api/v1/cart', theirs);
    expect(other.status).toBe(200);
    expect(other.body.items).toEqual([]);
  });

  it('refuses a request with no session', async () => {
    const app = newApp();
    const response = await request(app).get('/api/v1/cart');
    expect(response.status).toBe(401);
  });

  it('refuses a body that names another outlet', async () => {
    const app = newApp();
    const token = await mint(app);

    const response = await auth(app, 'post', '/api/v1/cart/items', token).send({
      outletId: 'other-outlet',
      menuItemId: 'item-idli',
      quantity: 1,
    });

    expect(response.status).toBe(403);
  });
});

describe('restart recovery over HTTP', () => {
  it('serves the session and its draft to a new app instance', async () => {
    const before = newApp();
    const token = await mint(before);
    const added = await auth(before, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-idli',
      quantity: 2,
    });
    expect(added.status).toBe(200);

    // A new app over the same database: the restart, or the second instance.
    const after = newApp();
    const recovered = await auth(after, 'get', '/api/v1/cart', token);

    expect(recovered.status).toBe(200);
    expect(recovered.body.cartId).toBe(added.body.cartId);
    expect(recovered.body.revision).toBe(1);
    expect(recovered.body.items).toHaveLength(1);
    expect(recovered.body.items[0].quantity).toBe(2);
  });

  it('lets a second instance keep editing the same draft', async () => {
    const first = newApp();
    const second = newApp();
    const token = await mint(first);

    await auth(first, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-idli',
      quantity: 1,
    });
    const extended = await auth(second, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });

    expect(extended.status).toBe(200);
    expect(extended.body.revision).toBe(2);
    expect(extended.body.items).toHaveLength(2);
  });
});

describe('expired sessions over HTTP', () => {
  it('reports an expired token exactly like an unknown one, and hides the draft', async () => {
    let clock = Date.now();
    const sessions = createMongoOrderingSessionService(getDb, {
      ttlMs: 60_000,
      idleTtlMs: 60_000,
      now: () => clock,
    });
    const app = newApp(sessions);
    const token = await mint(app);

    const added = await auth(app, 'post', '/api/v1/cart/items', token).send({
      menuItemId: 'item-idli',
      quantity: 1,
    });
    expect(added.status).toBe(200);

    clock += 60_000;

    const expired = await auth(app, 'get', '/api/v1/cart', token);
    const unknown = await auth(
      app,
      'get',
      '/api/v1/cart',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );

    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({
      ...unknown.body,
      error: { ...unknown.body.error, requestId: expired.body.error.requestId },
    });
    // The draft document is still there - the TTL has not run - and is now
    // unreachable, which is what makes the session's expiry authoritative.
    expect(
      await getDb().collection(SESSION_COLLECTIONS.cartDrafts).countDocuments(),
    ).toBe(1);
  });

  it('refuses every cart verb once the session has expired', async () => {
    let clock = Date.now();
    const sessions = createMongoOrderingSessionService(getDb, {
      ttlMs: 60_000,
      idleTtlMs: 60_000,
      now: () => clock,
    });
    const app = newApp(sessions);
    const token = await mint(app);
    clock += 60_000;

    for (const [method, path] of [
      ['get', '/api/v1/cart'],
      ['post', '/api/v1/cart/items'],
      ['patch', '/api/v1/cart/items/line-1'],
      ['delete', '/api/v1/cart/items/line-1'],
      ['delete', '/api/v1/cart'],
    ] as const) {
      const response = await auth(app, method, path, token).send({});
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });
});
