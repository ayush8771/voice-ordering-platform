/**
 * End-to-end customer ordering journey over a real `mongod`: menu lookup,
 * ordering-session creation, a conversational turn that amends the draft, a
 * touch edit to the same draft, quoting the draft as stored, order creation,
 * order tracking by pickup token, and explicit session revocation.
 *
 * Production wiring throughout (`connectToMongo` plus `createApp` with no
 * injected doubles for menu/session/cart/quote/order), so this is the one
 * suite that would catch a fault living in the wiring between milestones
 * rather than inside one service (docs/TESTING.md section 2). Only the LLM is
 * a fake: it never touches the network, so this suite spends no credits.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
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
import { createConversationService } from '../services/conversation/service.js';
import { createFakeProvider, modelReply } from '../services/conversation/testFakes.js';
import { ensureCartDraftIndexes } from '../services/cart/index.js';
import { createMenuLookup, createMenuService } from '../services/menu/index.js';
import { createLazyMongoMenuRepository } from '../services/menu/mongoMenuRepository.js';
import { ensureMenuIndexes } from '../services/menu/mongoMenuRepository.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { ensureOrderIndexes } from '../services/orders/index.js';
import { ensureOrderingSessionIndexes } from '../services/sessions/mongoOrderingSessionService.js';

let mongo: TestMongo;
let config: AppConfig;

beforeAll(async () => {
  mongo = await startTestMongo('vop_customer_journey');
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

/**
 * One conversational turn's worth of fake replies. A separate `MenuService`
 * instance pointed at the same connected database as `createApp`'s own -
 * `getDb()` resolves the one live connection either way - so the model's
 * menu lookups see the exact rows the cart and quote routes do.
 */
function conversationService(replies: readonly string[]) {
  const menuService = createMenuService(createLazyMongoMenuRepository(getDb));
  return createConversationService({
    provider: createFakeProvider(replies),
    menu: createMenuLookup(menuService),
  });
}

function newApp(withAssistant = true): Express {
  return createApp(
    config,
    withAssistant
      ? {
          conversationService: conversationService([
            modelReply({
              reply: 'Added two masala dosas.',
              toolCalls: [
                {
                  name: 'propose_draft_update',
                  arguments: {
                    type: 'addItem',
                    menuItemRef: 'Masala Dosa',
                    quantity: 2,
                  },
                },
              ],
            }),
          ]),
        }
      : {},
  );
}

async function mint(app: Express, channel: 'qr' | 'kiosk' = 'qr'): Promise<string> {
  const response = await request(app)
    .post('/api/v1/ordering-sessions')
    .send({ outletId: 'demo-outlet', channel });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.sessionId as string;
}

describe('the complete customer ordering journey', () => {
  it('goes from a spoken item through a touch edit to a tracked order', async () => {
    const app = newApp();
    const token = await mint(app);

    // 1. Voice: the conversational turn proposes two masala dosas, applied to
    // the real draft through workflows/conversationTurn.ts.
    const turn = await request(app)
      .post('/api/v1/conversation/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'two masala dosa please', language: 'en', phase: 'building' });

    expect(turn.status, JSON.stringify(turn.body)).toBe(200);
    expect(turn.body.assistantText).toBe('Added two masala dosas.');
    expect(turn.body.cart.items).toHaveLength(1);
    expect(turn.body.cart.items[0]).toMatchObject({
      menuItemId: 'item-masala-dosa',
      quantity: 2,
      unitPriceMinor: 8000,
    });

    // 2. Touch: a second item added through the ordinary cart route, onto
    // the same draft the voice turn just amended.
    const touchAdd = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 1 });
    expect(touchAdd.status, JSON.stringify(touchAdd.body)).toBe(200);

    const cart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(cart.body.items).toHaveLength(2);
    const expectedTotal = 8000 * 2 + 4000;
    expect(cart.body.totalMinor).toBe(expectedTotal);

    // 3. Quote the draft as stored - no re-sending the lines the client just
    // watched the voice and touch paths build (workflows/quoteFromCart.ts).
    const quote = await request(app)
      .post('/api/v1/cart/quote')
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.totalMinor).toBe(expectedTotal);
    expect(quote.body.items).toHaveLength(2);

    // 4. Confirm and create the order from that quote.
    const order = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'journey-key-1')
      .send({
        outletId: 'demo-outlet',
        quoteId: quote.body.quoteId,
        paymentMethod: 'cashAtCounter',
        customerConfirmed: true,
      });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body).toMatchObject({
      token: '1',
      orderStatus: 'accepted',
      paymentStatus: 'dueAtCounter',
      totalMinor: expectedTotal,
      channel: 'qr',
    });
    expect(order.body.items).toHaveLength(2);

    // 5. The draft is gone, but the session still works for another order.
    const afterOrder = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(afterOrder.body.items).toEqual([]);
    expect(afterOrder.body.revision).toBe(0);

    // 6. Tracking by the order's own capability, independent of the session.
    const tracked = await request(app)
      .get(`/api/v1/orders/${order.body.orderId}`)
      .set('Authorization', `Bearer ${order.body.orderAccessToken}`);
    expect(tracked.status).toBe(200);
    expect(tracked.body.token).toBe('1');

    // 7. The customer ends their session; the capability stops working.
    const ended = await request(app)
      .delete('/api/v1/ordering-sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(ended.status).toBe(204);

    const afterEnd = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(afterEnd.status).toBe(401);

    // The order itself, and its own tracking capability, outlive the session
    // that created it - it is a commercial record, not session state.
    const trackedAfterEnd = await request(app)
      .get(`/api/v1/orders/${order.body.orderId}`)
      .set('Authorization', `Bearer ${order.body.orderAccessToken}`);
    expect(trackedAfterEnd.status).toBe(200);
  });

  it('keeps a draft readable by a second app instance against the same database', async () => {
    // Two independent `createApp` calls, one connection: the restart case.
    // Neither carries the other's in-memory state, so this only holds when
    // sessions and drafts are actually read from MongoDB rather than kept in
    // the process that minted them.
    const first = newApp(false);
    const token = await mint(first);

    await request(first)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-idli', quantity: 3 });

    const second = newApp(false);
    const cartOnSecond = await request(second)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`);

    expect(cartOnSecond.status, JSON.stringify(cartOnSecond.body)).toBe(200);
    expect(cartOnSecond.body.items).toHaveLength(1);
    expect(cartOnSecond.body.items[0]).toMatchObject({
      menuItemId: 'item-idli',
      quantity: 3,
    });

    // The order created against the second instance is visible to the first.
    const quote = await request(second)
      .post('/api/v1/cart/quote')
      .set('Authorization', `Bearer ${token}`)
      .send();
    const order = await request(second)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'journey-key-restart')
      .send({
        outletId: 'demo-outlet',
        quoteId: quote.body.quoteId,
        paymentMethod: 'upiQr',
        customerConfirmed: true,
      });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const trackedOnFirst = await request(first)
      .get(`/api/v1/orders/${order.body.orderId}`)
      .set('Authorization', `Bearer ${order.body.orderAccessToken}`);
    expect(trackedOnFirst.status).toBe(200);
  });

  it('falls back to a fully working touch path when the conversational turn fails', async () => {
    // No conversationService at all - the production state with no provider
    // key configured. The conversation route answers 503; every cart/quote/
    // order route is untouched by that.
    const app = newApp(false);
    const token = await mint(app);

    const turn = await request(app)
      .post('/api/v1/conversation/turns')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'two masala dosa please', language: 'en', phase: 'building' });
    expect(turn.status).toBe(503);

    const added = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ menuItemId: 'item-masala-dosa', quantity: 2 });
    expect(added.status, JSON.stringify(added.body)).toBe(200);

    const quote = await request(app)
      .post('/api/v1/cart/quote')
      .set('Authorization', `Bearer ${token}`)
      .send();
    const order = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'journey-key-touch-only')
      .send({
        outletId: 'demo-outlet',
        quoteId: quote.body.quoteId,
        paymentMethod: 'cashAtCounter',
        customerConfirmed: true,
      });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
  });
});
