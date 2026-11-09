import type { Language } from '@vop/shared';
import { en, type MessageKey } from './en';
import { hi } from './hi';
import { kn } from './kn';

/**
 * Lightweight, type-safe translation. No dependency: a key is a property of the
 * English dictionary, so an unknown key does not compile, and any key missing
 * from another language falls back to English.
 */

export type { MessageKey };

/** A non-English dictionary. Partial so a missing key degrades to English. */
export type Dictionary = Partial<Record<MessageKey, string>>;

export type Params = Readonly<Record<string, string | number>>;

/** Keys that come as a `.one` / `.other` pair, named without the suffix. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? Base : never;
}[MessageKey];

const DICTIONARIES: Readonly<Record<Language, Dictionary>> = { en, kn, hi };

/** Replaces `{name}` placeholders; an unknown placeholder is left as written. */
export function interpolate(template: string, params?: Params): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/**
 * The template for a key in a language, falling back to English. Exposed with
 * an explicit dictionary set so the fallback is testable on its own.
 */
export function lookup(
  dictionaries: Readonly<Record<Language, Dictionary>>,
  language: Language,
  key: MessageKey,
): string {
  return dictionaries[language][key] ?? en[key];
}

export function translate(
  language: Language,
  key: MessageKey,
  params?: Params,
): string {
  return interpolate(lookup(DICTIONARIES, language, key), params);
}

/**
 * Plural lookup. English, Kannada and Hindi each need only a singular and a
 * general form for the counts this UI shows.
 */
export function translatePlural(
  language: Language,
  key: PluralKey,
  count: number,
  params?: Params,
): string {
  const form = `${key}.${count === 1 ? 'one' : 'other'}` as MessageKey;
  return translate(language, form, { count, ...params });
}

/**
 * Splits a template around `{name}` placeholders so a caller can put markup
 * (for example a bold token) inside translated text. Returns text and
 * placeholder names in order.
 */
export type TemplatePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'slot'; readonly name: string };

export function templateParts(language: Language, key: MessageKey): TemplatePart[] {
  const template = lookup(DICTIONARIES, language, key);
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const index = match.index;
    if (index > last) parts.push({ kind: 'text', text: template.slice(last, index) });
    parts.push({ kind: 'slot', name: match[1] ?? '' });
    last = index + match[0].length;
  }
  if (last < template.length) parts.push({ kind: 'text', text: template.slice(last) });
  return parts;
}

/** BCP 47 locale for dates and times. Money stays `en-IN` (see formatMoney). */
export const LOCALES: Readonly<Record<Language, string>> = {
  en: 'en-IN',
  kn: 'kn-IN',
  hi: 'hi-IN',
};

/** Each language named in its own script, so a reader can always find theirs. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  hi: 'हिंदी',
};

/** Every key in the English source, for completeness checks. */
export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export { DICTIONARIES };
