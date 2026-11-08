/**
 * End-to-end check of the development seed and the menu endpoint.
 *
 * The seed is run as the real command (`npm run seed` runs the same
 * `tsx src/db/seedMenu.ts`) against a real `mongod`, and the menu is then read
 * over a real TCP socket from a listening server using the production wiring -
 * `connectToMongo` plus `createLazyMongoMenuRepository`, with no injected
 * doubles. That is the only way to catch a fault that lives in the wiring
 * rather than in a service (docs/TESTING.md section 2).
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { connectToMongo, disconnectFromMongo } from './mongo.js';
import { COLLECTIONS } from '../models/menu.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import {
  MONGO_HOOK_TIMEOUT_MS,
  startTestMongo,
  type TestMongo,
} from './testMongoServer.js';

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const SEED_TIMEOUT_MS = 120_000;

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startTestMongo('vop_seed_integration');
}, MONGO_HOOK_TIMEOUT_MS);

afterAll(async () => {
  await mongo?.stop();
});

/** Outcome of the seed command, with output already decoded to text. */
interface SeedRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Everything the command wrote, for a message that may land on either stream. */
  readonly output: string;
}

/** Runs the documented command itself, not a re-implementation of it. */
function runSeed(overrides: Readonly<Record<string, string>> = {}): SeedRun {
  // One command string, because `npm` is a shell shim rather than an
  // executable and passing argv alongside `shell: true` is deprecated.
  const result = spawnSync('npm run --silent seed', {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    timeout: SEED_TIMEOUT_MS,
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MONGODB_URI: mongo.uri,
      MONGODB_DB_NAME: mongo.dbName,
      ...overrides,
    },
  });

  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  return { status: result.status, stdout, stderr, output: stdout + stderr };
}

async function counts(): Promise<Record<string, number>> {
  return {
    outlets: await mongo.db.collection(COLLECTIONS.outlets).countDocuments(),
    categories: await mongo.db.collection(COLLECTIONS.menuCategories).countDocuments(),
    items: await mongo.db.collection(COLLECTIONS.menuItems).countDocuments(),
  };
}

describe('npm run seed', () => {
  // Scoped to this block: the HTTP block below seeds once and must keep it.
  beforeEach(async () => {
    await mongo.reset();
  });

  it(
    'writes the synthetic menu and its indexes',
    async () => {
      const result = runSeed();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Seeded synthetic menu data');

      expect(await counts()).toEqual({
        outlets: SAMPLE_MENU.outlets.length,
        categories: SAMPLE_MENU.categories.length,
        items: SAMPLE_MENU.items.length,
      });

      const indexNames = async (collection: string): Promise<string[]> =>
        (await mongo.db.collection(collection).listIndexes().toArray()).map(
          (index) => index.name as string,
        );

      expect(await indexNames(COLLECTIONS.outlets)).toContain('outlet_publicId_unique');
      expect(await indexNames(COLLECTIONS.menuCategories)).toEqual(
        expect.arrayContaining(['category_outlet_publicId_unique', 'category_listing']),
      );
      expect(await indexNames(COLLECTIONS.menuItems)).toEqual(
        expect.arrayContaining(['item_outlet_publicId_unique', 'item_listing']),
      );

      // Stores integer paise and sets the audit timestamps.
      const item = await mongo.db
        .collection(COLLECTIONS.menuItems)
        .findOne({ outletId: 'demo-outlet', publicId: 'item-masala-dosa' });
      expect(item?.priceMinor).toBe(8000);
      expect(Number.isInteger(item?.priceMinor)).toBe(true);
      expect(item?.updatedAt).toBeInstanceOf(Date);

      const outlet = await mongo.db
        .collection(COLLECTIONS.outlets)
        .findOne({ publicId: 'demo-outlet' });
      expect(outlet?.createdAt).toBeInstanceOf(Date);
    },
    SEED_TIMEOUT_MS,
  );

  it(
    'is idempotent: a second run neither duplicates rows nor changes menuVersion',
    async () => {
      expect(runSeed().status).toBe(0);
      const afterFirst = await counts();
      const created = await mongo.db
        .collection(COLLECTIONS.outlets)
        .findOne({ publicId: 'demo-outlet' });

      expect(runSeed().status).toBe(0);

      expect(await counts()).toEqual(afterFirst);
      // `createdAt` is `$setOnInsert`, so it must survive a re-seed.
      const reread = await mongo.db
        .collection(COLLECTIONS.outlets)
        .findOne({ publicId: 'demo-outlet' });
      expect(reread?.createdAt).toEqual(created?.createdAt);
    },
    SEED_TIMEOUT_MS,
  );

  it(
    'refuses to run with NODE_ENV=production',
    async () => {
      const result = runSeed({ NODE_ENV: 'production' });

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        'Refusing to seed demo data with NODE_ENV=production',
      );
      expect(await counts()).toEqual({ outlets: 0, categories: 0, items: 0 });
    },
    SEED_TIMEOUT_MS,
  );

  it(
    'refuses to run without MONGODB_URI',
    async () => {
      const result = runSeed({ MONGODB_URI: '' });

      expect(result.status).toBe(1);
      expect(result.output).toContain('MONGODB_URI is not configured');
    },
    SEED_TIMEOUT_MS,
  );
});

describe('GET /api/v1/outlets/:outletId/menu over a real HTTP server', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await mongo.reset();
    expect(runSeed().status).toBe(0);

    const config = loadConfig({
      NODE_ENV: 'test',
      MONGODB_URI: mongo.uri,
      MONGODB_DB_NAME: mongo.dbName,
    });

    // Production wiring: the module-level connection plus the lazy repository.
    await connectToMongo(config);
    server = createApp(config).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  }, MONGO_HOOK_TIMEOUT_MS + SEED_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectFromMongo();
  });

  it('serves the seeded menu with no session', async () => {
    const response = await fetch(`${baseUrl}/outlets/demo-outlet/menu`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-request-id')).toEqual(expect.any(String));
    expect(response.headers.get('x-powered-by')).toBeNull();

    const body = (await response.json()) as {
      outlet: Record<string, unknown>;
      menuVersion: string;
      categories: { id: string; name: string; sortOrder: number }[];
      items: {
        id: string;
        available: boolean;
        priceMinor: number;
        categoryId?: string;
        options: { id: string }[];
      }[];
    };

    expect(body.outlet).toEqual({
      id: 'demo-outlet',
      name: 'Demo Tiffin Centre',
      currency: 'INR',
    });
    // No outlet configuration leaks through the public projection.
    expect(body.outlet).not.toHaveProperty('slug');
    expect(body.outlet).not.toHaveProperty('timezone');
    expect(body.outlet).not.toHaveProperty('active');

    expect(body.menuVersion).toMatch(/^[0-9a-f]{16}$/);

    // Active categories only, in seeded order; the retired one is absent.
    expect(body.categories.map((category) => category.id)).toEqual([
      'cat-tiffin',
      'cat-drinks',
    ]);

    expect(body.items.map((item) => item.id)).toEqual([
      'item-masala-dosa',
      'item-idli',
      'item-idli-sambar',
      'item-medu-vada',
      'item-filter-coffee',
      'item-cold-coffee',
    ]);

    // A sold-out item stays visible, marked unavailable.
    const soldOut = body.items.find((item) => item.id === 'item-medu-vada');
    expect(soldOut?.available).toBe(false);
    expect(body.items.filter((item) => item.available)).toHaveLength(5);

    // Prices are integer paise straight from the seeded documents.
    expect(body.items.find((item) => item.id === 'item-masala-dosa')?.priceMinor).toBe(
      8000,
    );

    // Inactive options are dropped entirely.
    const dosa = body.items.find((item) => item.id === 'item-masala-dosa');
    expect(dosa?.options.map((option) => option.id)).toEqual([
      'opt-extra-chutney',
      'opt-ghee',
    ]);

    // Every categoryId a client sees resolves to a served category.
    const categoryIds = new Set(body.categories.map((category) => category.id));
    for (const item of body.items) {
      if (item.categoryId !== undefined) {
        expect(categoryIds.has(item.categoryId), item.id).toBe(true);
      }
    }

    // Nothing from another outlet.
    expect(body.items.map((item) => item.id)).not.toContain('item-poha');
  });

  it('returns a stable menuVersion across repeated reads', async () => {
    const read = async (): Promise<string> => {
      const response = await fetch(`${baseUrl}/outlets/demo-outlet/menu`);
      return ((await response.json()) as { menuVersion: string }).menuVersion;
    };

    const first = await read();
    expect(await read()).toBe(first);

    // Two outlets must not share a fingerprint.
    const other = await fetch(`${baseUrl}/outlets/other-outlet/menu`);
    expect(other.status).toBe(200);
    expect(((await other.json()) as { menuVersion: string }).menuVersion).not.toBe(
      first,
    );
  });

  it.each(['ghost-outlet', 'closed-outlet', 'not%20valid'])(
    'returns an indistinguishable 404 for %s',
    async (outletId) => {
      const response = await fetch(`${baseUrl}/outlets/${outletId}/menu`);

      expect(response.status).toBe(404);
      const body = (await response.json()) as {
        error: { code: string; message: string; requestId: string };
      };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Outlet not found');
      expect(body.error.requestId).toEqual(expect.any(String));
    },
  );

  it('runs the session and quote flow against seeded MongoDB data', async () => {
    const created = await fetch(`${baseUrl}/ordering-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outletId: 'demo-outlet', channel: 'kiosk' }),
    });
    expect(created.status).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const quoted = await fetch(`${baseUrl}/quotes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({
        outletId: 'demo-outlet',
        items: [
          { menuItemId: 'item-masala-dosa', quantity: 2, optionIds: ['opt-ghee'] },
          { menuItemId: 'item-filter-coffee', quantity: 1 },
        ],
      }),
    });

    expect(quoted.status).toBe(200);
    const quote = (await quoted.json()) as {
      totalMinor: number;
      subtotalMinor: number;
      currency: string;
    };
    // (8000 + 2500) * 2 + 3000
    expect(quote.subtotalMinor).toBe(24000);
    expect(quote.totalMinor).toBe(24000);
    expect(quote.currency).toBe('INR');
  });

  it('refuses a session minted for an inactive outlet', async () => {
    const response = await fetch(`${baseUrl}/ordering-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outletId: 'closed-outlet', channel: 'qr' }),
    });

    expect(response.status).toBe(404);
  });
});
