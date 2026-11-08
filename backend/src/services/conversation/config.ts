/**
 * Conversation service budgets.
 *
 * docs/PROVIDERS.md puts request/output budget enforcement in this service
 * rather than in the provider adapter, so these values live here and the
 * adapter stays a transport concern.
 *
 * Input is bounded in characters, not tokens: measuring tokens would mean
 * adding a tokenizer dependency, and docs/CODE_STYLE.md section 5 asks for a
 * concrete need before a new dependency.
 */

export interface ConversationConfig {
  /** Maximum accepted length of one customer utterance. */
  readonly maxInputChars: number;
  /** Prior turns replayed to the model (user+assistant pairs). */
  readonly historyTurns: number;
  /** Tool-result round trips allowed per customer turn. */
  readonly maxToolRounds: number;
  /** Output cap passed to the provider per call. */
  readonly maxOutputTokens: number;
  /** Idle lifetime of in-memory conversation state. */
  readonly sessionTtlMs: number;
  /** Hard cap on tracked sessions, so memory cannot grow without bound. */
  readonly maxSessions: number;
}

export const CONVERSATION_DEFAULTS: ConversationConfig = {
  maxInputChars: 600,
  historyTurns: 8,
  maxToolRounds: 2,
  maxOutputTokens: 400,
  sessionTtlMs: 30 * 60 * 1000,
  maxSessions: 500,
};

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw?.trim();
  if (value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Invalid ${name}: expected an integer ${min}-${max}, received "${value}"`,
    );
  }
  return parsed;
}

export function loadConversationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConversationConfig {
  return {
    maxInputChars: parseInteger(
      env['CONVERSATION_MAX_INPUT_CHARS'],
      'CONVERSATION_MAX_INPUT_CHARS',
      CONVERSATION_DEFAULTS.maxInputChars,
      50,
      4000,
    ),
    historyTurns: parseInteger(
      env['CONVERSATION_HISTORY_TURNS'],
      'CONVERSATION_HISTORY_TURNS',
      CONVERSATION_DEFAULTS.historyTurns,
      0,
      40,
    ),
    maxToolRounds: parseInteger(
      env['CONVERSATION_MAX_TOOL_ROUNDS'],
      'CONVERSATION_MAX_TOOL_ROUNDS',
      CONVERSATION_DEFAULTS.maxToolRounds,
      0,
      5,
    ),
    maxOutputTokens: parseInteger(
      env['LLM_MAX_OUTPUT_TOKENS'],
      'LLM_MAX_OUTPUT_TOKENS',
      CONVERSATION_DEFAULTS.maxOutputTokens,
      32,
      4000,
    ),
    sessionTtlMs: parseInteger(
      env['CONVERSATION_SESSION_TTL_MS'],
      'CONVERSATION_SESSION_TTL_MS',
      CONVERSATION_DEFAULTS.sessionTtlMs,
      60_000,
      24 * 60 * 60 * 1000,
    ),
    maxSessions: parseInteger(
      env['CONVERSATION_MAX_SESSIONS'],
      'CONVERSATION_MAX_SESSIONS',
      CONVERSATION_DEFAULTS.maxSessions,
      1,
      100_000,
    ),
  };
}
