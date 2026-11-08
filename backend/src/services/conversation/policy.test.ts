import { describe, expect, it } from 'vitest';
import {
  createRecommendationState,
  isProactiveAllowed,
  recordDecline,
  recordProactiveUsed,
} from './policy.js';
import { RECOMMENDATION_FORBIDDEN_PHASES, type ConversationPhase } from './types.js';

describe('recommendation policy', () => {
  it('allows one proactive recommendation while browsing or building', () => {
    for (const phase of ['browsing', 'building'] as ConversationPhase[]) {
      const state = createRecommendationState();
      expect(isProactiveAllowed(state, phase)).toBe(true);

      recordProactiveUsed(state);
      expect(isProactiveAllowed(state, phase)).toBe(false);
    }
  });

  it.each(RECOMMENDATION_FORBIDDEN_PHASES)('forbids proactive during %s', (phase) => {
    expect(isProactiveAllowed(createRecommendationState(), phase)).toBe(false);
  });

  it('stops proactive recommendations permanently after a decline', () => {
    const state = createRecommendationState();
    recordDecline(state);

    expect(isProactiveAllowed(state, 'browsing')).toBe(false);
    expect(isProactiveAllowed(state, 'building')).toBe(false);
  });

  it('keeps the allowance unspent until one actually surfaces', () => {
    const state = createRecommendationState();
    // Merely evaluating the policy must not consume the single allowance.
    isProactiveAllowed(state, 'browsing');
    isProactiveAllowed(state, 'browsing');

    expect(state.proactiveUsed).toBe(false);
    expect(isProactiveAllowed(state, 'browsing')).toBe(true);
  });
});
