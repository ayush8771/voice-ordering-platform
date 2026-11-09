/**
 * Shared conversational service (docs/API.md, docs/ARCHITECTURE.md section 3).
 *
 * One instance serves QR and kiosk. It owns dialogue state, the prompt, the
 * tool allowlist, the recommendation policy and the mapping from provider
 * output to a provider-neutral result. It owns no ordering authority: it
 * produces *proposals* for a draft, and menu validation, quoting, confirmation
 * and payment stay with their own services (none of which exist yet).
 *
 * Trust model (docs/SECURITY.md section 2): the transcript is untrusted, the
 * model reply is untrusted, and tool arguments are untrusted. Each is validated
 * here or in `tools.ts` before it can influence a draft action, and no code
 * path in this file can create an order, accept a quote or touch payment state.
 */

import { CHANNELS, LANGUAGES } from '@vop/shared';
import {
  ProviderError,
  type ChatMessage,
  type ConversationProvider,
} from '../../providers/llm/types.js';
import { CONVERSATION_DEFAULTS, type ConversationConfig } from './config.js';
import type { MenuItemSummary, MenuLookupPort } from './menuPort.js';
import {
  parseModelOutput,
  type ParsedModelOutput,
  type RawSuggestion,
} from './modelOutput.js';
import {
  describePolicy,
  isProactiveAllowed,
  recordDecline,
  recordProactiveUsed,
} from './policy.js';
import { buildMessages, buildToolResultMessage } from './prompt.js';
import {
  ConversationSessionStore,
  type ConversationSessionState,
} from './sessionStore.js';
import {
  MAX_SEARCH_RESULTS,
  validateToolCall,
  type ProposeDraftUpdateArgs,
  type ValidatedToolCall,
} from './tools.js';
import {
  ConversationError,
  CONVERSATION_PHASES,
  type ConversationRequest,
  type ConversationResult,
  type ConversationUsage,
  type DraftAction,
  type ExecutedToolRequest,
  type MenuSuggestion,
  type PolicyViolation,
} from './types.js';

export interface ConversationService {
  handleTurn(request: ConversationRequest): Promise<ConversationResult>;
  /** Forgets dialogue state, for session end or an explicit customer reset. */
  endSession(sessionId: string): void;
}

export interface ConversationServiceDeps {
  readonly provider: ConversationProvider;
  readonly menu: MenuLookupPort;
  readonly config?: ConversationConfig;
  readonly store?: ConversationSessionStore;
  readonly now?: () => number;
  /** Structured log sink. Defaults to stdout JSON, matching the rest of the backend. */
  readonly log?: (entry: Record<string, unknown>) => void;
}

type ResolvedRef =
  | { readonly state: 'resolved'; readonly item: MenuItemSummary }
  | { readonly state: 'unresolved' | 'ambiguous' | 'unavailable' };

function defaultLog(entry: Record<string, unknown>): void {
  console.info(JSON.stringify(entry));
}

/** Bounds a violation detail so model text cannot bloat a log line. */
function detail(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
}

export function createConversationService(
  deps: ConversationServiceDeps,
): ConversationService {
  const config = deps.config ?? CONVERSATION_DEFAULTS;
  const now = deps.now ?? Date.now;
  const store = deps.store ?? new ConversationSessionStore(config, now);
  const log = deps.log ?? defaultLog;
  const { provider, menu } = deps;

  function validate(request: ConversationRequest): string {
    if (typeof request.sessionId !== 'string' || request.sessionId.trim() === '') {
      throw new ConversationError('invalid_request', 'sessionId is required');
    }
    if (typeof request.outletId !== 'string' || request.outletId.trim() === '') {
      throw new ConversationError('invalid_request', 'outletId is required');
    }
    if (!CHANNELS.includes(request.channel)) {
      throw new ConversationError('invalid_request', 'channel is not supported');
    }
    if (!LANGUAGES.includes(request.language)) {
      throw new ConversationError('invalid_request', 'language is not supported');
    }
    if (!CONVERSATION_PHASES.includes(request.phase)) {
      throw new ConversationError('invalid_request', 'phase is not supported');
    }

    const text = typeof request.text === 'string' ? request.text.trim() : '';
    if (text === '') {
      throw new ConversationError('invalid_request', 'text is required');
    }
    if (text.length > config.maxInputChars) {
      throw new ConversationError(
        'input_too_long',
        `text exceeds ${config.maxInputChars} characters`,
      );
    }
    return text;
  }

  /**
   * Resolves model-supplied item text to a backend menu item.
   *
   * Exact name matches win; otherwise more than one candidate is reported as
   * ambiguous rather than picked, because docs/PRD.md section 5 forbids
   * silently adding a guessed item.
   */
  async function resolveRef(outletId: string, ref: string): Promise<ResolvedRef> {
    const byId = await menu.getById(outletId, ref);
    const candidates =
      byId !== undefined
        ? [byId]
        : [...(await menu.search(outletId, ref, MAX_SEARCH_RESULTS))];

    if (candidates.length === 0) return { state: 'unresolved' };

    const needle = ref.trim().toLowerCase();
    const exact = candidates.filter(
      (item) => item.name.trim().toLowerCase() === needle,
    );
    const shortlist = exact.length > 0 ? exact : candidates;

    if (shortlist.length > 1) return { state: 'ambiguous' };

    const item = shortlist[0];
    if (item === undefined) return { state: 'unresolved' };
    if (!item.available) return { state: 'unavailable' };
    return { state: 'resolved', item };
  }

  /** Turns one validated proposal into a draft action, or records why not. */
  async function toDraftAction(
    outletId: string,
    call: ProposeDraftUpdateArgs,
    violations: PolicyViolation[],
    onResolved: (item: MenuItemSummary) => void,
  ): Promise<DraftAction | undefined> {
    if (call.type === 'clearDraft') return { type: 'clearDraft' };

    const ref = call.menuItemRef;
    if (ref === undefined) {
      violations.push({ kind: 'invalid_draft_action', detail: call.type });
      return undefined;
    }

    const resolved = await resolveRef(outletId, ref);
    if (resolved.state !== 'resolved') {
      violations.push({
        kind:
          resolved.state === 'unavailable'
            ? 'unavailable_menu_item'
            : resolved.state === 'ambiguous'
              ? 'ambiguous_menu_item'
              : 'unresolved_menu_item',
        detail: detail(ref),
      });
      return undefined;
    }

    // Options must exist on the resolved item. A partially valid option set is
    // rejected whole: dropping one option would change what the customer gets.
    let optionIds: readonly string[] | undefined;
    if (call.optionRefs !== undefined && call.optionRefs.length > 0) {
      const allowed = resolved.item.optionIds ?? [];
      const unknown = call.optionRefs.filter((option) => !allowed.includes(option));
      if (unknown.length > 0) {
        violations.push({
          kind: 'invalid_draft_action',
          detail: detail(`options:${unknown.join(',')}`),
        });
        return undefined;
      }
      optionIds = call.optionRefs;
    }

    onResolved(resolved.item);
    return {
      type: call.type,
      menuItemId: resolved.item.id,
      ...(call.quantity === undefined ? {} : { quantity: call.quantity }),
      ...(optionIds === undefined ? {} : { optionIds }),
    };
  }

  /** Resolves suggested items and drops anything not orderable right now. */
  async function toSuggestions(
    outletId: string,
    raw: readonly RawSuggestion[],
    violations: PolicyViolation[],
    onResolved: (item: MenuItemSummary) => void,
  ): Promise<MenuSuggestion[]> {
    const suggestions: MenuSuggestion[] = [];

    for (const entry of raw) {
      const resolved = await resolveRef(outletId, entry.menuItemRef);
      if (resolved.state !== 'resolved') {
        violations.push({
          kind:
            resolved.state === 'unavailable'
              ? 'unavailable_menu_item'
              : resolved.state === 'ambiguous'
                ? 'ambiguous_menu_item'
                : 'unresolved_menu_item',
          detail: detail(entry.menuItemRef),
        });
        continue;
      }
      onResolved(resolved.item);
      suggestions.push({
        menuItemId: resolved.item.id,
        name: resolved.item.name,
        kind: entry.kind,
      });
    }
    return suggestions;
  }

  async function executeReadOnlyTool(
    outletId: string,
    call: ValidatedToolCall,
    onResolved: (item: MenuItemSummary) => void,
  ): Promise<{ readonly payload: unknown; readonly resultCount: number }> {
    if (call.name === 'menu_search') {
      const items = await menu.search(outletId, call.query, call.limit);
      // Only fields the model is allowed to talk about are handed back.
      const payload = items.map((item) => ({
        menuItemId: item.id,
        name: item.name,
        available: item.available,
        ...(item.priceMinor === undefined ? {} : { priceMinor: item.priceMinor }),
      }));
      // One hit is an unambiguous referent; several are not, so a later "that"
      // still has to be disambiguated by the customer.
      const only = items.length === 1 ? items[0] : undefined;
      if (only !== undefined) onResolved(only);
      return { payload, resultCount: payload.length };
    }

    const item =
      call.name === 'menu_item_details'
        ? await menu.getById(outletId, call.menuItemId)
        : undefined;
    if (item !== undefined) onResolved(item);

    return {
      payload:
        item === undefined
          ? { found: false }
          : {
              found: true,
              menuItemId: item.id,
              name: item.name,
              available: item.available,
              ...(item.priceMinor === undefined ? {} : { priceMinor: item.priceMinor }),
              ...(item.optionIds === undefined ? {} : { optionIds: item.optionIds }),
            },
      resultCount: item === undefined ? 0 : 1,
    };
  }

  async function handleTurn(request: ConversationRequest): Promise<ConversationResult> {
    const text = validate(request);
    const state: ConversationSessionState = store.get(
      request.sessionId,
      request.outletId,
    );

    // A reported decline takes effect on the turn it arrives.
    if (request.customerDeclinedRecommendation === true) {
      recordDecline(state.recommendation);
    }

    const proactiveAllowed = isProactiveAllowed(state.recommendation, request.phase);
    const promptContext = {
      request: { ...request, text },
      proactiveRecommendationAllowed: proactiveAllowed,
      ...(state.lastMentioned === undefined
        ? {}
        : { lastMentionedItem: state.lastMentioned }),
    };

    /**
     * The last item this turn resolved against backend menu data, which
     * becomes the referent for the next turn's "those". Tracked here rather
     * than in `resolveRef` so a failed turn cannot move it.
     */
    let mentioned: { readonly id: string; readonly name: string } | undefined;
    function remember(item: MenuItemSummary): void {
      mentioned = { id: item.id, name: item.name };
    }

    const violations: PolicyViolation[] = [];
    const toolRequests: ExecutedToolRequest[] = [];
    const proposals: ProposeDraftUpdateArgs[] = [];
    let rawSuggestions: readonly RawSuggestion[] = [];
    // Only the final round's narrative reply is returned; earlier rounds exist
    // to fetch menu data.
    let lastParsed: ParsedModelOutput | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let sawUsage = false;

    const startedAt = now();
    const toolResults: ChatMessage[] = [];
    let round = 0;

    try {
      for (;;) {
        const completion = await provider.createChatCompletion({
          messages: buildMessages(promptContext, state.history, toolResults),
          maxOutputTokens: config.maxOutputTokens,
        });

        if (completion.usage !== undefined) {
          sawUsage = true;
          inputTokens += completion.usage.promptTokens;
          outputTokens += completion.usage.completionTokens;
          totalTokens += completion.usage.totalTokens;
        }

        const parsed = parseModelOutput(completion.text);
        if (parsed.unstructured) {
          violations.push({ kind: 'unstructured_output' });
        }
        lastParsed = parsed;
        if (parsed.suggestions.length > 0) rawSuggestions = parsed.suggestions;

        const lookups: ValidatedToolCall[] = [];
        for (const raw of parsed.toolCalls) {
          const validated = validateToolCall(raw);
          if (!validated.ok) {
            violations.push({ kind: validated.kind, detail: detail(validated.reason) });
            toolRequests.push({
              name:
                typeof raw === 'object' && raw !== null && 'name' in raw
                  ? detail(String((raw as { name: unknown }).name))
                  : '(invalid)',
              accepted: false,
              reason: validated.kind,
            });
            continue;
          }

          if (validated.call.name === 'propose_draft_update') {
            // Never executed: a draft change is a proposal for the customer.
            proposals.push(validated.call);
            toolRequests.push({ name: validated.call.name, accepted: true });
          } else {
            lookups.push(validated.call);
          }
        }

        if (lookups.length === 0) break;

        if (round >= config.maxToolRounds) {
          violations.push({ kind: 'tool_round_limit', detail: String(lookups.length) });
          for (const call of lookups) {
            toolRequests.push({
              name: call.name,
              accepted: false,
              reason: 'tool_round_limit',
            });
          }
          break;
        }

        for (const call of lookups) {
          const { payload, resultCount } = await executeReadOnlyTool(
            request.outletId,
            call,
            remember,
          );
          toolResults.push(buildToolResultMessage(call.name, payload));
          toolRequests.push({ name: call.name, accepted: true, resultCount });
        }
        round += 1;
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;

      // Provider failure: the draft is untouched and the caller falls back to
      // touch ordering (docs/PRD.md section 5, docs/UX_FLOWS.md flow 2).
      const usage = sawUsage ? { inputTokens, outputTokens, totalTokens } : undefined;
      log({
        level: 'warn',
        event: 'conversation.turn',
        sessionRef: state.sessionRef,
        outletId: request.outletId,
        channel: request.channel,
        phase: request.phase,
        providerId: provider.id,
        model: provider.model,
        latencyMs: now() - startedAt,
        providerState: 'failed',
        providerCode: error.code,
        retryable: error.retryable,
        inputChars: text.length,
      });

      return {
        assistantText: undefined,
        draftActions: [],
        suggestions: [],
        needsClarification: false,
        toolRequests,
        ...(usage === undefined ? {} : { usage }),
        providerStatus: {
          state: 'failed',
          providerId: provider.id,
          model: provider.model,
          code: error.code,
          retryable: error.retryable,
          fallback: 'touch',
        },
        policy: describePolicy(state.recommendation, request.phase, false),
        violations,
      };
    }

    const reply = lastParsed?.reply ?? '';
    const needsClarification = lastParsed?.needsClarification ?? false;

    const draftActions: DraftAction[] = [];
    for (const proposal of proposals) {
      const action = await toDraftAction(
        request.outletId,
        proposal,
        violations,
        remember,
      );
      if (action !== undefined) draftActions.push(action);
    }

    const resolvedSuggestions = await toSuggestions(
      request.outletId,
      rawSuggestions,
      violations,
      remember,
    );

    // Policy enforcement on the structured channel: proactive suggestions are
    // dropped unless this turn is allowed one.
    let proactiveSuppressed = false;
    let suggestions = resolvedSuggestions;
    if (!proactiveAllowed) {
      const kept = resolvedSuggestions.filter(
        (suggestion) => suggestion.kind === 'requested',
      );
      if (kept.length !== resolvedSuggestions.length) {
        proactiveSuppressed = true;
        violations.push({ kind: 'proactive_recommendation_suppressed' });
      }
      suggestions = kept;
    } else if (resolvedSuggestions.some((s) => s.kind === 'proactive')) {
      // The one-per-session allowance is spent only when one actually surfaces.
      recordProactiveUsed(state.recommendation);
    }

    const assistantText = reply === '' ? undefined : reply;
    if (assistantText !== undefined) {
      store.appendTurn(state, text, assistantText);
    }
    // Kept from an earlier turn when this one resolved nothing, so a referent
    // survives a clarifying question.
    if (mentioned !== undefined) state.lastMentioned = mentioned;

    const usage = sawUsage ? { inputTokens, outputTokens, totalTokens } : undefined;

    log({
      level: 'info',
      event: 'conversation.turn',
      sessionRef: state.sessionRef,
      outletId: request.outletId,
      channel: request.channel,
      phase: request.phase,
      providerId: provider.id,
      model: provider.model,
      latencyMs: now() - startedAt,
      providerState: 'ok',
      toolRounds: round,
      toolCalls: toolRequests.length,
      draftActions: draftActions.length,
      suggestions: suggestions.length,
      violations: violations.length,
      // Lengths only: full transcripts and replies stay out of logs
      // (docs/SECURITY.md section 5).
      inputChars: text.length,
      replyChars: reply.length,
      ...(usage === undefined ? {} : { totalTokens: usage.totalTokens }),
    });

    return {
      assistantText,
      draftActions,
      suggestions,
      needsClarification,
      toolRequests,
      ...(usage === undefined ? {} : { usage: usage as ConversationUsage }),
      providerStatus: {
        state: 'ok',
        providerId: provider.id,
        model: provider.model,
      },
      policy: describePolicy(state.recommendation, request.phase, proactiveSuppressed),
      violations,
    };
  }

  return {
    handleTurn,
    endSession(sessionId: string): void {
      store.clear(sessionId);
    },
  };
}
