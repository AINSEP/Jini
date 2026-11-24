import { useEffect } from "react";

/**
 * @file `SettingsLocaleSync`'s locale-bridging effect, so the host's `SettingsLocaleSync` is only
 * markup (a `null`-returning wrapper).
 *
 * Extracted verbatim. Bridges the `core.language.locale` setting (loaded/persisted by the
 * `language` slice, via the host's own content store) to the mounted `I18nProvider`'s active locale.
 *
 * `I18nProvider` has no *controlled* `locale` prop — only `initialLocale`, read once at mount via
 * a lazy `useState` initializer — so a locale picked in `LanguageTab` (which calls
 * `onSelectLocale` → the `language` slice's `onChange`, not `useI18n().setLocale`) would otherwise
 * only take effect on the next full remount, not immediately. This hook exists only to keep the
 * two locale sources of truth in sync after the first render, so the host's own persistence stays
 * the one real source and the provider's internal state just follows it.
 *
 * `useI18n()`'s `{ locale, setLocale }` pair is injected rather than called directly, so a test can
 * describe "the provider's locale disagrees with the prop" without mounting a real `I18nProvider`.
 * The zero-argument wired half (the one that calls the UI library's `useI18n()`) lives in the host,
 * which owns the UI library binding; this package never imports it.
 */

export interface SettingsLocaleSyncHookProps {
  locale: string;
}

/** What this hook needs from `useI18n()` — just the two fields it reads/calls, not the whole
 *  provider surface. */
export interface SettingsLocaleSyncDependencies {
  activeLocale: string;
  setLocale: (locale: string) => void;
}

/** @complexity O(1) — one equality check per render, no iteration. */
export function useSettingsLocaleSync(
  { locale }: SettingsLocaleSyncHookProps,
  { activeLocale, setLocale }: SettingsLocaleSyncDependencies,
): void {
  useEffect(() => {
    if (activeLocale !== locale) setLocale(locale);
  }, [locale, activeLocale, setLocale]);
}
