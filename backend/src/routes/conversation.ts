/**
 * Conversational turn route.
 *
 * NEEDS JOINT AGREEMENT: docs/API.md specifies the conversational service as an
 * internal contract and says no HTTP route exists. This adds the one route that
 * contract implies, because a QR or kiosk client cannot reach the service any
 * other way - clients must never call an LLM directly (docs/API.md, "Shared
 * conversational service contract").
 *
 *   POST /api/v1/conversation/turns   one customer utterance, applied to the draft
 *
 * Transport only. The turn's rules live in the conversation service (prompt,
 * tool allowlist, recommendation policy), the cart service (every draft rule)
 * and `workflows/conversationTurn.ts` (how a proposal reaches the draft).
 *
 * Scope: `Authorization: Bearer <sessionId>` is required, and `sessionId`,
 * `outletId` and `channel` are all taken from the authenticated session. A body
 * that names a different outlet is `403`; a body cannot name a session at all.
 *
 * Nothing here can create or confirm an order. The response carries the
 * authoritative draft, and confirmation remains a separate, explicit
 * `POST /api/v1/orders` with `customerConfirmed: true`
 * (docs/SECURITY.md section 2).
 */

import { Router } from 'express';
import { LANGUAGES, type ConversationTurnResponse, type Language } from '@vop/shared';
import { ApiError } from '../middleware/errors.js';
import {
  getOrderingSession,
  requireOrderingSession,
} from '../middleware/orderingSession.js';
import {
  ConversationError,
  CONVERSATION_PHASES,
  type ConversationPhase,
} from '../services/conversation/types.js';
import type { ConversationService } from '../services/conversation/service.js';
import type { CartService } from '../services/cart/cartService.js';
import type { OrderingSessionService } from '../services/sessions/orderingSessionService.js';
import { runConversationTurn } from '../workflows/conversationTurn.js';
import type { OrderingSession } from '../services/sessions/orderingSessionService.js';

/**
 * Maps a service-level refusal onto HTTP.
 *
 * `session_limit_reached` is a `503`: the conversational path is temporarily
 * unavailable and the customer can still order by touch, which is exactly the
 * documented degradation (docs/PRD.md section 5).
 */
function toApiError(error: ConversationError): ApiError {
  switch (error.code) {
    case 'session_scope_mismatch':
      return ApiError.forbidden('This session cannot be used for that outlet');
    case 'session_limit_reached':
      return ApiError.unavailable(
        'The assistant is busy. Please order using the on-screen menu.',
      );
    default:
      return ApiError.validation(error.message);
  }
}

function readLanguage(raw: unknown): Language {
  if (typeof raw === 'string' && (LANGUAGES as readonly string[]).includes(raw)) {
    return raw as Language;
  }
  throw ApiError.validation(`language must be one of ${LANGUAGES.join(', ')}`);
}

function readPhase(raw: unknown): ConversationPhase {
  if (
    typeof raw === 'string' &&
    (CONVERSATION_PHASES as readonly string[]).includes(raw)
  ) {
    return raw as ConversationPhase;
  }
  throw ApiError.validation(`phase must be one of ${CONVERSATION_PHASES.join(', ')}`);
}

/** The draft scope, taken only from the authenticated session. */
function toScope(session: OrderingSession): {
  sessionId: string;
  outletId: string;
  expiresAtMs: number;
} {
  return {
    sessionId: session.sessionId,
    outletId: session.outletId,
    expiresAtMs: session.expiresAtMs,
  };
}

export function createConversationRouter(
  /**
   * Absent when no conversational provider is configured. The route is still
   * mounted and answers `503`, so a client learns the assistant is unavailable
   * and falls back to touch instead of hitting a 404 it cannot interpret.
   */
  conversation: ConversationService | undefined,
  cartService: CartService,
  sessions: OrderingSessionService,
): Router {
  const router = Router();
  router.use('/conversation', requireOrderingSession(sessions));

  router.post('/conversation/turns', async (req, res, next) => {
    try {
      if (conversation === undefined) {
        throw ApiError.unavailable(
          'The assistant is not available. Please order using the on-screen menu.',
        );
      }

      const session = getOrderingSession(req);
      const body: Record<string, unknown> =
        typeof req.body === 'object' && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};

      const outletId = body['outletId'];
      if (outletId !== undefined && outletId !== session.outletId) {
        throw ApiError.forbidden('This session cannot order from that outlet');
      }

      const result = await runConversationTurn(
        { conversation, cartService },
        {
          scope: toScope(session),
          // From the session, never the body: the channel decides kiosk versus
          // QR wording and must not be chosen by the caller.
          channel: session.channel,
          language: readLanguage(body['language']),
          phase: readPhase(body['phase']),
          // Length and emptiness are the conversation service's bounds.
          text: typeof body['text'] === 'string' ? body['text'] : '',
          ...(body['customerDeclinedRecommendation'] === true
            ? { customerDeclinedRecommendation: true }
            : {}),
        },
      );

      // Compile-time check that the published client contract stays assignable
      // from the workflow's richer result; the response body is the result.
      const responseBody: ConversationTurnResponse = result;
      res.status(200).json(responseBody);
    } catch (error) {
      next(error instanceof ConversationError ? toApiError(error) : error);
    }
  });

  return router;
}
