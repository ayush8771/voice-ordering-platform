import { useId, type JSX } from 'react';
import { LANGUAGES } from '@vop/shared';
import { useI18n } from './I18nProvider';
import { isLanguage } from './storage';
import { LANGUAGE_NAMES } from './translate';

/**
 * Customer language choice: large radio chips (touch-friendly on phone and
 * kiosk), styled by `ordering.css`. Each name is in its own script and marked
 * with its own `lang`, so it is readable and pronounced correctly whatever the
 * current UI language.
 */
export function LanguageChoice(): JSX.Element {
  const { language, setLanguage, t } = useI18n();
  const name = useId();
  return (
    <fieldset className="vop-language">
      <legend className="vop-muted">{t('lang.label')}</legend>
      {LANGUAGES.map((option) => (
        <label
          key={option}
          lang={option}
          className={`vop-choice${language === option ? ' vop-choice--selected' : ''}`}
        >
          <input
            type="radio"
            name={name}
            checked={language === option}
            onChange={() => setLanguage(option)}
          />
          {LANGUAGE_NAMES[option]}
        </label>
      ))}
    </fieldset>
  );
}

/** Compact language selector for staff screens (merchant and kitchen). */
export function LanguageSelect({ className }: { className: string }): JSX.Element {
  const { language, setLanguage, t } = useI18n();
  const id = useId();
  return (
    <span className={className}>
      <label htmlFor={id}>{t('lang.label')}</label>
      <select
        id={id}
        value={language}
        onChange={(event) => {
          if (isLanguage(event.target.value)) setLanguage(event.target.value);
        }}
      >
        {LANGUAGES.map((option) => (
          <option key={option} value={option} lang={option}>
            {LANGUAGE_NAMES[option]}
          </option>
        ))}
      </select>
    </span>
  );
}
