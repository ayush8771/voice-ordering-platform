/**
 * MongoDB-backed menu repository.
 *
 * Queries are always scoped by `outletId` so one outlet's menu can never be
 * read through another outlet's request (docs/SECURITY.md section 1), and
 * every filter uses equality on validated strings rather than interpolated
 * query objects (docs/SECURITY.md section 4).
 */

import type { Collection, Db } from 'mongodb';
import {
  COLLECTIONS,
  type MenuCategoryDoc,
  type MenuItemDoc,
  type OutletDoc,
} from '../../models/menu.js';
import { ApiError } from '../../middleware/errors.js';
import type { MenuRepository } from './menuRepository.js';

/**
 * The listing order documented on `MenuRepository` (`compareListingOrder`).
 *
 * No collation is supplied, so MongoDB compares strings with its default
 * simple binary collation - UTF-8 byte order, which is Unicode code-point
 * order. `publicId` makes the sort total, so paging and repeated reads are
 * stable and the in-memory repository can reproduce it exactly.
 */
const LISTING_SORT = { sortOrder: 1, name: 1, publicId: 1 } as const;

export class MongoMenuRepository implements MenuRepository {
  constructor(private readonly db: Db) {}

  private get outlets(): Collection<OutletDoc> {
    return this.db.collection<OutletDoc>(COLLECTIONS.outlets);
  }

  private get categories(): Collection<MenuCategoryDoc> {
    return this.db.collection<MenuCategoryDoc>(COLLECTIONS.menuCategories);
  }

  private get items(): Collection<MenuItemDoc> {
    return this.db.collection<MenuItemDoc>(COLLECTIONS.menuItems);
  }

  async findActiveOutlet(outletId: string): Promise<OutletDoc | undefined> {
    const doc = await this.outlets.findOne(
      { publicId: outletId, active: true },
      { projection: { _id: 0 } },
    );
    return doc ?? undefined;
  }

  async listCategories(outletId: string): Promise<readonly MenuCategoryDoc[]> {
    return this.categories
      .find({ outletId, active: true }, { projection: { _id: 0 } })
      .sort(LISTING_SORT)
      .toArray();
  }

  async listItems(outletId: string): Promise<readonly MenuItemDoc[]> {
    return this.items
      .find({ outletId }, { projection: { _id: 0 } })
      .sort(LISTING_SORT)
      .toArray();
  }
}

/**
 * Indexes this milestone relies on (docs/DATABASE.md section 3).
 *
 * Creating indexes is idempotent, so the seed script and a future migration
 * step can both call this.
 */
export async function ensureMenuIndexes(db: Db): Promise<void> {
  await db
    .collection(COLLECTIONS.outlets)
    .createIndex({ publicId: 1 }, { unique: true, name: 'outlet_publicId_unique' });
  await db
    .collection(COLLECTIONS.menuCategories)
    .createIndex(
      { outletId: 1, publicId: 1 },
      { unique: true, name: 'category_outlet_publicId_unique' },
    );
  await db
    .collection(COLLECTIONS.menuCategories)
    .createIndex(
      { outletId: 1, active: 1, sortOrder: 1 },
      { name: 'category_listing' },
    );
  await db
    .collection(COLLECTIONS.menuItems)
    .createIndex(
      { outletId: 1, publicId: 1 },
      { unique: true, name: 'item_outlet_publicId_unique' },
    );
  await db
    .collection(COLLECTIONS.menuItems)
    .createIndex({ outletId: 1, active: 1, sortOrder: 1 }, { name: 'item_listing' });
}

/**
 * Repository that resolves the database per call.
 *
 * The API may start without MongoDB (see `db/mongo.ts`), so a missing
 * connection is translated into a retryable 503 rather than a 500: the request
 * failed, nothing was written, and the caller may try again
 * (docs/ARCHITECTURE.md section 6).
 *
 * Every method is `async` so that a missing connection surfaces as a rejected
 * promise, which is what the `MenuRepository` signatures promise. A synchronous
 * throw would escape a caller that attaches `.catch(...)` instead of awaiting
 * inside an async function, and would skip the sibling call in a `Promise.all`.
 */
export function createLazyMongoMenuRepository(resolveDb: () => Db): MenuRepository {
  function repository(): MenuRepository {
    try {
      return new MongoMenuRepository(resolveDb());
    } catch {
      throw ApiError.unavailable('Menu is temporarily unavailable. Please retry.');
    }
  }

  return {
    async findActiveOutlet(outletId) {
      return repository().findActiveOutlet(outletId);
    },
    async listCategories(outletId) {
      return repository().listCategories(outletId);
    },
    async listItems(outletId) {
      return repository().listItems(outletId);
    },
  };
}
