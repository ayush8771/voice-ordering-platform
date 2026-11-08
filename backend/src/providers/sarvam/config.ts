/**
 * Sarvam adapter configuration.
 *
 * Kept out of `config/env.ts` so the core app config has no vendor-specific
 * fields and the adapter stays independently replaceable
 * (docs/CODE_STYLE.md section 2).
 *
 * The API key is read server-side only and is never logged, serialized or sent
 * anywhere except the provider request header (docs/SECURITY.md section 3).
 */

/** Model confirmed as the planned primary conversational LLM (CLAUDE.md). */
export const SARVAM_DEFAULT_MODEL = 'sarvam-105b-conversations';
export const SARVAM_DEFAULT_BASE_URL = 'https://api.sarvam.ai';
export const SARVAM_DEFAULT_TIMEOUT_MS = 15_000;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export interface SarvamConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Redacted form used by anything that serializes config. */
  toJSON(): SarvamConfigSummary;
}

/** Safe-to-log projection: reports whether a key exists, never its value. */
export interface SarvamConfigSummary {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly apiKeyConfigured: boolean;
}

function parseBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (value === undefined || value === '') return SARVAM_DEFAULT_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid SARVAM_BASE_URL: expected an absolute http(s) URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid SARVAM_BASE_URL: expected an absolute http(s) URL`);
  }
  return value.replace(/\/+$/, '');
}

function parseTimeout(raw: string | undefined): number {
  const value = raw?.trim();
  if (value === undefined || value === '') return SARVAM_DEFAULT_TIMEOUT_MS;

  const timeoutMs = Number(value);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `Invalid SARVAM_TIMEOUT_MS: expected an integer ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}, received "${value}"`,
    );
  }
  return timeoutMs;
}

/**
 * Loads and validates Sarvam settings, failing fast on bad configuration.
 *
 * Error messages quote variable names and offending non-secret values only -
 * never the key itself.
 */
export function loadSarvamConfig(env: NodeJS.ProcessEnv = process.env): SarvamConfig {
  const apiKey = env['SARVAM_API_KEY']?.trim();
  if (apiKey === undefined || apiKey === '') {
    throw new Error('Missing SARVAM_API_KEY: the Sarvam provider is not configured');
  }

  const baseUrl = parseBaseUrl(env['SARVAM_BASE_URL']);
  const model = env['SARVAM_MODEL']?.trim() || SARVAM_DEFAULT_MODEL;
  const timeoutMs = parseTimeout(env['SARVAM_TIMEOUT_MS']);

  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    toJSON(): SarvamConfigSummary {
      return { baseUrl, model, timeoutMs, apiKeyConfigured: true };
    },
  };
}

/** True when a Sarvam key is present, so callers can pick a fallback path. */
export function isSarvamConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const apiKey = env['SARVAM_API_KEY']?.trim();
  return apiKey !== undefined && apiKey !== '';
}
