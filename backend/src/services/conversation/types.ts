/**
 * Internal conversation contract (docs/API.md, "Shared conversational service
 * contract"). One service serves QR and kiosk; clients never call an LLM
 * directly.
 *
 * Everything here is provider-neutral: no Sarvam field names, no wire shapes.
 * Nothing here is authoritative. A draft action is a *proposal* that still
 * requires customer review, backend menu validation, a server quote and
 * explicit confirmation (docs/SECURITY.md section 2).
 */

import type { Channel, ConversationPhase, Language } from '@vop/shared';
import type { ProviderErrorCode } from '../../providers/llm/types.js';

/**
 * Where the customer is in the ordering flow.
 *
 * `review`, `confirmation` and `payment` are the phases in which proactive
 * recommendations are forbidden (docs/PRD.md section 5, docs/UX_FLOWS.md
 * flow 2).
 */
// Re-exported from the shared package: QR and kiosk clients send a phase on every
// turn, so the list is one contract rather than two copies.
export { CONVERSATION_PHASES } from '@vop/shared';
export type { ConversationPhase } from '@vop/shared';

/** Phases that suppress every proactive recommendation. */
export const RECOMMENDATION_FORBIDDEN_PHASES: readonly ConversationPhase[] = [
  'review',
  'confirmation',
  'payment',
];

/**
 * One line of the customer's current draft, as context for the model.
 *
 * Deliberately carries no prices or totals: money is server-calculated and the
 * model must never restate a total it was handed (docs/SECURITY.md section 2).
 */
export interface DraftSummaryItem {
  readonly menuItemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly optionIds?: readonly string[];
}

export interface DraftSummary {
  readonly items: readonly DraftSummaryItem[];
}

/**
 * A turn submitted to the service.
 *
 * `outletId` extends the shape sketched in docs/API.md because every request
 * must be outlet- and session-scoped (docs/SECURITY.md section 1); the service
 * refuses a session that arrives bound to a different outlet.
 */
export interface ConversationRequest {
  readonly sessionId: string;
  readonly outletId: string;
  readonly channel: Channel;
  readonly language: Language;
  /** Transcript text or typed input. Never trusted (docs/SECURITY.md section 2). */
  readonly text: string;
  readonly phase: ConversationPhase;
  readonly draftSummary?: DraftSummary;
  readonly menuVersion?: string;
  /**
   * Set by the caller when the customer has just declined a suggestion. It
   * stops proactive recommendations for the rest of the session.
   */
  readonly customerDeclinedRecommendation?: boolean;
}

/** Draft-cart change types the model may propose. */
export const DRAFT_ACTION_TYPES = [
  'addItem',
  'updateQuantity',
  'removeItem',
  'clearDraft',
] as const;
export type DraftActionType = (typeof DRAFT_ACTION_TYPES)[number];

/**
 * A validated proposal. `menuItemId` is resolved from backend menu data, never
 * from model text, and no price field exists by design.
 */
export interface DraftAction {
  readonly type: DraftActionType;
  readonly menuItemId?: string;
  readonly quantity?: number;
  readonly optionIds?: readonly string[];
}

/** A menu item the assistant offered, resolved against backend menu data. */
export interface MenuSuggestion {
  readonly menuItemId: string;
  readonly name: string;
  /** 'requested' when the customer asked; 'proactive' when the model offered. */
  readonly kind: 'requested' | 'proactive';
}

/** An allowlisted tool call the service actually ran, for audit. */
export interface ExecutedToolRequest {
  readonly name: string;
  readonly accepted: boolean;
  /** Present when the call was refused. */
  readonly reason?: string;
  /** Number of menu rows returned, for read-only lookups. */
  readonly resultCount?: number;
}

/** Internal usage shape (docs/API.md). Mapped from provider token counts. */
export interface ConversationUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/**
 * Provider outcome for this turn. On failure the draft is untouched and the
 * caller must keep the touch path usable (docs/PRD.md section 5).
 */
export interface ProviderStatus {
  readonly state: 'ok' | 'failed';
  readonly providerId: string;
  readonly model: string;
  readonly code?: ProviderErrorCode;
  readonly retryable?: boolean;
  /** Set to 'touch' whenever the conversational path produced nothing usable. */
  readonly fallback?: 'touch';
}

/** What the recommendation policy decided for this turn. */
export interface PolicyOutcome {
  readonly proactiveAllowed: boolean;
  readonly proactiveUsedThisSession: boolean;
  readonly declinedThisSession: boolean;
  /** True when a proactive suggestion was produced but dropped by policy. */
  readonly proactiveSuppressed: boolean;
}

/**
 * Something the model tried that the service refused. Recorded so misbehaviour
 * is observable rather than silent.
 */
export const VIOLATION_KINDS = [
  'forbidden_tool',
  'unknown_tool',
  'invalid_tool_arguments',
  'unresolved_menu_item',
  'unavailable_menu_item',
  'ambiguous_menu_item',
  'invalid_draft_action',
  'unstructured_output',
  'proactive_recommendation_suppressed',
  'tool_round_limit',
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];

export interface PolicyViolation {
  readonly kind: ViolationKind;
  /** Short, non-sensitive context (tool or item reference), bounded in length. */
  readonly detail?: string;
}

/** Normalized result returned to the caller (docs/API.md). */
export interface ConversationResult {
  /** Assistant reply text, or undefined when the provider failed. */
  readonly assistantText: string | undefined;
  readonly draftActions: readonly DraftAction[];
  readonly suggestions: readonly MenuSuggestion[];
  /** True when the model needs the customer to disambiguate before acting. */
  readonly needsClarification: boolean;
  readonly toolRequests: readonly ExecutedToolRequest[];
  readonly usage?: ConversationUsage;
  readonly providerStatus: ProviderStatus;
  readonly policy: PolicyOutcome;
  readonly violations: readonly PolicyViolation[];
}

/** Request-level failure raised before any provider call. */
export class ConversationError extends Error {
  readonly code:
    | 'invalid_request'
    | 'session_scope_mismatch'
    | 'input_too_long'
    | 'session_limit_reached';

  constructor(code: ConversationError['code'], message: string) {
    super(message);
    this.name = 'ConversationError';
    this.code = code;
  }
}
