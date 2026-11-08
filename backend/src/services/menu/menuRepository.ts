/**
 * Menu persistence boundary.
 *
 * Services depend on this interface, not on MongoDB, so pricing and validation
 * rules are testable without a database (docs/ARCHITECTURE.md section 5,
 * docs/TESTING.md section 2).
 *
 * Read-only in this milestone: menu editing is a merchant feature and is not
 * in scope, so there is deliberately no write method to call.
 */

import type { MenuCategoryDoc, MenuItemDoc, OutletDoc } from '../../models/menu.js';

/**
 * Listing order every implementation must produce: `sortOrder`, then `name` by
 * Unicode code point, then `publicId`.
 *
 * `sortOrder` is the merchant's explicit order and carries the display intent;
 * the rest only breaks ties. The tiebreak is code point rather than locale
 * collation because MongoDB's default (simple binary) collation compares UTF-8
 * bytes, which is code-point order, and `String.prototype.localeCompare` does
 * not agree with it - notably it orders `idli` before `Idli` where MongoDB
 * orders `Idli` first. Using the same rule in both implementations is what
 * keeps the in-memory repository an honest stand-in for MongoDB in tests.
 *
 * `publicId` is appended so the order is total: two rows sharing a `sortOrder`
 * and a `name` still come back in the same sequence from either implementation
 * and from one request to the next.
 *
 * OPEN: locale-aware menu ordering (so Kannada, Devanagari and Latin names
 * interleave the way a reader of that language expects) needs a collation
 * locale per outlet, which is a product decision that is not yet made
 * (docs/PRD.md language support). Until then order is deterministic but not
 * linguistically sorted, and merchants express display order through
 * `sortOrder`.
 */
export function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);

  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference =
      (left[index] as string).codePointAt(0)! -
      (right[index] as string).codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/** The documented listing comparator, shared by every implementation. */
export function compareListingOrder<
  T extends {
    readonly sortOrder: number;
    readonly name: string;
    readonly publicId: string;
  },
>(a: T, b: T): number {
  return (
    a.sortOrder - b.sortOrder ||
    compareCodePoints(a.name, b.name) ||
    compareCodePoints(a.publicId, b.publicId)
  );
}

export interface MenuRepository {
  /** Returns the outlet only when it exists and is active. */
  findActiveOutlet(outletId: string): Promise<OutletDoc | undefined>;
  /** Active categories for one outlet, in `compareListingOrder`. */
  listCategories(outletId: string): Promise<readonly MenuCategoryDoc[]>;
  /**
   * Every item for one outlet, including inactive ones.
   *
   * Inactive items are returned so the public menu can show them as
   * unavailable rather than making them vanish, and so a quote can tell
   * "unavailable" apart from "unknown" (docs/UX_FLOWS.md flow 2).
   *
   * In `compareListingOrder`.
   */
  listItems(outletId: string): Promise<readonly MenuItemDoc[]>;
}
