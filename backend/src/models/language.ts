/**
 * Language validation at the edge.
 *
 * One reader for every surface - the menu route's `?lang=`, the cart and quote
 * routes', and the conversational turn's body field - so no two endpoints can
 * disagree about which languages exist or how a bad value is reported. The set
 * itself is `LANGUAGES` in the shared contracts (docs/PRD.md language support);
 * nothing here invents a language or a regional variant.
 *
 * A value outside the set is a `400 VALIDATION_ERROR` rather than a silent
 * fallback: a client picks from a closed union it already has, so an unknown
 * value is a bug worth reporting, and - unlike an outlet ID - a language
 * discloses nothing, so there is no reason to hide the reason.
 */

import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '@vop/shared';
import { ApiError } from '../middleware/errors.js';

function isLanguage(raw: unknown): raw is Language {
  return typeof raw === 'string' && (LANGUAGES as readonly string[]).includes(raw);
}

/** A required language value, as the conversational turn carries one. */
export function parseLanguage(raw: unknown): Language {
  if (isLanguage(raw)) return raw;
  throw ApiError.validation(`language must be one of ${LANGUAGES.join(', ')}`);
}

/**
 * An optional `?lang=` parameter. Absent means English, which is what keeps
 * every existing client's requests byte-identical in effect.
 *
 * A repeated parameter (`?lang=kn&lang=hi`, which Express surfaces as an
 * array) is rejected rather than resolved to one of them.
 */
export function readLanguageParam(raw: unknown): Language {
  if (raw === undefined) return DEFAULT_LANGUAGE;
  if (typeof raw !== 'string') {
    throw ApiError.validation('lang must be a single language code');
  }
  return parseLanguage(raw);
}
