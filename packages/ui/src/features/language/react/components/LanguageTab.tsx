import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import type { LocaleOption } from '@jini-ai/ui-core';

export interface LanguageTabProps {
  locales: readonly LocaleOption[];
  selectedLocale: string;
  onSelectLocale: (code: string) => void;
  ariaLabel?: string;
}

/**
 * Locale radio-tile grid. Origin: the inline `language` tab body in
 * `SettingsDialog.tsx` — GENERIC, no product coupling beyond the (already
 * dropped) analytics tracking call and OD's own fixed locale list (now a
 * host-supplied `locales` prop).
 */
export function LanguageTab({ locales, selectedLocale, onSelectLocale, ariaLabel }: LanguageTabProps) {
  const t = useT();
  const resolvedAriaLabel = ariaLabel ?? t('Language');

  return (
    <section className="jini-settings-section jini-settings-language">
      <div className="jini-settings-language-grid" role="radiogroup" aria-label={resolvedAriaLabel}>
        {locales.map(({ code, label }) => {
          const active = selectedLocale === code;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              className={`jini-settings-language-tile${active ? ' active' : ''}`}
              onClick={() => onSelectLocale(code)}
            >
              <span className="jini-settings-language-tile-text">
                <span className="jini-settings-language-tile-title">{label}</span>
                <span className="jini-settings-language-tile-code">{code}</span>
              </span>
              {active ? <Icon name="check" size={16} /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
