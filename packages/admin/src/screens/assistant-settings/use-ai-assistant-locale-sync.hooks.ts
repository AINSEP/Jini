import { useEffect } from "react";

/**
 * @file Bridges the host's live admin locale to the `I18nProvider` mounted around the AI Assistant
 * settings screen, so the provider's own components (a BYOK provider form, a settings dialog
 * shell) keep following the operator's Language setting after the initial render, not just at
 * mount. The provider reads `initialLocale` once, at mount, via a lazy `useState` initializer —
 * not a controlled prop — so a locale change after mount would otherwise only take effect on the
 * next full remount.
 *
 * The provider's `{ locale, setLocale }` pair is injected as `{ activeLocale, setLocale }` rather
 * than read here, so a test can describe "the provider's locale disagrees with the prop" without
 * mounting a real `I18nProvider`, and so this package never imports the provider's implementation.
 * The host binds its own `useI18n()` in a one-line wired hook and mounts that.
 */

export interface AiAssistantLocaleSyncHookProps {
  locale: string;
}

/** What this hook needs from the host's i18n provider — just the two fields it reads/calls, not
 *  the whole provider surface. */
export interface AiAssistantLocaleSyncDependencies {
  activeLocale: string;
  setLocale: (locale: string) => void;
}

/** @complexity O(1) — one equality check per render, no iteration. */
export function useAiAssistantLocaleSync(
  { locale, activeLocale, setLocale }: AiAssistantLocaleSyncHookProps & AiAssistantLocaleSyncDependencies,
  _optional: Record<string, never> = {},
): void {
  useEffect(() => {
    if (activeLocale !== locale) setLocale(locale);
  }, [locale, activeLocale, setLocale]);
}
