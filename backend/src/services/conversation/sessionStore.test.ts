import { describe, expect, it } from 'vitest';
import { CONVERSATION_DEFAULTS, type ConversationConfig } from './config.js';
import { ConversationSessionStore, deriveSessionRef } from './sessionStore.js';
import { ConversationError } from './types.js';

function store(
  overrides: Partial<ConversationConfig> = {},
  clock = { value: 1_000_000 },
) {
  const config: ConversationConfig = { ...CONVERSATION_DEFAULTS, ...overrides };
  return {
    clock,
    store: new ConversationSessionStore(config, () => clock.value),
  };
}

describe('ConversationSessionStore', () => {
  it('creates state on first use and reuses it afterwards', () => {
    const { store: s } = store();

    const first = s.get('sess_a', 'outlet_1');
    first.recommendation.proactiveUsed = true;

    expect(s.get('sess_a', 'outlet_1').recommendation.proactiveUsed).toBe(true);
    expect(s.size()).toBe(1);
  });

  it('isolates two sessions of the same outlet', () => {
    const { store: s } = store();

    s.appendTurn(s.get('sess_a', 'outlet_1'), 'one dosa', 'ok');

    expect(s.get('sess_b', 'outlet_1').history).toEqual([]);
    expect(s.get('sess_a', 'outlet_1').history).toHaveLength(2);
  });

  it('refuses a session presented with a different outlet', () => {
    const { store: s } = store();
    s.get('sess_a', 'outlet_1');

    expect(() => s.get('sess_a', 'outlet_2')).toThrow(ConversationError);
    expect(() => s.get('sess_a', 'outlet_2')).toThrow(/different outlet/);
  });

  it('trims history to the configured window', () => {
    const { store: s } = store({ historyTurns: 2 });
    const state = s.get('sess_a', 'outlet_1');

    s.appendTurn(state, 'first', 'r1');
    s.appendTurn(state, 'second', 'r2');
    s.appendTurn(state, 'third', 'r3');

    expect(state.history).toHaveLength(4);
    expect(state.history[0]?.content).toBe('second');
    expect(state.history[3]?.content).toBe('r3');
  });

  it('expires idle sessions', () => {
    const clock = { value: 1_000_000 };
    const { store: s } = store({ sessionTtlMs: 60_000 }, clock);

    s.appendTurn(s.get('sess_a', 'outlet_1'), 'one dosa', 'ok');
    clock.value += 60_001;

    expect(s.size()).toBe(0);
    expect(s.get('sess_a', 'outlet_1').history).toEqual([]);
  });

  it('rejects new sessions instead of evicting live ones when full', () => {
    const { store: s } = store({ maxSessions: 1 });
    s.get('sess_a', 'outlet_1');

    expect(() => s.get('sess_b', 'outlet_1')).toThrow(/Too many active/);
    // The existing conversation is untouched.
    expect(s.get('sess_a', 'outlet_1')).toBeDefined();
  });

  it('forgets a session on clear', () => {
    const { store: s } = store();
    s.appendTurn(s.get('sess_a', 'outlet_1'), 'one dosa', 'ok');

    s.clear('sess_a');
    expect(s.get('sess_a', 'outlet_1').history).toEqual([]);
  });
});

describe('deriveSessionRef', () => {
  it('is stable, short and not the session ID', () => {
    const sessionId = 'sess_super_secret_capability';
    const ref = deriveSessionRef(sessionId);

    expect(ref).toBe(deriveSessionRef(sessionId));
    expect(ref).toHaveLength(12);
    expect(ref).not.toContain('secret');
    expect(sessionId).not.toContain(ref);
  });
});
