/**
 * MongoDB integration tests for persisted draft carts.
 *
 * Against a real `mongod`, because the properties that matter here are
 * server-side: the conditional write that makes two backend instances safe,
 * isolation enforced in the query filter, expiry enforced on read rather than
 * by the TTL sweep, and selection-only storage with repricing on read
 * (docs/TESTING.md section 2).
 *
 * The cart service is driven through the real store in places, so the test
 * covers the path a request actually takes rather than the store alone.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Db, IndexDescription } from 'mongodb';
import {
  MONGO_HOOK_TIMEOUT_MS,
  startTestMongo,
  type TestMongo,
} from '../../db/testMongoServer.js';
import { ApiError } from '../../middleware/errors.js';
import { SESSION_COLLECTIONS, type CartDraftDoc } from '../../models/sessions.js';
import { hashSessionKey } from '../sessions/sessionKey.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
} from '../menu/inMemoryMenuRepository.js';
import { createMenuService } from '../menu/menuService.js';
import { createCartService, type CartService } from './cartService.js';
import {
  CART_TTL_MS,
  CartRevisionConflictError,
  type CartRecord,
  type CartStore,
} from './cartStore.js';
import { createMongoCartStore, ensureCartDraftIndexes } from './mongoCartStore.js';

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo();
}, MONGO_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await mongo?.stop();
});

afterEach(async () => {
  await mongo.reset();
});

function db(): Db {
  return mongo.db;
}

/** A session deadline far enough out that only the draft TTL binds. */
const SESSION_DEADLINE_MS = 9_999_999_999_999;
const SESSION = {
  sessionId: 'session-one',
  outletId: 'demo-outlet',
  expiresAtMs: SESSION_DEADLINE_MS,
} as const;
const OTHER_SESSION = {
  sessionId: 'session-two',
  outletId: 'demo-outlet',
  expiresAtMs: SESSION_DEADLINE_MS,
} as const;

/** One backend instance: its own store and service over the shared database. */
function instance(options: { readonly now?: () => number } = {}): {
  readonly store: CartStore;
  readonly service: CartService;
} {
  const store = createMongoCartStore(db, options);
  const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
  return { store, service: createCartService({ menuService, cartStore: store }) };
}

/** A record one revision on from `base`, as the cart service builds one. */
function next(base: CartRecord, lines: CartRecord['lines']): CartRecord {
  return { ...base, revision: base.revision + 1, lines };
}

const LINE = {
  lineId: 'line-1',
  menuItemId: 'item-idli',
  optionIds: [] as readonly string[],
  quantity: 2,
  nameSnapshot: 'Idli',
} as const;

describe('persistence and restart recovery', () => {
  it('serves a draft written before a restart, repriced from the live menu', async () => {
    const before = instance();
    await before.service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 2 });

    // A fresh store and service over the same database is what a restarted
    // process, or a second instance, has.
    const after = instance();
    const cart = await after.service.getCart(SESSION);

    expect(cart.revision).toBe(1);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.quantity).toBe(2);
    // Priced on read, from the menu, not from anything stored.
    expect(cart.items[0]?.unitPriceMinor).toBeGreaterThan(0);
    expect(cart.subtotalMinor).toBe(cart.items[0]?.lineTotalMinor);
  });

  it('lets a second instance keep editing the same draft', async () => {
    const first = instance();
    const second = instance();

    const added = await first.service.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });
    const extended = await second.service.addItem(SESSION, {
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });

    expect(extended.cartId).toBe(added.cartId);
    expect(extended.revision).toBe(2);
    expect(extended.items).toHaveLength(2);
  });
});

describe('stored shape', () => {
  it('stores selections only, and never the session ID', async () => {
    const { service } = instance();
    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 2 });

    const docs = await db()
      .collection(SESSION_COLLECTIONS.cartDrafts)
      .find({})
      .toArray();

    expect(docs).toHaveLength(1);
    const doc = docs[0]!;
    expect(doc._id).toBe(hashSessionKey(SESSION.sessionId));
    expect(JSON.stringify(doc)).not.toContain(SESSION.sessionId);

    // No price, total or currency anywhere in a stored line.
    const line = (doc['lines'] as Record<string, unknown>[])[0]!;
    expect(Object.keys(line).sort()).toEqual([
      'lineId',
      'menuItemId',
      'nameSnapshot',
      'optionIds',
      'quantity',
    ]);
    expect(JSON.stringify(doc)).not.toMatch(/Minor|currency/i);
  });

  it('declares only a TTL index, because the session hash is the primary key', async () => {
    await ensureCartDraftIndexes(db());
    await ensureCartDraftIndexes(db());

    const indexes = (await db()
      .collection(SESSION_COLLECTIONS.cartDrafts)
      .indexes()) as IndexDescription[];
    const ttl = indexes.find((index) => index.name === 'cart_draft_ttl');

    expect(ttl?.key).toEqual({ expiresAt: 1 });
    expect(ttl?.expireAfterSeconds).toBe(0);
    expect(indexes.map((index) => index.name).sort()).toEqual([
      '_id_',
      'cart_draft_ttl',
    ]);
  });
});

describe('isolation', () => {
  it('never returns a draft under another outlet scope', async () => {
    const { store, service } = instance();
    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    expect(await store.get(SESSION.sessionId, 'other-outlet')).toBeUndefined();
    expect((await store.get(SESSION.sessionId, 'demo-outlet'))?.lines).toHaveLength(1);
  });

  it('never returns one session draft to another session', async () => {
    const { store, service } = instance();
    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    expect(await store.get(OTHER_SESSION.sessionId, 'demo-outlet')).toBeUndefined();
    expect((await service.getCart(OTHER_SESSION)).items).toEqual([]);
  });

  it('refuses a write that names a different outlet than the stored draft', async () => {
    const { store, service } = instance();
    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });
    const stored = (await store.get(SESSION.sessionId, 'demo-outlet'))!;

    // Defence in depth: a session is outlet-bound, so this can only happen if
    // that invariant is ever broken - and it must not overwrite the draft.
    await expect(
      store.save(next({ ...stored, outletId: 'other-outlet' }, [LINE]), SESSION_DEADLINE_MS),
    ).rejects.toBeInstanceOf(CartRevisionConflictError);
    expect((await store.get(SESSION.sessionId, 'demo-outlet'))?.lines).toHaveLength(1);
  });
});

describe('expiry', () => {
  it('refuses an expired draft on read while the document is still there', async () => {
    let clock = 1_000_000;
    const { store, service } = instance({ now: () => clock });
    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    clock += 30 * 60 * 1000;

    expect(await store.get(SESSION.sessionId, SESSION.outletId)).toBeUndefined();
    // The TTL monitor has collected nothing: the filter is what makes the
    // draft unusable, so a draft can never outlive its session.
    expect(
      await db().collection(SESSION_COLLECTIONS.cartDrafts).countDocuments({}),
    ).toBe(1);
    expect(await store.size()).toBe(0);
    // And the customer sees an empty draft, not someone else's or a stale one.
    expect((await service.getCart(SESSION)).items).toEqual([]);
  });

  it('starts a fresh draft over an expired document', async () => {
    let clock = 1_000_000;
    const { service } = instance({ now: () => clock });
    const first = await service.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });

    clock += 30 * 60 * 1000;
    const second = await service.addItem(SESSION, {
      menuItemId: 'item-idli',
      quantity: 1,
    });

    expect(second.cartId).not.toBe(first.cartId);
    expect(second.revision).toBe(1);
    expect(second.items).toHaveLength(1);
  });
});

describe('clamping to the session deadline', () => {
  it('caps a draft deadline at the session deadline, not 30 minutes on', async () => {
    const start = 1_000_000;
    const sessionDeadline = start + 5 * 60 * 1000;
    const { store } = instance({ now: () => start });

    const created = store.create(SESSION.sessionId, SESSION.outletId, sessionDeadline);
    expect(created.expiresAtMs).toBe(sessionDeadline);

    const saved = await store.save({ ...created, revision: 1, lines: [LINE] }, sessionDeadline);
    expect(saved.expiresAtMs).toBe(sessionDeadline);

    const doc = await db()
      .collection<CartDraftDoc>(SESSION_COLLECTIONS.cartDrafts)
      .findOne({ _id: hashSessionKey(SESSION.sessionId) });
    expect(doc?.expiresAt.getTime()).toBe(sessionDeadline);
  });

  it('keeps the draft TTL when the session outlives it', async () => {
    const start = 1_000_000;
    const { store } = instance({ now: () => start });

    const created = store.create(SESSION.sessionId, SESSION.outletId, SESSION_DEADLINE_MS);

    expect(created.expiresAtMs).toBe(start + CART_TTL_MS);
  });

  it('refuses the draft once the session deadline passes, however recent the write', async () => {
    let clock = 1_000_000;
    const sessionDeadline = clock + 60_000;
    const { store, service } = instance({ now: () => clock });
    const scope = { ...SESSION, expiresAtMs: sessionDeadline };

    await service.addItem(scope, { menuItemId: 'item-idli', quantity: 1 });

    // A write one second before the session dies must not buy the draft
    // another 30 minutes.
    clock = sessionDeadline - 1_000;
    await service.addItem(scope, { menuItemId: 'item-filter-coffee', quantity: 1 });

    clock = sessionDeadline;
    expect(await store.get(scope.sessionId, scope.outletId)).toBeUndefined();
    expect((await service.getCart(scope)).items).toEqual([]);
  });
});

describe('concurrency', () => {
  it('refuses a save built on a revision another instance has moved', async () => {
    const first = instance();
    const second = instance();

    await first.service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });
    const stale = (await first.store.get(SESSION.sessionId, SESSION.outletId))!;

    // Second instance accepts an edit, so `stale` is now a revision behind.
    await second.service.addItem(SESSION, {
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });

    const error = await first.store.save(next(stale, [LINE]), SESSION_DEADLINE_MS).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CartRevisionConflictError);
    expect((error as CartRevisionConflictError).storedRevision).toBe(2);
    // The accepted edit is intact: nothing was lost to the stale write.
    expect((await second.service.getCart(SESSION)).items).toHaveLength(2);
  });

  it('loses no line when two instances add at the same moment', async () => {
    const first = instance();
    const second = instance();

    const [a, b] = await Promise.all([
      first.service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
      second.service.addItem(SESSION, { menuItemId: 'item-filter-coffee', quantity: 1 }),
    ]);

    // Whichever landed second retried against the fresh draft rather than
    // overwriting it, so both selections survive.
    const final = await first.service.getCart(SESSION);
    expect(final.items).toHaveLength(2);
    expect(final.revision).toBe(2);
    expect(Math.max(a.revision, b.revision)).toBe(2);
  });

  it('serializes many concurrent adds across two instances', async () => {
    const first = instance();
    const second = instance();

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).service.addItem(SESSION, {
          menuItemId: 'item-idli',
          quantity: 1,
        }),
      ),
    );

    // Identical selections merge, so the six adds are one line of six.
    const final = await first.service.getCart(SESSION);
    expect(final.items).toHaveLength(1);
    expect(final.items[0]?.quantity).toBe(6);
    expect(final.revision).toBe(6);
  });

  it('reports a stale If-Match as 409 rather than retrying it', async () => {
    const first = instance();
    const second = instance();
    await first.service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });
    await second.service.addItem(SESSION, {
      menuItemId: 'item-filter-coffee',
      quantity: 1,
    });

    const error = await first.service
      .addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }, { expectedRevision: 1 })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409 });
  });

  it('refuses a new draft rather than evicting one when full', async () => {
    const store = createMongoCartStore(db, { maxCarts: 1 });
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
    const service = createCartService({ menuService, cartStore: store });

    await service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 });

    const error = await service
      .addItem(OTHER_SESSION, { menuItemId: 'item-idli', quantity: 1 })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503 });
    // The draft already there is untouched.
    expect((await service.getCart(SESSION)).items).toHaveLength(1);
  });
});

describe('database failure', () => {
  it('is a retryable 503 on every operation when the database is absent', async () => {
    const store = createMongoCartStore(() => {
      throw new Error('MongoDB is not connected');
    });

    for (const call of [
      () => store.get(SESSION.sessionId, SESSION.outletId),
      () =>
        store.save(
          next(
            store.create(SESSION.sessionId, SESSION.outletId, SESSION_DEADLINE_MS),
            [LINE],
          ),
          SESSION_DEADLINE_MS,
        ),
      () => store.delete(SESSION.sessionId),
      () => store.size(),
    ]) {
      const error = await call().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503 });
    }
  });

  it('never reports a draft as saved when the write failed', async () => {
    const menuService = createMenuService(createInMemoryMenuRepository(SAMPLE_MENU));
    const store = createMongoCartStore(() => {
      throw new Error('MongoDB is not connected');
    });
    const service = createCartService({ menuService, cartStore: store });

    await expect(
      service.addItem(SESSION, { menuItemId: 'item-idli', quantity: 1 }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
