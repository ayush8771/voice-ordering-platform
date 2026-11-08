/**
 * Public surface of the shared conversational service.
 *
 * Callers depend on `ConversationRequest`/`ConversationResult` and the
 * `MenuLookupPort` they supply; nothing here exposes a provider wire shape
 * (docs/ARCHITECTURE.md section 5).
 */

export {
  CONVERSATION_DEFAULTS,
  loadConversationConfig,
  type ConversationConfig,
} from './config.js';
export type { MenuItemSummary, MenuLookupPort } from './menuPort.js';
export {
  createConversationService,
  type ConversationService,
  type ConversationServiceDeps,
} from './service.js';
export {
  ConversationSessionStore,
  deriveSessionRef,
  type ConversationSessionState,
} from './sessionStore.js';
export {
  CONVERSATION_TOOLS,
  FORBIDDEN_TOOL_NAMES,
  type ConversationToolName,
} from './tools.js';
export {
  ConversationError,
  CONVERSATION_PHASES,
  DRAFT_ACTION_TYPES,
  RECOMMENDATION_FORBIDDEN_PHASES,
  VIOLATION_KINDS,
  type ConversationPhase,
  type ConversationRequest,
  type ConversationResult,
  type ConversationUsage,
  type DraftAction,
  type DraftActionType,
  type DraftSummary,
  type DraftSummaryItem,
  type ExecutedToolRequest,
  type MenuSuggestion,
  type PolicyOutcome,
  type PolicyViolation,
  type ProviderStatus,
  type ViolationKind,
} from './types.js';
