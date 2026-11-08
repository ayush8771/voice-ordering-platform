/**
 * Recommendation policy.
 *
 * docs/PRD.md section 5 and docs/UX_FLOWS.md flow 2: customers may ask for a
 * recommendation at any time; proactive recommendations are limited to one per
 * ordering session, never offered during review, confirmation or payment, and
 * stop for the session after a decline.
 *
 * docs/API.md requires this to be "enforced by application state, not by
 * relying on the prompt alone". Enforcement therefore has two parts: the
 * allowance below is computed from session state, and the service drops
 * proactive suggestions from the structured result when it is not allowed. The
 * prompt is told the same thing, but the structured channel is what is
 * enforced.
 */

import {
  RECOMMENDATION_FORBIDDEN_PHASES,
  type ConversationPhase,
  type PolicyOutcome,
} from './types.js';

/** Recommendation bookkeeping for one ordering session. */
export interface RecommendationState {
  proactiveUsed: boolean;
  declined: boolean;
}

export function createRecommendationState(): RecommendationState {
  return { proactiveUsed: false, declined: false };
}

/** Is a proactive (unsolicited) recommendation permitted on this turn? */
export function isProactiveAllowed(
  state: RecommendationState,
  phase: ConversationPhase,
): boolean {
  if (RECOMMENDATION_FORBIDDEN_PHASES.includes(phase)) return false;
  if (state.declined) return false;
  return !state.proactiveUsed;
}

/**
 * Records a decline. Irreversible for the rest of the session, which is why it
 * is kept in session state rather than recomputed per turn.
 */
export function recordDecline(state: RecommendationState): void {
  state.declined = true;
}

/**
 * Consumes the one-per-session allowance. Called only when a proactive
 * suggestion actually reaches the customer, so a suppressed or empty turn does
 * not silently spend it.
 */
export function recordProactiveUsed(state: RecommendationState): void {
  state.proactiveUsed = true;
}

export function describePolicy(
  state: RecommendationState,
  phase: ConversationPhase,
  proactiveSuppressed: boolean,
): PolicyOutcome {
  return {
    proactiveAllowed: isProactiveAllowed(state, phase),
    proactiveUsedThisSession: state.proactiveUsed,
    declinedThisSession: state.declined,
    proactiveSuppressed,
  };
}
