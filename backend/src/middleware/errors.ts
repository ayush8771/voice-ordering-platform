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

  if (err instanceof ApiError) {
    res
      .status(err.status)
      .json(buildBody(err.code, err.message, req.requestId, err.details));
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
