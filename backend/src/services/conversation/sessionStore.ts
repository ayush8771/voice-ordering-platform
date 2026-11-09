/**
 * Per-session conversation state.
 *
 * In memory only. Persistence, retention and hosting are open decisions
 * (docs/PRD.md section 9), and docs/SECURITY.md section 5 asks for transient
 * handling by default, so nothing here is written to MongoDB or to a log.
 *
 * Isolation: state is keyed by session ID and bound to the outlet that created
 * it. A session ID presented with a different outlet is rejected, which is the
 * cross-session/outlet boundary required by docs/SECURITY.md section 1.
 *
 * The store is bounded in both directions - idle TTL and a maximum number of
 * sessions - so a kiosk left running cannot grow it without limit.
 */

import { createHash } from 'node:crypto';
import type { ConversationConfig } from './config.js';
import type { ChatMessage } from '../../providers/llm/types.js';
import { createRecommendationState, type RecommendationState } from './policy.js';
import { ConversationError } from './types.js';

export interface ConversationSessionState {
  readonly sessionRef: string;
  readonly outletId: string;
  readonly recommendation: RecommendationState;
  /** Bounded replay history: oldest first. */
  readonly history: ChatMessage[];
  /**
   * The item most recently resolved against backend menu data for this
   * session, so a later "add two of those" has a referent. It is a *resolved*
   * item, never model text, and carries no price.
   */
  lastMentioned?: { readonly id: string; readonly name: string };
  lastSeenAt: number;
}

/**
 * Opaque, stable reference used in logs.
 *
 * The session ID is a bearer capability and must never be logged
 * (docs/API.md, docs/SECURITY.md section 5), so logs carry a truncated hash
 * instead. It correlates turns of one session without being replayable.
 */
export function deriveSessionRef(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}

export class ConversationSessionStore {
  private readonly sessions = new Map<string, ConversationSessionState>();

  constructor(
    private readonly config: ConversationConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Live session count, after pruning. Intended for tests and diagnostics. */
  size(): number {
    this.prune();
    return this.sessions.size;
  }

  /**
   * Returns the state for a session, creating it on first use.
   *
   * Throws `session_scope_mismatch` when an existing session is presented with
   * a different outlet, and `session_limit_reached` when the store is full of
   * live sessions rather than evicting someone else's conversation.
   */
  get(sessionId: string, outletId: string): ConversationSessionState {
    this.prune();

    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      if (existing.outletId !== outletId) {
        throw new ConversationError(
          'session_scope_mismatch',
          'Session is bound to a different outlet',
        );
      }
      existing.lastSeenAt = this.now();
      return existing;
    }

    if (this.sessions.size >= this.config.maxSessions) {
      throw new ConversationError(
        'session_limit_reached',
        'Too many active conversation sessions',
      );
    }

    const created: ConversationSessionState = {
      sessionRef: deriveSessionRef(sessionId),
      outletId,
      recommendation: createRecommendationState(),
      history: [],
      lastSeenAt: this.now(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  /**
   * Appends one completed exchange and trims to the configured window.
   *
   * Called only after a successful provider turn, so a failed call cannot
   * poison the replay history with a question that was never answered.
   */
  appendTurn(
    state: ConversationSessionState,
    userText: string,
    assistantText: string,
  ): void {
    state.history.push({ role: 'user', content: userText });
    state.history.push({ role: 'assistant', content: assistantText });

    const maxMessages = this.config.historyTurns * 2;
    if (state.history.length > maxMessages) {
      state.history.splice(0, state.history.length - maxMessages);
    }
  }

  /** Forgets one session, for session end or an explicit customer reset. */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private prune(): void {
    const cutoff = this.now() - this.config.sessionTtlMs;
    for (const [sessionId, state] of this.sessions) {
      if (state.lastSeenAt < cutoff) this.sessions.delete(sessionId);
    }
  }
}
