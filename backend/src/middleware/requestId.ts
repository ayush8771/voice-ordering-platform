import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation ID surfaced in error responses and server logs. */
    requestId: string;
  }
}

/**
 * Assigns a correlation ID to every request.
 *
 * Generated server-side rather than read from a client header, so a caller
 * cannot forge or collide correlation IDs in our logs.
 */
export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
