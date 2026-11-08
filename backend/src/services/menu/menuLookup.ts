/**
 * The real `MenuLookupPort` for the conversation service.
 *
 * This closes the port the conversation milestone left open. It is read-only
 * and goes through the menu service, so the model's search results and the
 * prices a customer is quoted come from one authority
 * (docs/SECURITY.md section 2).
 *
 * Deliberately narrow:
 * - results are scoped to the requested outlet;
 * - unavailable items are returned with `available: false` rather than hidden,
 *   so the conversation service can say "sold out" instead of "no such item";
 * - only active options are exposed, so the model cannot propose an option the
 *   quote service would then reject.
 */

import type { MenuItemSummary, MenuLookupPort } from '../conversation/menuPort.js';
import { ApiError } from '../../middleware/errors.js';
import type { MenuItemDoc } from '../../models/menu.js';
import type { MenuService } from './menuService.js';

function toSummary(item: MenuItemDoc): MenuItemSummary {
  return {
    id: item.publicId,
    name: item.name,
    available: item.active,
    priceMinor: item.priceMinor,
    optionIds: (item.options ?? [])
      .filter((option) => option.active)
      .map((option) => option.publicId),
  };
}

/** Normalizes for matching: case-folded, collapsed whitespace. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function createMenuLookup(menuService: MenuService): MenuLookupPort {
  /**
   * An unknown outlet yields an empty result rather than an error: the
   * conversation service then records an unresolved reference and asks the
   * customer, which is better than failing the whole turn.
   */
  async function items(outletId: string): Promise<readonly MenuItemDoc[]> {
    try {
      const snapshot = await menuService.getSnapshot(outletId);
      return snapshot.items;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  return {
    async search(outletId, query, limit) {
      const needle = normalize(query);
      if (needle === '') return [];

      const all = await items(outletId);

      // Exact names first, then prefix, then substring: the conversation
      // service treats more than one candidate as ambiguous, so ordering
      // matters less than not conflating an exact hit with a loose one.
      const exact: MenuItemSummary[] = [];
      const prefix: MenuItemSummary[] = [];
      const partial: MenuItemSummary[] = [];

      for (const item of all) {
        const name = normalize(item.name);
        if (name === needle) exact.push(toSummary(item));
        else if (name.startsWith(needle)) prefix.push(toSummary(item));
        else if (name.includes(needle)) partial.push(toSummary(item));
      }

      // An exact name match is never reported as ambiguous alongside looser
      // matches, so "idli" does not collide with "idli sambar".
      const ranked = exact.length > 0 ? exact : [...prefix, ...partial];
      return ranked.slice(0, Math.max(0, limit));
    },

    async getById(outletId, menuItemId) {
      const all = await items(outletId);
      const found = all.find((item) => item.publicId === menuItemId);
      return found === undefined ? undefined : toSummary(found);
    },
  };
}
