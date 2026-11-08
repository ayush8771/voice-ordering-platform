/**
 * Menu service: the authority on what exists, what it costs and whether it is
 * available (docs/ARCHITECTURE.md section 3).
 *
 * It returns the public menu for clients and an internal snapshot for the quote
 * service and the conversation service's menu port. No caller can price
 * anything without going through this snapshot, which is what keeps prices
 * server-side (docs/SECURITY.md section 2).
 */

import { createHash } from 'node:crypto';
import type { MenuCategory, MenuItem, MenuOption, MenuResponse } from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';
import { assertMinorUnits } from '../../models/money.js';
import type { MenuRepository } from './menuRepository.js';

/** Internal view used for pricing and validation. */
export interface MenuSnapshot {
  readonly outlet: OutletDoc;
  readonly menuVersion: string;
  readonly categories: readonly MenuCategoryDoc[];
  /** Keyed by public item ID. Includes inactive items. */
  readonly itemsById: ReadonlyMap<string, MenuItemDoc>;
  /** Listing order, as served to clients. */
  readonly items: readonly MenuItemDoc[];
}

export interface MenuService {
  getSnapshot(outletId: string): Promise<MenuSnapshot>;
  getPublicMenu(outletId: string): Promise<MenuResponse>;
}

/**
 * Fingerprint of the menu as served.
 *
 * Derived from the data rather than stored as a counter, so it cannot drift out
 * of sync with the menu and needs no write path. Any change to an item's price,
 * availability, category or options - or to a category's name or order -
 * changes the value, which is what makes a stale quote detectable.
 */
export function computeMenuVersion(
  categories: readonly MenuCategoryDoc[],
  items: readonly MenuItemDoc[],
): string {
  const canonicalCategories = [...categories]
    .map((category) => [category.publicId, category.name, category.sortOrder])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  const canonicalItems = [...items]
    .map((item) => [
      item.publicId,
      item.name,
      item.priceMinor,
      item.active ? 1 : 0,
      item.categoryId ?? '',
      [...(item.options ?? [])]
        .map((option) => [
          option.publicId,
          option.priceDeltaMinor,
          option.active ? 1 : 0,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  return createHash('sha256')
    .update(JSON.stringify([canonicalCategories, canonicalItems]))
    .digest('hex')
    .slice(0, 16);
}

function toPublicOption(option: {
  publicId: string;
  label: string;
  priceDeltaMinor: number;
}): MenuOption {
  return {
    id: option.publicId,
    label: option.label,
    priceDeltaMinor: option.priceDeltaMinor,
  };
}

function toPublicItem(item: MenuItemDoc): MenuItem {
  // A stored price that is not a valid integer amount is a data fault, not a
  // customer error: fail loudly rather than serve a broken price.
  assertMinorUnits(item.priceMinor, `menuItem ${item.publicId} priceMinor`);

  return {
    id: item.publicId,
    name: item.name,
    ...(item.description === undefined ? {} : { description: item.description }),
    priceMinor: item.priceMinor,
    currency: item.currency,
    // Merchant availability. Inactive items stay visible but unselectable so
    // the customer sees why, instead of the item silently vanishing.
    available: item.active,
    ...(item.categoryId === undefined ? {} : { categoryId: item.categoryId }),
    // Inactive options are omitted entirely: an option a customer cannot pick
    // has no place in the public menu.
    options: (item.options ?? []).filter((option) => option.active).map(toPublicOption),
  };
}

function toPublicCategory(category: MenuCategoryDoc): MenuCategory {
  return {
    id: category.publicId,
    name: category.name,
    sortOrder: category.sortOrder,
  };
}

export function createMenuService(repository: MenuRepository): MenuService {
  async function getSnapshot(outletId: string): Promise<MenuSnapshot> {
    const outlet = await repository.findActiveOutlet(outletId);
    if (outlet === undefined) {
      // An inactive outlet is reported exactly like an unknown one, so the
      // response does not disclose that it exists (docs/API.md).
      throw ApiError.notFound('Outlet not found');
    }

    const [categories, items] = await Promise.all([
      repository.listCategories(outletId),
      repository.listItems(outletId),
    ]);

    return {
      outlet,
      menuVersion: computeMenuVersion(categories, items),
      categories,
      items,
      itemsById: new Map(items.map((item) => [item.publicId, item])),
    };
  }

  return {
    getSnapshot,
    async getPublicMenu(outletId: string): Promise<MenuResponse> {
      const snapshot = await getSnapshot(outletId);

      return {
        outlet: {
          id: snapshot.outlet.publicId,
          name: snapshot.outlet.name,
          currency: snapshot.outlet.currency,
        },
        menuVersion: snapshot.menuVersion,
        categories: snapshot.categories.map(toPublicCategory),
        items: snapshot.items.map(toPublicItem),
      };
    },
  };
}
