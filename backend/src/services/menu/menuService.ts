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
import {
  DEFAULT_LANGUAGE,
  type Language,
  type MenuCategory,
  type MenuItem,
  type MenuOption,
  type MenuResponse,
} from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import type {
  MenuCategoryDoc,
  MenuItemDoc,
  MenuItemOptionDoc,
  OutletDoc,
} from '../../models/menu.js';
import { assertMinorUnits } from '../../models/money.js';
import {
  categoryName,
  computeContentVersion,
  itemDescription,
  itemName,
  optionLabel,
  outletName,
} from './localize.js';
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
  /**
   * The internal snapshot. Language independent on purpose: it carries the
   * stored documents, translations included, so a pricing caller sees exactly
   * one menu whatever language the customer is using.
   */
  getSnapshot(outletId: string): Promise<MenuSnapshot>;
  /** The public menu with every string resolved into `language`. */
  getPublicMenu(outletId: string, language?: Language): Promise<MenuResponse>;
}

/**
 * Fingerprint of the menu as served.
 *
 * Derived from the data rather than stored as a counter, so it cannot drift out
 * of sync with the menu and needs no write path. Any change to an item's price,
 * availability, category or options - or to a category's name or order -
 * changes the value, which is what makes a stale quote detectable.
 *
 * **Translations are not an input.** This value gates ordering (a moved
 * `menuVersion` is a `409` "re-confirm"), and a Kannada or Hindi string changes
 * no price and no availability. Translating an item therefore leaves every
 * in-flight quote valid; `computeContentVersion` in `localize.ts` is what moves
 * for a text-only edit, and nothing in the ordering path reads it.
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

function toPublicOption(option: MenuItemOptionDoc, language: Language): MenuOption {
  return {
    id: option.publicId,
    label: optionLabel(option, language),
    priceDeltaMinor: option.priceDeltaMinor,
  };
}

function toPublicItem(item: MenuItemDoc, language: Language): MenuItem {
  const description = itemDescription(item, language);

  // A stored price that is not a valid integer amount is a data fault, not a
  // customer error: fail loudly rather than serve a broken price.
  assertMinorUnits(item.priceMinor, `menuItem ${item.publicId} priceMinor`);

  return {
    id: item.publicId,
    name: itemName(item, language),
    ...(description === undefined ? {} : { description }),
    priceMinor: item.priceMinor,
    currency: item.currency,
    // Merchant availability. Inactive items stay visible but unselectable so
    // the customer sees why, instead of the item silently vanishing.
    available: item.active,
    ...(item.categoryId === undefined ? {} : { categoryId: item.categoryId }),
    // Inactive options are omitted entirely: an option a customer cannot pick
    // has no place in the public menu.
    options: (item.options ?? [])
      .filter((option) => option.active)
      .map((option) => toPublicOption(option, language)),
  };
}

function toPublicCategory(category: MenuCategoryDoc, language: Language): MenuCategory {
  return {
    id: category.publicId,
    name: categoryName(category, language),
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
    async getPublicMenu(
      outletId: string,
      language: Language = DEFAULT_LANGUAGE,
    ): Promise<MenuResponse> {
      const snapshot = await getSnapshot(outletId);

      return {
        outlet: {
          id: snapshot.outlet.publicId,
          name: outletName(snapshot.outlet, language),
          currency: snapshot.outlet.currency,
        },
        menuVersion: snapshot.menuVersion,
        language,
        contentVersion: computeContentVersion(
          language,
          snapshot.outlet,
          snapshot.categories,
          snapshot.items,
        ),
        categories: snapshot.categories.map((category) =>
          toPublicCategory(category, language),
        ),
        items: snapshot.items.map((item) => toPublicItem(item, language)),
      };
    },
  };
}
