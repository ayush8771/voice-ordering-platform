import { describe, expect, it } from 'vitest';
import { CONVERSATION_DEFAULTS, loadConversationConfig } from './config.js';

describe('loadConversationConfig', () => {
  it('applies the documented defaults', () => {
    expect(loadConversationConfig({})).toEqual(CONVERSATION_DEFAULTS);
  });

  it('reads each budget from the environment', () => {
    const config = loadConversationConfig({
      CONVERSATION_MAX_INPUT_CHARS: '300',
      CONVERSATION_HISTORY_TURNS: '4',
      CONVERSATION_MAX_TOOL_ROUNDS: '1',
      LLM_MAX_OUTPUT_TOKENS: '256',
      CONVERSATION_SESSION_TTL_MS: '600000',
      CONVERSATION_MAX_SESSIONS: '50',
    });

    expect(config).toEqual({
      maxInputChars: 300,
      historyTurns: 4,
      maxToolRounds: 1,
      maxOutputTokens: 256,
      sessionTtlMs: 600_000,
      maxSessions: 50,
    });
  });

  it.each([
    ['CONVERSATION_MAX_INPUT_CHARS', '10'],
    ['CONVERSATION_HISTORY_TURNS', '-1'],
    ['CONVERSATION_MAX_TOOL_ROUNDS', '9'],
    ['LLM_MAX_OUTPUT_TOKENS', '4'],
    ['CONVERSATION_SESSION_TTL_MS', '1000'],
    ['CONVERSATION_MAX_SESSIONS', '0'],
  ])('rejects an out-of-range %s', (name, value) => {
    expect(() => loadConversationConfig({ [name]: value })).toThrow(
      new RegExp(`Invalid ${name}`),
    );
  });

  it('rejects a non-integer value', () => {
    expect(() => loadConversationConfig({ CONVERSATION_HISTORY_TURNS: '2.5' })).toThrow(
      /Invalid CONVERSATION_HISTORY_TURNS/,
    );
  });
});
