import { LANGUAGES, type Language } from '@vop/shared';

/**
 * Remembers the UI language across reloads. Pure helpers over a Storage-like
 * object so the rules are testable without a browser.
 *
 * The value is the language code only: no personal data. It lives in
 * `localStorage`, unlike the ordering session (per-tab `sessionStorage`), so a
 * phone or kiosk keeps its language after a refresh or a new order.
 */
export const LANGUAGE_STORAGE_KEY = 'vop.language';
export const DEFAULT_LANGUAGE: Language = 'en';

export type LanguageStore = Pick<Storage, 'getItem' | 'setItem'>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** A stored value, or English when it is missing, invalid or unreadable. */
export function readStoredLanguage(store: LanguageStore | undefined): Language {
  try {
    const value = store?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    // Storage can be blocked (private mode, kiosk policy); English still works.
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Validates and remembers a selection. Returns the language actually in
 * effect: an invalid value is refused and leaves `current` unchanged.
 */
export function selectLanguage(
  store: LanguageStore | undefined,
  value: unknown,
  current: Language,
): Language {
  if (!isLanguage(value)) return current;
  try {
    store?.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    /* a blocked store must not stop the switch for this page view */
  }
  return value;
}

/** The browser's localStorage, or undefined where it cannot be reached. */
export function browserLanguageStore(): LanguageStore | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
