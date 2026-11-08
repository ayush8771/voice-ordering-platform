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

/** The only menu facts the conversation layer needs. */
export interface MenuItemSummary {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  /** Integer minor units, for accurate suggestion text only. */
  readonly priceMinor?: number;
  /** Option IDs valid for this item, used to validate proposed options. */
  readonly optionIds?: readonly string[];
}

export interface MenuLookupPort {
  /**
   * Resolve free text ("masala dosa") to candidate items for one outlet.
   * Implementations must scope results to `outletId` and bound them to `limit`.
   */
  search(
    outletId: string,
    query: string,
    limit: number,
  ): Promise<readonly MenuItemSummary[]>;

  /** Fetch one item by backend ID, or undefined when it is not in this outlet. */
  getById(outletId: string, menuItemId: string): Promise<MenuItemSummary | undefined>;
}
