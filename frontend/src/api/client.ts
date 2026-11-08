import { API_BASE_PATH, type ApiErrorBody, type HealthResponse } from '@vop/shared';

/**
 * Typed API client. UI components call these functions and never talk to the
 * network, a database or a provider SDK directly (docs/ARCHITECTURE.md
 * section 5).
 */

/** An API failure carrying the server's safe message and correlation ID. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  return typeof candidate === 'object' && candidate !== null && 'code' in candidate;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_PATH}${path}`, {
      headers: { Accept: 'application/json', ...init?.headers },
      ...init,
    });
  } catch {
    // Network/offline failure: the request never reached the server, so no
    // action can be assumed to have been saved.
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server.');
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiRequestError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.requestId,
      );
    }
    throw new ApiRequestError(
      response.status,
      'INTERNAL_ERROR',
      'The server returned an unexpected response.',
    );
  }

  return body as T;
}

/** Infrastructure probe used to verify client/server communication. */
export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}
