/**
 * The conversation service's read-only view of menu data.
 *
 * The menu service does not exist yet (docs/PRD.md section 7, milestone 2 of
 * the product plan), so this is a *port*: the conversation service depends on
 * this narrow interface and the menu milestone supplies the implementation.
 * Keeping it minimal avoids pre-empting the menu contract, which Ayush and
 * Anvesh review jointly (docs/ARCHITECTURE.md section 5).
 *
 * Read-only by construction: there is no method here that can change menu
 * state, so no allowlisted tool can either.
 */

import type { Language } from '@vop/shared';

/** The only menu facts the conversation layer needs. */
export interface MenuItemSummary {
  readonly id: string;
  /**
   * The name in the turn's language, falling back to English per field. The
   * model sees - and so repeats back - the words the customer is using.
   */
  readonly name: string;
  readonly available: boolean;
  /** Integer minor units, for accurate suggestion text only. */
  readonly priceMinor?: number;
  /** Option IDs valid for this item, used to validate proposed options. */
  readonly optionIds?: readonly string[];
}

export interface MenuLookupPort {
  /**
   * Resolve free text ("masala dosa", "ಮಸಾಲೆ ದೋಸೆ") to candidate items for one
   * outlet. Implementations must scope results to `outletId` and bound them to
   * `limit`.
   *
   * `language` is the turn's language: an implementation matches the item's
   * translated name in that language *as well as* its canonical English name,
   * so a Kannada utterance resolves and an English word inside a Kannada
   * sentence still resolves. Omitted means English only.
   */
  search(
    outletId: string,
    query: string,
    limit: number,
    language?: Language,
  ): Promise<readonly MenuItemSummary[]>;

  /** Fetch one item by backend ID, or undefined when it is not in this outlet. */
  getById(
    outletId: string,
    menuItemId: string,
    language?: Language,
  ): Promise<MenuItemSummary | undefined>;
}
