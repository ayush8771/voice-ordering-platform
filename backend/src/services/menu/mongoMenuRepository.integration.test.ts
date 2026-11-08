/**
 * MongoDB integration tests for the menu repository.
 *
 * These run against a real `mongod`, so they cover what a stub cannot: index
 * creation and uniqueness enforcement, server-side sort order, outlet scoping
 * in the query itself, and the absence of `_id` in projected documents
 * (docs/TESTING.md section 2).
 *
 * The parity block re-runs the same assertions against the in-memory
 * repository. If the two ever diverge, the service tests that use the
 * in-memory implementation stop describing production behaviour.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Db, IndexDescription } from 'mongodb';
import {
  MONGO_HOOK_TIMEOUT_MS,
  startTestMongo,
  type TestMongo,
} from '../../db/testMongoServer.js';
import { COLLECTIONS } from '../../models/menu.js';
import type { MenuRepository } from './menuRepository.js';
import {
  createLazyMongoMenuRepository,
  ensureMenuIndexes,
  MongoMenuRepository,
} from './mongoMenuRepository.js';
import {
  createInMemoryMenuRepository,
  SAMPLE_MENU,
  type MenuDataset,
} from './inMemoryMenuRepository.js';
import { computeMenuVersion, createMenuService } from './menuService.js';

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

/**
 * Writes a dataset the way the seed script does, then builds the indexes.
 *
 * Documents are cloned first: `insertMany` stamps `_id` onto the objects it is
 * given, which would otherwise mutate the shared `SAMPLE_MENU` fixture and
 * make the in-memory repository look like it leaks `_id`.
 */
async function load(db: Db, dataset: MenuDataset = SAMPLE_MENU): Promise<void> {
  await ensureMenuIndexes(db);
  if (dataset.outlets.length > 0) {
    await db
      .collection(COLLECTIONS.outlets)
      .insertMany(structuredClone([...dataset.outlets]));
  }
  if (dataset.categories.length > 0) {
    await db
      .collection(COLLECTIONS.menuCategories)
      .insertMany(structuredClone([...dataset.categories]));
  }
  if (dataset.items.length > 0) {
    await db
      .collection(COLLECTIONS.menuItems)
      .insertMany(structuredClone([...dataset.items]));
  }
}

async function indexesOf(db: Db, collection: string): Promise<IndexDescription[]> {
  const indexes = await db.collection(collection).listIndexes().toArray();
  return indexes as IndexDescription[];
}

describe('ensureMenuIndexes', () => {
  it('creates every index the menu read path relies on', async () => {
    await ensureMenuIndexes(mongo.db);

    expect(await indexesOf(mongo.db, COLLECTIONS.outlets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'outlet_publicId_unique',
          key: { publicId: 1 },
          unique: true,
        }),
      ]),
    );

    expect(await indexesOf(mongo.db, COLLECTIONS.menuCategories)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'category_outlet_publicId_unique',
          key: { outletId: 1, publicId: 1 },
          unique: true,
        }),
        expect.objectContaining({
          name: 'category_listing',
          key: { outletId: 1, active: 1, sortOrder: 1 },
        }),
      ]),
    );

    expect(await indexesOf(mongo.db, COLLECTIONS.menuItems)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'item_outlet_publicId_unique',
          key: { outletId: 1, publicId: 1 },
          unique: true,
        }),
        expect.objectContaining({
          name: 'item_listing',
          key: { outletId: 1, active: 1, sortOrder: 1 },
        }),
      ]),
    );
  });

  it('is idempotent, so the seed script and a migration may both call it', async () => {
    await ensureMenuIndexes(mongo.db);
    const before = await indexesOf(mongo.db, COLLECTIONS.menuItems);

    await expect(ensureMenuIndexes(mongo.db)).resolves.toBeUndefined();

    expect(await indexesOf(mongo.db, COLLECTIONS.menuItems)).toEqual(before);
  });

  it('enforces one document per outlet public ID', async () => {
    await load(mongo.db);

    await expect(
      mongo.db
        .collection(COLLECTIONS.outlets)
        .insertOne({ publicId: 'demo-outlet', name: 'Impostor', active: true }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('scopes item and category uniqueness to the outlet', async () => {
    await load(mongo.db);

    // The same public ID under a different outlet is legitimate.
    await expect(
      mongo.db.collection(COLLECTIONS.menuItems).insertOne({
        publicId: 'item-idli',
        outletId: 'other-outlet',
        name: 'Idli',
        priceMinor: 4000,
        currency: 'INR',
        active: true,
        sortOrder: 9,
      }),
    ).resolves.toBeTruthy();

    // Twice within one outlet is not.
    await expect(
      mongo.db.collection(COLLECTIONS.menuItems).insertOne({
        publicId: 'item-idli',
        outletId: 'demo-outlet',
        name: 'Idli (duplicate)',
        priceMinor: 9900,
        currency: 'INR',
        active: true,
        sortOrder: 9,
      }),
    ).rejects.toThrow(/duplicate key/i);

    await expect(
      mongo.db.collection(COLLECTIONS.menuCategories).insertOne({
        publicId: 'cat-tiffin',
        outletId: 'demo-outlet',
        name: 'Tiffin (duplicate)',
        sortOrder: 9,
        active: true,
      }),
    ).rejects.toThrow(/duplicate key/i);
  });
});

describe('MongoMenuRepository', () => {
  it('never projects the MongoDB _id to a caller', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    const outlet = await repository.findActiveOutlet('demo-outlet');
    const categories = await repository.listCategories('demo-outlet');
    const items = await repository.listItems('demo-outlet');

    expect(outlet).toBeDefined();
    for (const doc of [outlet, ...categories, ...items]) {
      expect(doc).not.toHaveProperty('_id');
    }
  });

  it('hides an inactive outlet and an unknown one identically', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    expect(await repository.findActiveOutlet('closed-outlet')).toBeUndefined();
    expect(await repository.findActiveOutlet('ghost-outlet')).toBeUndefined();
  });

  it('returns only the requested outlet data', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    const items = await repository.listItems('demo-outlet');
    expect(items.length).toBeGreaterThan(0);
    expect([...new Set(items.map((item) => item.outletId))]).toEqual(['demo-outlet']);
    expect(items.map((item) => item.publicId)).not.toContain('item-poha');

    const other = await repository.listItems('other-outlet');
    expect(other.map((item) => item.publicId)).toEqual(['item-poha']);
  });

  it('keeps an inactive item visible so it can be shown as unavailable', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    const items = await repository.listItems('demo-outlet');
    expect(items.map((item) => item.publicId)).toContain('item-medu-vada');
    expect(items.find((item) => item.publicId === 'item-medu-vada')?.active).toBe(
      false,
    );
  });

  it('omits an inactive category from the listing', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    const categories = await repository.listCategories('demo-outlet');
    expect(categories.map((category) => category.publicId)).toEqual([
      'cat-tiffin',
      'cat-drinks',
    ]);
  });

  it('treats an operator-shaped outlet ID as a plain value, not a query', async () => {
    await load(mongo.db);
    const repository = new MongoMenuRepository(mongo.db);

    // Equality on a string: an injected operator can never reach the filter
    // (docs/SECURITY.md section 4).
    expect(await repository.findActiveOutlet('{"$ne":null}')).toBeUndefined();
    expect(await repository.listItems('{"$ne":null}')).toEqual([]);
  });
});

describe('createLazyMongoMenuRepository', () => {
  it('reports an unavailable database as a retryable 503', async () => {
    const repository = createLazyMongoMenuRepository(() => {
      throw new Error('MongoDB is not connected');
    });

    await expect(repository.findActiveOutlet('demo-outlet')).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('resolves the database per call, so a late connection starts working', async () => {
    await load(mongo.db);
    const connection: { db?: Db } = {};
    const repository = createLazyMongoMenuRepository(() => {
      if (connection.db === undefined) throw new Error('MongoDB is not connected');
      return connection.db;
    });

    await expect(repository.listItems('demo-outlet')).rejects.toMatchObject({
      status: 503,
    });

    connection.db = mongo.db;
    expect((await repository.listItems('demo-outlet')).length).toBeGreaterThan(0);
  });
});

/**
 * Behavioural parity.
 *
 * The in-memory repository backs every menu, quote and conversation unit test,
 * so a difference here is a silent lie in that suite. The second dataset uses
 * Kannada, Devanagari and mixed-case names that a byte-wise comparison and a
 * locale-aware comparison order differently, because the product is
 * multilingual (docs/PRD.md).
 */
describe('MongoDB and in-memory repository parity', () => {
  const datasets: readonly (readonly [string, MenuDataset])[] = [
    ['the sample menu', SAMPLE_MENU],
    [
      'multilingual names with equal sortOrder',
      {
        outlets: [
          {
            publicId: 'o1',
            name: 'Multilingual Outlet',
            currency: 'INR',
            active: true,
          },
        ],
        categories: [
          {
            publicId: 'c-b',
            outletId: 'o1',
            name: 'ಪಾನೀಯ',
            sortOrder: 1,
            active: true,
          },
          {
            publicId: 'c-a',
            outletId: 'o1',
            name: 'Tiffin',
            sortOrder: 1,
            active: true,
          },
          {
            publicId: 'c-c',
            outletId: 'o1',
            name: 'नाश्ता',
            sortOrder: 1,
            active: true,
          },
          { publicId: 'c-d', outletId: 'o1', name: 'idli', sortOrder: 1, active: true },
          { publicId: 'c-e', outletId: 'o1', name: 'Idli', sortOrder: 1, active: true },
        ],
        items: [
          {
            publicId: 'i-1',
            outletId: 'o1',
            name: 'ದೋಸೆ',
            priceMinor: 8000,
            currency: 'INR',
            active: true,
            sortOrder: 2,
          },
          {
            publicId: 'i-2',
            outletId: 'o1',
            name: 'Dosa',
            priceMinor: 8000,
            currency: 'INR',
            active: false,
            sortOrder: 2,
          },
          {
            publicId: 'i-3',
            outletId: 'o1',
            name: 'idli',
            priceMinor: 4000,
            currency: 'INR',
            active: true,
            sortOrder: 2,
          },
          {
            publicId: 'i-4',
            outletId: 'o1',
            name: 'Idli',
            priceMinor: 4000,
            currency: 'INR',
            active: true,
            sortOrder: 2,
          },
          {
            publicId: 'i-5',
            outletId: 'o1',
            name: 'चाय',
            priceMinor: 2000,
            currency: 'INR',
            active: true,
            sortOrder: 1,
          },
        ],
      },
    ],
  ];

  it.each(datasets)('agrees on %s', async (_label, dataset) => {
    await load(mongo.db, dataset);
    const mongoRepository: MenuRepository = new MongoMenuRepository(mongo.db);
    const memoryRepository = createInMemoryMenuRepository(dataset);

    const outletIds = [
      ...new Set(dataset.outlets.map((outlet) => outlet.publicId)),
      'ghost-outlet',
    ];

    for (const outletId of outletIds) {
      expect(await mongoRepository.findActiveOutlet(outletId)).toEqual(
        await memoryRepository.findActiveOutlet(outletId),
      );
      expect(await mongoRepository.listCategories(outletId)).toEqual(
        await memoryRepository.listCategories(outletId),
      );
      expect(await mongoRepository.listItems(outletId)).toEqual(
        await memoryRepository.listItems(outletId),
      );
    }
  });

  it('produces the same public menu and menuVersion through either repository', async () => {
    await load(mongo.db);

    const fromMongo = await createMenuService(
      new MongoMenuRepository(mongo.db),
    ).getPublicMenu('demo-outlet');
    const fromMemory = await createMenuService(
      createInMemoryMenuRepository(SAMPLE_MENU),
    ).getPublicMenu('demo-outlet');

    expect(fromMongo).toEqual(fromMemory);

    // The fingerprint covers exactly the rows the snapshot read: this outlet's
    // active categories and all of its items.
    expect(fromMongo.menuVersion).toBe(
      computeMenuVersion(
        SAMPLE_MENU.categories.filter(
          (category) => category.outletId === 'demo-outlet' && category.active,
        ),
        SAMPLE_MENU.items.filter((item) => item.outletId === 'demo-outlet'),
      ),
    );
  });
});

describe('menuVersion against stored data', () => {
  it('is stable across reads and changes when stored data changes', async () => {
    await load(mongo.db);
    const service = createMenuService(new MongoMenuRepository(mongo.db));

    const first = (await service.getSnapshot('demo-outlet')).menuVersion;
    expect((await service.getSnapshot('demo-outlet')).menuVersion).toBe(first);

    const changes: readonly (readonly [string, () => Promise<unknown>])[] = [
      [
        'a price change',
        () =>
          mongo.db
            .collection(COLLECTIONS.menuItems)
            .updateOne(
              { outletId: 'demo-outlet', publicId: 'item-idli' },
              { $set: { priceMinor: 4500 } },
            ),
      ],
      [
        'an availability change',
        () =>
          mongo.db
            .collection(COLLECTIONS.menuItems)
            .updateOne(
              { outletId: 'demo-outlet', publicId: 'item-medu-vada' },
              { $set: { active: true } },
            ),
      ],
      [
        'an option delta change',
        () =>
          mongo.db
            .collection(COLLECTIONS.menuItems)
            .updateOne(
              { outletId: 'demo-outlet', publicId: 'item-masala-dosa' },
              { $set: { 'options.0.priceDeltaMinor': 1200 } },
            ),
      ],
      [
        'a category rename',
        () =>
          mongo.db
            .collection(COLLECTIONS.menuCategories)
            .updateOne(
              { outletId: 'demo-outlet', publicId: 'cat-drinks' },
              { $set: { name: 'Beverages' } },
            ),
      ],
    ];

    const seen = new Set([first]);
    for (const [label, change] of changes) {
      await change();
      const next = (await service.getSnapshot('demo-outlet')).menuVersion;
      expect(seen.has(next), `${label} did not change menuVersion`).toBe(false);
      seen.add(next);
    }
  });

  it('is unaffected by another outlet changing its menu', async () => {
    await load(mongo.db);
    const service = createMenuService(new MongoMenuRepository(mongo.db));

    const before = (await service.getSnapshot('demo-outlet')).menuVersion;
    await mongo.db
      .collection(COLLECTIONS.menuItems)
      .updateOne(
        { outletId: 'other-outlet', publicId: 'item-poha' },
        { $set: { priceMinor: 9900 } },
      );

    expect((await service.getSnapshot('demo-outlet')).menuVersion).toBe(before);
  });
});
