/**
 * One conversational turn, applied to the real draft cart.
 *
 * This is the bridge the conversation milestone left open: the conversation
 * service produces *proposals* and owns no ordering authority, the cart service
 * owns every draft rule, and neither may depend on the other. So the wiring
 * lives here, in an application-level workflow - the same division of labour as
 * `endOrderingSession.ts` and `confirmOrder.ts`.
 *
 * What this workflow is allowed to do, and nothing more:
 * - read the draft through the cart service, so the model's context is
 *   backend-verified rather than client-supplied;
 * - hand the model a price-free summary of that draft (`toDraftSummary`);
 * - apply each validated `DraftAction` by calling the ordinary cart service
 *   methods, which re-validate item, options, availability, quantity, bounds
 *   and session/outlet scope exactly as the HTTP routes do.
 *
 * What it cannot do, by construction:
 * - create, confirm or price an order: no order service, quote service or
 *   payment dependency is injected here, so no model output can reach one.
 *   Confirmation stays with `POST /api/v1/orders` and its literal
 *   `customerConfirmed: true` (docs/SECURITY.md section 2);
 * - reach the database: every mutation goes through `CartService`, never a
 *   store;
 * - widen scope: `scope` comes from the authenticated session, and the same
 *   session ID keys conversation state, so one session's turn can only ever
 *   touch its own draft (docs/SECURITY.md section 1).
 *
 * Failure handling. A refused proposal is *reported, not thrown*: the customer
 * still gets the assistant's reply and the authoritative cart, and the refusal
 * is attached to the action so a client can say "that is sold out" rather than
 * losing the turn. A provider failure leaves the draft untouched and the result
 * carries `providerStatus.fallback === 'touch'`, so QR and kiosk ordering keep
 * working with no AI at all (docs/PRD.md section 5).
 *
 * No `expectedRevision` is sent. A voice turn means "apply this to the draft as
 * it is now", which is the same contract as a cart mutation without `If-Match`;
 * mutations for one session are serialized server-side, and each action is
 * applied against the cart the previous one returned.
 */

import type { CartLine, CartResponse, Channel, Language } from '@vop/shared';
import { ApiError } from '../middleware/errors.js';
import {
  toDraftSummary,
  type CartService,
  type CartSessionScope,
} from '../services/cart/cartService.js';
import type { ConversationService } from '../services/conversation/service.js';
import type {
  ConversationPhase,
  ConversationResult,
  DraftAction,
} from '../services/conversation/types.js';

export interface ConversationTurnDeps {
  readonly conversation: ConversationService;
  readonly cartService: CartService;
}

export interface ConversationTurnInput {
  /** Taken from the authenticated session, never from a request body. */
  readonly scope: CartSessionScope;
  readonly channel: Channel;
  readonly language: Language;
  readonly phase: ConversationPhase;
  /** Transcript or typed text. Untrusted (docs/SECURITY.md section 2). */
  readonly text: string;
  readonly customerDeclinedRecommendation?: boolean;
}

/** Why a validated proposal still could not be applied to the draft. */
export const DRAFT_APPLY_REASONS = [
  /** The named selection is not in the draft, so there is nothing to change. */
  'not_in_draft',
  /** More than one draft line matches, so changing one would be a guess. */
  'ambiguous_draft_line',
  /** The cart service refused it: unknown, unavailable, or over a bound. */
  'rejected_by_cart',
  /** The proposal lacked a field its type requires. */
  'incomplete_action',
] as const;
export type DraftApplyReason = (typeof DRAFT_APPLY_REASONS)[number];

export interface AppliedDraftAction {
  readonly action: DraftAction;
  readonly applied: boolean;
  readonly reason?: DraftApplyReason;
  /** The cart service's client-safe message, when it refused the change. */
  readonly message?: string;
}

/**
 * The turn's outcome. `cart` is always the authoritative draft, repriced from
 * the live menu - so a cart or total question is answered from this, never from
 * anything the model said.
 */
export interface ConversationTurnResult {
  readonly assistantText: string | undefined;
  readonly cart: CartResponse;
  readonly draftActions: readonly AppliedDraftAction[];
  readonly suggestions: ConversationResult['suggestions'];
  readonly needsClarification: boolean;
  readonly providerStatus: ConversationResult['providerStatus'];
  readonly policy: ConversationResult['policy'];
  readonly violations: ConversationResult['violations'];
}

/** Draft lines matching a proposal's item, and its options when it named any. */
function matchingLines(cart: CartResponse, action: DraftAction): readonly CartLine[] {
  // Stored option sets are normalized (sorted, de-duplicated); a proposal's are
  // not, so the comparison sorts a copy rather than trusting the model's order.
  const wanted =
    action.optionIds === undefined ? undefined : [...action.optionIds].sort();

  return cart.items.filter((line) => {
    if (line.menuItemId !== action.menuItemId) return false;
    if (wanted === undefined) return true;
    if (line.optionIds.length !== wanted.length) return false;
    return line.optionIds.every((optionId, index) => optionId === wanted[index]);
  });
}

export async function runConversationTurn(
  deps: ConversationTurnDeps,
  input: ConversationTurnInput,
): Promise<ConversationTurnResult> {
  const { scope } = input;

  // Backend-verified draft context. The summary carries names, quantities and
  // option IDs but no money, so the model cannot restate a total (docs/API.md,
  // "Shared conversational service contract").
  // Read and written in the turn's language, so `displayName` on every line
  // matches the language the assistant is replying in.
  const view = { language: input.language };
  let cart = await deps.cartService.getCart(scope, view);

  const result = await deps.conversation.handleTurn({
    sessionId: scope.sessionId,
    outletId: scope.outletId,
    channel: input.channel,
    language: input.language,
    text: input.text,
    phase: input.phase,
    draftSummary: toDraftSummary(cart),
    menuVersion: cart.menuVersion,
    ...(input.customerDeclinedRecommendation === undefined
      ? {}
      : { customerDeclinedRecommendation: input.customerDeclinedRecommendation }),
  });

  const draftActions: AppliedDraftAction[] = [];

  for (const action of result.draftActions) {
    try {
      if (action.type === 'clearDraft') {
        cart = await deps.cartService.clear(scope, view);
        draftActions.push({ action, applied: true });
        continue;
      }

      if (action.menuItemId === undefined) {
        draftActions.push({ action, applied: false, reason: 'incomplete_action' });
        continue;
      }

      if (action.type === 'addItem') {
        if (action.quantity === undefined) {
          draftActions.push({ action, applied: false, reason: 'incomplete_action' });
          continue;
        }
        cart = await deps.cartService.addItem(
          scope,
          {
            menuItemId: action.menuItemId,
            quantity: action.quantity,
            ...(action.optionIds === undefined ? {} : { optionIds: action.optionIds }),
          },
          view,
        );
        draftActions.push({ action, applied: true });
        continue;
      }

      // `updateQuantity` and `removeItem` name a selection, not a line ID: the
      // model never sees a line ID, so the line is found in the draft here.
      const lines = matchingLines(cart, action);
      const line = lines[0];
      if (line === undefined) {
        draftActions.push({ action, applied: false, reason: 'not_in_draft' });
        continue;
      }
      if (lines.length > 1) {
        // Refused rather than guessed: the matching lines differ by options the
        // proposal did not name, so the customer must say which one.
        draftActions.push({ action, applied: false, reason: 'ambiguous_draft_line' });
        continue;
      }

      if (action.type === 'removeItem') {
        cart = await deps.cartService.removeItem(scope, line.lineId, view);
        draftActions.push({ action, applied: true });
        continue;
      }

      if (action.quantity === undefined) {
        draftActions.push({ action, applied: false, reason: 'incomplete_action' });
        continue;
      }
      cart = await deps.cartService.updateItem(
        scope,
        line.lineId,
        { quantity: action.quantity },
        view,
      );
      draftActions.push({ action, applied: true });
    } catch (error) {
      // Only a client-safe refusal is absorbed. A store outage or a bug is a
      // real failure and must reach the error handler as itself.
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      draftActions.push({
        action,
        applied: false,
        reason: 'rejected_by_cart',
        message: error.message,
      });
    }
  }

  return {
    assistantText: result.assistantText,
    cart,
    draftActions,
    suggestions: result.suggestions,
    needsClarification: result.needsClarification,
    providerStatus: result.providerStatus,
    policy: result.policy,
    violations: result.violations,
  };
}
