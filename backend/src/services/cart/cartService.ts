/**
 * Cart draft service.
 *
 * A cart is a draft and only a draft: it creates no order, reserves no stock,
 * carries no payment state and is never evidence of confirmation. Order
 * creation re-validates and re-prices through the quote service, so nothing
 * here is authoritative beyond "this is what the customer has picked so far"
 * (docs/SECURITY.md section 2, docs/PRD.md section 3).
 *
 * Division of labour:
 * - the menu service is the only source of items, options and availability;
 * - `services/quote/pricing.ts` is the only place a selection becomes a price,
 *   shared with the quote service so a draft total and a quote cannot diverge;
 * - the ordering session is the only scope: there is exactly one draft per
 *   session, and the session is outlet-bound.
 *
 * Safety under concurrent edits, which matter because a voice turn and a touch
 * tap can land at the same moment, and because more than one backend instance
 * may serve one session:
 * - every mutation for one session runs under a per-session lock, which keeps
 *   a read-modify-write from interleaving across the `await` on the menu
 *   *within one process*;
 * - the store's `save` is a conditional write on the revision the mutation
 *   read, which is what makes it safe across processes: the lock alone cannot
 *   serialize two instances;
 * - `revision` gives the caller optimistic concurrency: pass
 *   `expectedRevision` and a mutation applied on top of a draft the caller has
 *   not seen is refused with `409` instead of silently overwriting. A caller
 *   that sent no `expectedRevision` asked to apply to whatever is there, so a
 *   lost conditional write is retried against the fresh draft rather than
 *   surfaced as a conflict it never asked about.
 *
 * Shape for the conversation layer: the mutation methods take resolved IDs and
 * a session scope, which is exactly what a validated `propose_draft_update`
 * yields once the customer accepts it. The conversation service can therefore
 * call these methods directly without going through HTTP, and `toDraftSummary`
 * gives it price-free draft context.
 */

import { randomUUID } from 'node:crypto';
import {
  MAX_CART_LINE_QUANTITY,
  MAX_CART_LINES,
  type AddCartItemRequest,
  type CartLine,
  type CartLineIssue,
  type CartResponse,
  type UpdateCartItemRequest,
} from '@vop/shared';
import { ApiError } from '../../middleware/errors.js';
import { addMinor, MoneyError, multiplyMinor } from '../../models/money.js';
import type { DraftSummary } from '../conversation/types.js';
import type { MenuService, MenuSnapshot } from '../menu/menuService.js';
import { assertSelection, evaluateSelection } from '../quote/pricing.js';
import {
  CartRevisionConflictError,
  type CartLineRecord,
  type CartRecord,
  type CartStore,
} from './cartStore.js';

/** The authenticated session a draft belongs to. Never taken from a body. */
export interface CartSessionScope {
  readonly sessionId: string;
  readonly outletId: string;
  /**
   * The session's absolute deadline, which caps the draft's own: a draft is
   * usable exactly as long as the session that owns it
   * (docs/DATABASE.md section 2).
   */
  readonly expiresAtMs: number;
}

/** Optimistic-concurrency option carried by every mutation. */
export interface CartMutationOptions {
  /** When set, the mutation applies only to this revision of the draft. */
  readonly expectedRevision?: number;
}

export interface CartService {
  getCart(scope: CartSessionScope): Promise<CartResponse>;
  addItem(
    scope: CartSessionScope,
    input: AddCartItemRequest,
    options?: CartMutationOptions,
  ): Promise<CartResponse>;
  updateItem(
    scope: CartSessionScope,
    lineId: string,
    input: UpdateCartItemRequest,
    options?: CartMutationOptions,
  ): Promise<CartResponse>;
  removeItem(
    scope: CartSessionScope,
    lineId: string,
    options?: CartMutationOptions,
  ): Promise<CartResponse>;
  clear(scope: CartSessionScope, options?: CartMutationOptions): Promise<CartResponse>;
}

export interface CartServiceDeps {
  readonly menuService: MenuService;
  readonly cartStore: CartStore;
}

/**
 * Shape-checks and normalizes an option selection.
 *
 * Sorted and de-duplicated, so two equal selections always compare equal and a
 * repeated option cannot be charged twice. A repeat is rejected rather than
 * folded away, matching the quote service's bound.
 */
function readOptionIds(raw: unknown): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw ApiError.validation('optionIds must be an array');

  const optionIds = raw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw ApiError.validation(`optionIds[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });

  if (new Set(optionIds).size !== optionIds.length) {
    throw ApiError.validation('optionIds must not repeat an option');
  }
  return [...optionIds].sort();
}

function sameSelection(
  line: CartLineRecord,
  menuItemId: string,
  optionIds: readonly string[],
): boolean {
  if (line.menuItemId !== menuItemId) return false;
  if (line.optionIds.length !== optionIds.length) return false;
  return line.optionIds.every((optionId, index) => optionId === optionIds[index]);
}

/** Prices one stored line against the current menu, degrading never throwing. */
function priceLine(snapshot: MenuSnapshot, line: CartLineRecord): CartLine {
  function unorderable(issues: readonly CartLineIssue[], name: string): CartLine {
    return {
      lineId: line.lineId,
      menuItemId: line.menuItemId,
      name,
      quantity: line.quantity,
      optionIds: line.optionIds,
      // No stale price is ever reported for a line that cannot be ordered.
      unitPriceMinor: 0,
      lineTotalMinor: 0,
      available: false,
      issues,
    };
  }

  let evaluation;
  try {
    evaluation = evaluateSelection(snapshot, {
      menuItemId: line.menuItemId,
      optionIds: line.optionIds,
    });
  } catch (error) {
    // A corrupt stored price must not make the whole draft unreadable: the one
    // line is reported as unorderable and the rest of the draft still prices.
    if (!(error instanceof MoneyError)) throw error;
    return unorderable(['notPriceable'], line.nameSnapshot);
  }

  if (!evaluation.ok) {
    const item = snapshot.itemsById.get(line.menuItemId);
    return unorderable([evaluation.issue.reason], item?.name ?? line.nameSnapshot);
  }

  try {
    return {
      lineId: line.lineId,
      menuItemId: evaluation.item.publicId,
      // Snapshotted from the menu on every read, never echoed from a client.
      name: evaluation.item.name,
      quantity: line.quantity,
      optionIds: line.optionIds,
      unitPriceMinor: evaluation.unitPriceMinor,
      lineTotalMinor: multiplyMinor(
        evaluation.unitPriceMinor,
        line.quantity,
        `cart line ${line.lineId}`,
      ),
      available: true,
      issues: [],
    };
  } catch (error) {
    if (!(error instanceof MoneyError)) throw error;
    return unorderable(['notPriceable'], evaluation.item.name);
  }
}

/** Builds the response from a stored record and a fresh menu snapshot. */
function toResponse(record: CartRecord, snapshot: MenuSnapshot): CartResponse {
  const items = record.lines.map((line) => priceLine(snapshot, line));

  // Unorderable lines contribute nothing: a draft total never includes
  // something the customer cannot actually buy.
  const subtotalMinor = items.reduce(
    (total, line) => addMinor(total, line.lineTotalMinor, 'cart subtotalMinor'),
    0,
  );

  return {
    cartId: record.cartId,
    outletId: record.outletId,
    menuVersion: snapshot.menuVersion,
    revision: record.revision,
    items,
    subtotalMinor,
    // Same reasoning as the quote: no charge rule is configured, and the
    // separate field keeps adding one from being a breaking change.
    totalMinor: subtotalMinor,
    currency: snapshot.outlet.currency,
    hasUnavailableItems: items.some((line) => !line.available),
    updatedAt: new Date(record.updatedAtMs).toISOString(),
  };
}

function assertQuantity(quantity: unknown, field: string): number {
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_CART_LINE_QUANTITY
  ) {
    throw ApiError.validation(
      `${field} must be an integer 1-${MAX_CART_LINE_QUANTITY}`,
    );
  }
  return quantity;
}

/**
 * Retries of a conditional write that lost to another instance. Three is
 * enough: each loss means a competing edit was accepted, and the per-session
 * lock already serializes this instance's own mutations.
 */
const MAX_SAVE_ATTEMPTS = 3;

export function createCartService(deps: CartServiceDeps): CartService {
  /**
   * One lock per session, so a read-modify-write cannot interleave with
   * another mutation of the same draft across the `await` on the menu.
   * Entries are dropped as soon as the chain drains, so this cannot grow.
   */
  const locks = new Map<string, Promise<unknown>>();

  function withLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(sessionId) ?? Promise.resolve();
    // `catch` keeps one failed mutation from poisoning the next one.
    const result = previous.then(task, task);
    const chain = result
      .catch(() => undefined)
      .then(() => {
        if (locks.get(sessionId) === chain) locks.delete(sessionId);
      });
    locks.set(sessionId, chain);
    return result;
  }

  async function load(scope: CartSessionScope): Promise<CartRecord> {
    return (
      (await deps.cartStore.get(scope.sessionId, scope.outletId)) ??
      deps.cartStore.create(scope.sessionId, scope.outletId, scope.expiresAtMs)
    );
  }

  function assertRevision(record: CartRecord, options?: CartMutationOptions): void {
    const expected = options?.expectedRevision;
    if (expected === undefined) return;
    if (expected !== record.revision) {
      throw ApiError.conflict('The draft changed since it was last read', [
        { revision: record.revision },
      ]);
    }
  }

  /** Runs one mutation under the session lock against a fresh menu snapshot. */
  function mutate(
    scope: CartSessionScope,
    options: CartMutationOptions | undefined,
    apply: (
      record: CartRecord,
      snapshot: MenuSnapshot,
    ) => readonly CartLineRecord[] | undefined,
  ): Promise<CartResponse> {
    return withLock(scope.sessionId, async () => {
      // A caller that named a revision gets one attempt: a conflict is the
      // answer it asked for. A caller that named none retries, because the
      // conditional write can only lose to another instance's accepted edit.
      const attempts = options?.expectedRevision === undefined ? MAX_SAVE_ATTEMPTS : 1;

      for (let attempt = 1; ; attempt += 1) {
        // Resolves the outlet first: an unknown or inactive outlet is a 404
        // before any draft state is touched.
        const snapshot = await deps.menuService.getSnapshot(scope.outletId);

        const record = await load(scope);
        assertRevision(record, options);

        const lines = apply(record, snapshot);
        if (lines === undefined) {
          // Nothing changed, so the revision does not move: a no-op must not
          // invalidate another client's `expectedRevision`.
          return toResponse(record, snapshot);
        }

        try {
          const saved = await deps.cartStore.save(
            { ...record, revision: record.revision + 1, lines },
            scope.expiresAtMs,
          );
          return toResponse(saved, snapshot);
        } catch (error) {
          if (!(error instanceof CartRevisionConflictError)) throw error;
          if (attempt >= attempts) {
            // Reported with the stored revision so a client can re-read and
            // decide, exactly like a failed `If-Match`.
            throw ApiError.conflict('The draft changed since it was last read', [
              { revision: error.storedRevision ?? record.revision },
            ]);
          }
        }
      }
    });
  }

  function findLine(record: CartRecord, lineId: string): CartLineRecord {
    const line = record.lines.find((candidate) => candidate.lineId === lineId);
    if (line === undefined) {
      // A line of another session's draft is reported exactly like an unknown
      // one, because the lookup is already scoped to this session.
      throw ApiError.notFound('Draft line not found');
    }
    return line;
  }

  return {
    async getCart(scope) {
      const snapshot = await deps.menuService.getSnapshot(scope.outletId);
      return toResponse(await load(scope), snapshot);
    },

    // `async` so a body-validation fault arrives as a rejection rather than a
    // synchronous throw: the conversation layer will call these directly.
    async addItem(scope, input, options) {
      const menuItemId =
        typeof input?.menuItemId === 'string' ? input.menuItemId.trim() : '';
      if (menuItemId === '') throw ApiError.validation('menuItemId is required');
      const quantity = assertQuantity(input?.quantity, 'quantity');
      const optionIds = readOptionIds(input?.optionIds);

      return mutate(scope, options, (record, snapshot) => {
        // Refuses an unknown item (422) or an unavailable one (409) outright:
        // a draft never accepts something that could not be ordered now.
        assertSelection(snapshot, { menuItemId, optionIds });

        const existing = record.lines.find((line) =>
          sameSelection(line, menuItemId, optionIds),
        );

        if (existing !== undefined) {
          // Identical selections merge, which is what a customer means by
          // ordering the same thing twice. (A quote deliberately does not
          // merge; there the client owns the line list.)
          const merged = existing.quantity + quantity;
          if (merged > MAX_CART_LINE_QUANTITY) {
            throw ApiError.conflict(
              `A draft line may not exceed quantity ${MAX_CART_LINE_QUANTITY}`,
              [{ menuItemId, lineId: existing.lineId }],
            );
          }
          return record.lines.map((line) =>
            line.lineId === existing.lineId ? { ...line, quantity: merged } : line,
          );
        }

        if (record.lines.length >= MAX_CART_LINES) {
          throw ApiError.conflict(`A draft may not exceed ${MAX_CART_LINES} lines`);
        }

        const item = snapshot.itemsById.get(menuItemId);
        return [
          ...record.lines,
          {
            lineId: randomUUID(),
            menuItemId,
            optionIds,
            quantity,
            nameSnapshot: item?.name ?? menuItemId,
          },
        ];
      });
    },

    async updateItem(scope, lineId, input, options) {
      const quantity = assertQuantity(input?.quantity, 'quantity');
      const replacementOptions =
        input?.optionIds === undefined ? undefined : readOptionIds(input.optionIds);

      return mutate(scope, options, (record, snapshot) => {
        const line = findLine(record, lineId);
        const optionIds = replacementOptions ?? line.optionIds;

        if (replacementOptions !== undefined) {
          // Changing options is a new selection, so it is validated like an
          // add rather than trusted because the line already existed.
          assertSelection(snapshot, { menuItemId: line.menuItemId, optionIds });

          const collision = record.lines.find(
            (candidate) =>
              candidate.lineId !== lineId &&
              sameSelection(candidate, line.menuItemId, optionIds),
          );
          if (collision !== undefined) {
            // Refused rather than merged: silently folding two lines together
            // would change a line the caller did not name.
            throw ApiError.conflict(
              'That item and option combination is already a separate draft line',
              [{ menuItemId: line.menuItemId, lineId: collision.lineId }],
            );
          }
        }

        if (quantity === line.quantity && replacementOptions === undefined) {
          return undefined;
        }

        return record.lines.map((candidate) =>
          candidate.lineId === lineId
            ? { ...candidate, quantity, optionIds }
            : candidate,
        );
      });
    },

    removeItem(scope, lineId, options) {
      return mutate(scope, options, (record) => {
        findLine(record, lineId);
        return record.lines.filter((line) => line.lineId !== lineId);
      });
    },

    clear(scope, options) {
      return mutate(scope, options, (record) =>
        // Clearing an empty draft is a no-op, so repeating it is harmless.
        record.lines.length === 0 ? undefined : [],
      );
    },
  };
}

/**
 * Price-free draft context for the conversation service.
 *
 * The model is never handed money (docs/SECURITY.md section 2), and lines it
 * could not order are omitted so it cannot offer to change them.
 */
export function toDraftSummary(cart: CartResponse): DraftSummary {
  return {
    items: cart.items
      .filter((line) => line.available)
      .map((line) => ({
        menuItemId: line.menuItemId,
        name: line.name,
        quantity: line.quantity,
        ...(line.optionIds.length === 0 ? {} : { optionIds: line.optionIds }),
      })),
  };
}
