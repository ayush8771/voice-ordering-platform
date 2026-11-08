/**
 * In-memory menu repository.
 *
 * Test support and the source of the synthetic development seed. Excluded from
 * the build output, so it cannot be wired into a running server by accident.
 *
 * It mirrors the Mongo repository's contract exactly: outlet scoping, inactive
 * outlets hidden, inactive items returned, and `compareListingOrder` for
 * listings. Any divergence would make the service tests lie, so
 * `mongoMenuRepository.integration.test.ts` asserts the two agree against a
 * real `mongod`.
 */

import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';
import { compareListingOrder, type MenuRepository } from './menuRepository.js';

export interface MenuDataset {
  readonly outlets: readonly OutletDoc[];
  readonly categories: readonly MenuCategoryDoc[];
  readonly items: readonly MenuItemDoc[];
}

export function createInMemoryMenuRepository(dataset: MenuDataset): MenuRepository {
  return {
    findActiveOutlet(outletId) {
      return Promise.resolve(
        dataset.outlets.find((outlet) => outlet.publicId === outletId && outlet.active),
      );
    },
    listCategories(outletId) {
      return Promise.resolve(
        dataset.categories
          .filter((category) => category.outletId === outletId && category.active)
          .sort(compareListingOrder),
      );
    },
    listItems(outletId) {
      return Promise.resolve(
        dataset.items
          .filter((item) => item.outletId === outletId)
          .sort(compareListingOrder),
      );
    },
  };
}

/**
 * Synthetic dataset. Clearly fake names and prices, kept separate from any
 * real outlet data (docs/DATABASE.md section 5).
 */
export const SAMPLE_MENU: MenuDataset = {
  outlets: [
    {
      publicId: 'demo-outlet',
      name: 'Demo Tiffin Centre',
      slug: 'demo-tiffin-centre',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      active: true,
    },
    {
      publicId: 'closed-outlet',
      name: 'Closed Demo Outlet',
      currency: 'INR',
      active: false,
    },
    {
      publicId: 'other-outlet',
      name: 'Second Demo Outlet',
      currency: 'INR',
      active: true,
    },
  ],
  categories: [
    {
      publicId: 'cat-tiffin',
      outletId: 'demo-outlet',
      name: 'Tiffin',
      sortOrder: 1,
      active: true,
    },
    {
      publicId: 'cat-drinks',
      outletId: 'demo-outlet',
      name: 'Drinks',
      sortOrder: 2,
      active: true,
    },
    {
      publicId: 'cat-hidden',
      outletId: 'demo-outlet',
      name: 'Retired Category',
      sortOrder: 3,
      active: false,
    },
  ],
  items: [
    {
      publicId: 'item-masala-dosa',
      outletId: 'demo-outlet',
      name: 'Masala Dosa',
      description: 'Crisp dosa with spiced potato filling',
      priceMinor: 8000,
      currency: 'INR',
      active: true,
      categoryId: 'cat-tiffin',
      sortOrder: 1,
      options: [
        {
          publicId: 'opt-extra-chutney',
          label: 'Extra chutney',
          priceDeltaMinor: 1000,
          active: true,
        },
        {
          publicId: 'opt-ghee',
          label: 'Ghee roast',
          priceDeltaMinor: 2500,
          active: true,
        },
        {
          publicId: 'opt-seasonal',
          label: 'Seasonal special',
          priceDeltaMinor: 1500,
          active: false,
        },
      ],
    },
    {
      publicId: 'item-idli',
      outletId: 'demo-outlet',
      name: 'Idli',
      priceMinor: 4000,
      currency: 'INR',
      active: true,
      categoryId: 'cat-tiffin',
      sortOrder: 2,
      options: [],
    },
    {
      publicId: 'item-idli-sambar',
      outletId: 'demo-outlet',
      name: 'Idli Sambar',
      priceMinor: 5000,
      currency: 'INR',
      active: true,
      categoryId: 'cat-tiffin',
      sortOrder: 3,
    },
    {
      publicId: 'item-medu-vada',
      outletId: 'demo-outlet',
      name: 'Medu Vada',
      priceMinor: 4500,
      currency: 'INR',
      // Sold out: stays on the menu as unavailable rather than disappearing.
      active: false,
      categoryId: 'cat-tiffin',
      sortOrder: 4,
      options: [],
    },
    {
      publicId: 'item-filter-coffee',
      outletId: 'demo-outlet',
      name: 'Filter Coffee',
      priceMinor: 3000,
      currency: 'INR',
      active: true,
      categoryId: 'cat-drinks',
      sortOrder: 5,
      options: [
        {
          publicId: 'opt-less-sugar',
          label: 'Less sugar',
          priceDeltaMinor: 0,
          active: true,
        },
      ],
    },
    {
      publicId: 'item-cold-coffee',
      outletId: 'demo-outlet',
      name: 'Cold Coffee',
      priceMinor: 6000,
      currency: 'INR',
      active: true,
      categoryId: 'cat-drinks',
      sortOrder: 6,
      options: [],
    },
    {
      publicId: 'item-poha',
      outletId: 'other-outlet',
      name: 'Poha',
      priceMinor: 3500,
      currency: 'INR',
      active: true,
      sortOrder: 1,
      options: [],
    },
  ],
};
