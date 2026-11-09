import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import type { Language } from '@vop/shared';
import { browserLanguageStore, readStoredLanguage, selectLanguage } from './storage';
import {
  LOCALES,
  templateParts,
  translate,
  translatePlural,
  type MessageKey,
  type Params,
  type PluralKey,
} from './translate';

/**
 * One UI language for the whole app. It is UI state only: switching it never
 * touches the cart, the ordering session or an order, and backend content
 * (menu, categories, outlet names, server messages) is never translated.
 */
export interface I18n {
  readonly language: Language;
  readonly locale: string;
  readonly setLanguage: (language: Language) => void;
  readonly t: (key: MessageKey, params?: Params) => string;
  readonly tp: (key: PluralKey, count: number, params?: Params) => string;
  /** Translated text with markup in its `{slots}`, e.g. a bold token. */
  readonly rich: (
    key: MessageKey,
    slots: Readonly<Record<string, ReactNode>>,
  ) => ReactNode;
}

function makeI18n(language: Language, setLanguage: (language: Language) => void): I18n {
  return {
    language,
    locale: LOCALES[language],
    setLanguage,
    t: (key, params) => translate(language, key, params),
    tp: (key, count, params) => translatePlural(language, key, count, params),
    rich: (key, slots) =>
      templateParts(language, key).map((part, index) => (
        <Fragment key={index}>
          {part.kind === 'text' ? part.text : (slots[part.name] ?? `{${part.name}}`)}
        </Fragment>
      )),
  };
}

/** English with a no-op setter, for anything rendered outside the provider. */
const I18nContext = createContext<I18n>(makeI18n('en', () => undefined));

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguageState] = useState<Language>(() =>
    readStoredLanguage(browserLanguageStore()),
  );

  const setLanguage = useCallback((next: Language) => {
    setLanguageState((current) =>
      selectLanguage(browserLanguageStore(), next, current),
    );
  }, []);

  // Screen readers and the browser's font and hyphenation choices follow this.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => makeI18n(language, setLanguage), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
