/**
 * Menu persistence documents (docs/DATABASE.md section 2).
 *
 * Public IDs are opaque strings stored in a `publicId` field rather than the
 * MongoDB `_id`, so no sequential or internal database identifier is ever
 * exposed to a client (docs/DATABASE.md section 1).
 *
 * Money is integer minor units (paise) with currency `INR`; no float ever
 * touches a price.
 */

import type { Currency } from './money.js';

/**
 * Shape every public ID must have before it is used in a query.
 *
 * Opaque, URL-safe and bounded, so an oversized or operator-shaped value is
 * rejected at the edge rather than being handed to MongoDB
 * (docs/SECURITY.md section 4). Kept here so the menu route and session
 * creation cannot drift apart on what they accept.
 */
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}

export const COLLECTIONS = {
  outlets: 'outlets',
  /**
   * NEEDS JOINT AGREEMENT: `menuCategories` is not in docs/DATABASE.md. Kept as
   * its own collection rather than embedded in items so a category can be
   * renamed or reordered without rewriting every item.
   */
  menuCategories: 'menuCategories',
  menuItems: 'menuItems',
} as const;

export interface OutletDoc {
  readonly publicId: string;
  readonly name: string;
  readonly slug?: string;
  readonly timezone?: string;
  readonly currency: Currency;
  /** An inactive outlet is indistinguishable from an unknown one to a client. */
  readonly active: boolean;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

export interface MenuCategoryDoc {
  readonly publicId: string;
  readonly outletId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly updatedAt?: Date;
}

export interface MenuItemOptionDoc {
  readonly publicId: string;
  readonly label: string;
  /** May be zero or negative; the quote service refuses a negative unit price. */
  readonly priceDeltaMinor: number;
  readonly active: boolean;
}

export interface MenuItemDoc {
  readonly publicId: string;
  readonly outletId: string;
  readonly name: string;
  readonly description?: string;
  readonly priceMinor: number;
  readonly currency: Currency;
  /** `active` is the merchant availability switch from docs/DATABASE.md. */
  readonly active: boolean;
  readonly categoryId?: string;
  readonly options?: readonly MenuItemOptionDoc[];
  readonly sortOrder: number;
  readonly updatedAt?: Date;
}
