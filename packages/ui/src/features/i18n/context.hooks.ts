import { useCallback, useEffect, useMemo, useState } from 'react';
import type { I18nContextValue } from './context.js';
import type { Locale, TranslationDict, TranslationVars } from './types.js';
import { detectInitialLocale, type LocalePersistencePort, type SystemLocaleDetector } from './locale.js';

/** Maintain the locale, persistence, document attributes, and translated context value. */
export function useI18nProvider<D extends TranslationDict>({ dictionaries, fallbackLocale, initialLocale, rtlLocales, detectSystemLocale, persistence, syncDocumentAttributes }: {
  dictionaries: Partial<Record<Locale, D>> | undefined;
  fallbackLocale: Locale;
  initialLocale: Locale | undefined;
  rtlLocales: readonly Locale[];
  detectSystemLocale: SystemLocaleDetector | undefined;
  persistence: LocalePersistencePort | undefined;
  syncDocumentAttributes: boolean;
}, _options = {}) {
  const supportedLocales = useMemo(
    () => (dictionaries ? (Object.keys(dictionaries) as Locale[]) : []),
    [dictionaries],
  );

  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale ??
    detectInitialLocale({
      supportedLocales,
      fallbackLocale,
      persistence,
      detectSystemLocale,
    }),
  );

  // Keep <html lang="…" dir="…"> in sync so screen readers and CSS hooks
  // pick the right language token/direction without every component
  // re-deriving it.
  useEffect(() => {
    if (!syncDocumentAttributes || typeof document === 'undefined') return;
    const dir = rtlLocales.includes(locale) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('lang', locale);
    document.documentElement.setAttribute('dir', dir);
  }, [locale, rtlLocales, syncDocumentAttributes]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      persistence?.setStoredLocale(next);
    },
    [persistence],
  );

  const t = useCallback(
    (key: string, vars?: TranslationVars): string => {
      const raw = dictionaries?.[locale]?.[key] ?? dictionaries?.[fallbackLocale]?.[key] ?? key;
      return interpolate({ template: raw, vars });
    },
    [dictionaries, locale, fallbackLocale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return value;
}

/** Interpolate present values and retain placeholders for missing values. */
export function interpolate({ template, vars }: { template: string; vars: TranslationVars | undefined }, _options = {}): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}
