/**
 * Development seed: writes the synthetic sample menu and its indexes.
 *
 * Run with `npm run seed --workspace backend` against a local database only.
 * The data is obviously fake (docs/DATABASE.md section 5) and every write is an
 * idempotent upsert keyed by `{ outletId, publicId }`, so re-running it is safe.
 *
 * It refuses to run against `NODE_ENV=production`: seeding a real outlet's menu
 * with demo items would be a data incident, not a convenience.
 */

import { loadConfig, loadEnvFile } from '../config/env.js';
import { connectToMongo, disconnectFromMongo, getDb } from './mongo.js';
import { COLLECTIONS } from '../models/menu.js';
import { ensureMenuIndexes } from '../services/menu/mongoMenuRepository.js';
import { SAMPLE_MENU } from '../services/menu/inMemoryMenuRepository.js';
import { assertOutletTimezone } from '../services/orders/pickupToken.js';

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();

  if (config.nodeEnv === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production');
  }
  if (config.mongodbUri === undefined) {
    throw new Error('MONGODB_URI is not configured; nothing to seed');
  }

  await connectToMongo(config);
  const db = getDb();
  await ensureMenuIndexes(db);

  const now = new Date();

  for (const outlet of SAMPLE_MENU.outlets) {
    // Verified before writing: an outlet without a usable timezone cannot
    // allocate pickup tokens, and seeding one would only surface at order time.
    assertOutletTimezone(outlet);
    await db
      .collection(COLLECTIONS.outlets)
      .updateOne(
        { publicId: outlet.publicId },
        { $set: { ...outlet, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true },
      );
  }

  for (const category of SAMPLE_MENU.categories) {
    await db
      .collection(COLLECTIONS.menuCategories)
      .updateOne(
        { outletId: category.outletId, publicId: category.publicId },
        { $set: { ...category, updatedAt: now } },
        { upsert: true },
      );
  }

  for (const item of SAMPLE_MENU.items) {
    await db
      .collection(COLLECTIONS.menuItems)
      .updateOne(
        { outletId: item.outletId, publicId: item.publicId },
        { $set: { ...item, updatedAt: now } },
        { upsert: true },
      );
  }

  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Seeded synthetic menu data',
      database: config.mongodbDbName,
      outlets: SAMPLE_MENU.outlets.length,
      categories: SAMPLE_MENU.categories.length,
      items: SAMPLE_MENU.items.length,
    }),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Seeding failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => disconnectFromMongo());
