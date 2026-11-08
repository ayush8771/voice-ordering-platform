/**
 * Environment loading and validation.
 *
 * Fails fast on malformed configuration so the server never starts in a state
 * that silently misbehaves. Secret VALUES are never logged (docs/SECURITY.md
 * section 3) - only whether something is configured.
 */

export interface AppConfig {
  readonly port: number;
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly corsAllowedOrigins: readonly string[];
  readonly mongodbUri: string | undefined;
  readonly mongodbDbName: string;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: expected an integer 1-65535, received "${raw}"`);
  }
  return port;
}

function parseNodeEnv(raw: string | undefined): AppConfig['nodeEnv'] {
  if (raw === undefined || raw.trim() === '') return 'development';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new Error(
    `Invalid NODE_ENV: expected development|test|production, received "${raw}"`,
  );
}

/**
 * CORS origins are an explicit allowlist (docs/SECURITY.md section 4).
 * A wildcard is rejected so it cannot reach a deployed environment.
 */
function parseOrigins(raw: string | undefined): readonly string[] {
  const origins = (raw ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  if (origins.includes('*')) {
    throw new Error('CORS_ALLOWED_ORIGINS must be an explicit allowlist, not "*"');
  }
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mongodbUri = env['MONGODB_URI']?.trim();

  return {
    port: parsePort(env['PORT']),
    nodeEnv: parseNodeEnv(env['NODE_ENV']),
    corsAllowedOrigins: parseOrigins(env['CORS_ALLOWED_ORIGINS']),
    mongodbUri: mongodbUri === '' ? undefined : mongodbUri,
    mongodbDbName: env['MONGODB_DB_NAME']?.trim() || 'voice_ordering_dev',
  };
}
