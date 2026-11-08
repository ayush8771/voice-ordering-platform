import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody, ErrorCode } from '@vop/shared';

/** An error carrying a client-safe code, status and message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: readonly unknown[];

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: readonly unknown[],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static validation(message: string, details?: readonly unknown[]): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  /**
   * A syntactically valid request whose selection cannot be priced - an unknown
   * item or option (docs/API.md quote errors).
   */
  static unprocessable(message: string, details?: readonly unknown[]): ApiError {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }

  /** Current menu state conflicts with the request: unavailable or changed. */
  static conflict(message: string, details?: readonly unknown[]): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  /** Missing or unusable ordering session. */
  static unauthorized(message = 'A valid ordering session is required'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  /** The session is valid but scoped to a different outlet or resource. */
  static forbidden(message = 'This session cannot access that resource'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  /** A dependency the request needs is unavailable; the caller may retry. */
  static unavailable(
    message = 'Service temporarily unavailable. Please retry.',
  ): ApiError {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message);
  }
}

/**
 * Client-safe messages for the body-parser failures `express.json()` raises
 * before any route runs.
 *
 * Without this mapping they fall through to the 500 branch, which is wrong on
 * two counts: unparseable or oversized input is the caller's fault, not a
 * server fault (docs/API.md `400` invalid schema), and treating it as
 * unexpected lets any client fill the error log with stack traces.
 *
 * The parser's own message is deliberately discarded. A failed parse carries
 * the raw request body on `err.body`, and `err.message` can quote part of it,
 * so echoing either would reflect unvalidated input back to the caller.
 *
 * `413` keeps the existing `VALIDATION_ERROR` code rather than introducing a
 * new one: the status already carries the specific meaning, and the documented
 * 400/409/422 distinction stays exactly as it is.
 */
const REQUEST_BODY_ERRORS: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'Request body is not valid JSON',
  'entity.too.large': 'Request body is too large',
  'encoding.unsupported': 'Request body encoding is not supported',
  'charset.unsupported': 'Request body charset is not supported',
  'parameters.too.many': 'Request body has too many parameters',
  'request.aborted': 'Request body was not fully received',
};

/** Recognises a body-parser rejection and restates it as a client error. */
function asRequestBodyError(err: unknown): ApiError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;

  const candidate = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  const type = typeof candidate.type === 'string' ? candidate.type : undefined;
  const message = type === undefined ? undefined : REQUEST_BODY_ERRORS[type];
  if (message === undefined) return undefined;

  const raw =
    typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
  const status = typeof raw === 'number' && raw >= 400 && raw <= 499 ? raw : 400;

  return new ApiError(status, 'VALIDATION_ERROR', message);
}

function buildBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: readonly unknown[],
): ApiErrorBody {
  return {
    error:
      details === undefined
        ? { code, message, requestId }
        : { code, message, requestId, details },
  };
}

/** Terminal 404 handler for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(buildBody('NOT_FOUND', 'Resource not found', req.requestId));
};

/**
 * Central error handler.
 *
 * Known ApiErrors return their own message. Anything else returns a generic
 * message with the correlation ID; the real detail is logged server-side only
 * (docs/SECURITY.md section 4).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  const known = err instanceof ApiError ? err : asRequestBodyError(err);
  if (known !== undefined) {
    res
      .status(known.status)
      .json(buildBody(known.code, known.message, req.requestId, known.details));
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Unhandled request error',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      error: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

  res
    .status(500)
    .json(
      buildBody(
        'INTERNAL_ERROR',
        'An unexpected error occurred. Please retry.',
        req.requestId,
      ),
    );
};
