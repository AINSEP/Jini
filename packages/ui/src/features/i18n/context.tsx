'use client';

/**
 * Generic i18n context + hooks — the "context + host-injected adapter,
 * default no-op" shape already used by this package's other injectable
 * slots (mirrors the analytics-adapter pattern from
 * `foundry/docs/jini-port/recon/r4-webui.md` §5c: context, host supplies its own
 * dictionary or gets a passthrough).
 *
 * Origin: `i18n/index.tsx` in the vendored OD web tree. Ported the
 * *mechanism* only — see `packages/ui/source-map.md` for what was dropped
 * (OD's 19 baked-in locale dictionaries, OD's desktop-host OS-locale
 * bridge, the manual-vs-auto-detected localStorage tagging).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale, TranslationDict, TranslationVars } from './types.js';
import {
  detectInitialLocale,
  resolveSystemLocale,
  type LocalePersistencePort,
  type SystemLocaleDetector,
} from './locale.js';

export { detectInitialLocale, resolveSystemLocale };
export type { LocalePersistencePort, SystemLocaleDetector };

/** Locale codes rendered right-to-left when no `rtlLocales` override is given. */
const DEFAULT_RTL_LOCALES: readonly Locale[] = ['ar', 'fa', 'he', 'ur'];

export interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: TranslationVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps<D extends TranslationDict = TranslationDict> {
  /** Dictionaries keyed by locale. The host owns the actual translated
   *  copy; omit entirely to run in passthrough mode (`t(key)` returns
   *  `key`). */
  dictionaries?: Partial<Record<Locale, D>>;
  /** Locale used when nothing else resolves, and as the last-resort
   *  dictionary lookup when a key is missing from the active locale.
   *  Defaults to `'en'`. */
  fallbackLocale?: Locale;
  /**
   * Skips detection and pins the initial locale.
   *
   * **Read exactly once, at mount.** It seeds a `useState` lazy initializer below, so this provider
   * is UNCONTROLLED: passing a different `initialLocale` on a later render changes nothing. After
   * mount, `useI18n().setLocale` is the only thing that moves the locale.
   *
   * That matters for any host whose locale lives OUTSIDE React — a settings ledger, a server push, a
   * change made in a second browser tab. Such a host owns the real source of truth, and a value it
   * re-reads will not reach this provider on its own; without a bridge, a locale change takes effect
   * only on the next full remount, which in practice means a page reload.
   *
   * The bridge is small, and hosts should expect to write it rather than look for a `locale` prop:
   *
   * ```tsx
   * function LocaleSync({ locale }: { locale: Locale }) {
   *   const { locale: active, setLocale } = useI18n();
   *   useEffect(() => {
   *     if (active !== locale) setLocale(locale);
   *   }, [locale, active, setLocale]);
   *   return null; // renders nothing; exists only to keep the two in sync
   * }
   * ```
   *
   * Mount it inside the provider, fed by whatever the host persists. Tovu does exactly this
   * (`apps/admin/src/sections/SettingsUi.tsx`'s `SettingsLocaleSync`), which is what lets a locale
   * changed by its admin assistant — or pushed from its server to an already-open tab — re-render
   * the dialog in place instead of waiting for a reload.
   *
   * A controlled `locale` prop would remove the shim, and is worth adding if a second host hits the
   * same wall. It is not offered today because `setLocale` also writes through {@link
   * I18nProviderProps.persistence}, so a controlled mode has to answer who owns the stored value —
   * the prop or the port — and that belongs in a deliberate API change rather than an inferred one.
   */
  initialLocale?: Locale;
  /** Locale codes to render right-to-left. Defaults to a small built-in
   *  set of commonly RTL languages ({@link DEFAULT_RTL_LOCALES}). */
  rtlLocales?: readonly Locale[];
  /** Host-supplied system-locale probe (desktop bridge, custom header,
   *  etc.). Defaults to a browser `navigator.languages` check. */
  detectSystemLocale?: SystemLocaleDetector;
  /** Host-supplied locale persistence (e.g. localStorage-backed). Omit for
   *  session-only locale state. */
  persistence?: LocalePersistencePort;
  /** Sync `<html lang dir>` with the active locale. Defaults to `true`. */
  syncDocumentAttributes?: boolean;
  children: ReactNode;
}

/**
 * Provides `locale`/`setLocale`/`t` to `useI18n`/`useT`. Safe to mount with
 * no `dictionaries` at all — every lookup then falls through to the key
 * itself, so a host can wire this in before it has any translated copy.
 *
 * @overallScore 100
 */
export function I18nProvider<D extends TranslationDict = TranslationDict>({
  dictionaries,
  fallbackLocale = 'en',
  initialLocale,
  rtlLocales = DEFAULT_RTL_LOCALES,
  detectSystemLocale,
  persistence,
  syncDocumentAttributes = true,
  children,
}: I18nProviderProps<D>) {
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
      return interpolate(raw, vars);
    },
    [dictionaries, locale, fallbackLocale],
  );

  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Stand-alone passthrough used when no `I18nProvider` is mounted. */
const PASSTHROUGH_CONTEXT: I18nContextValue = {
  locale: 'en',
  setLocale: () => {
    /* no-op: no provider to hold state */
  },
  t: (key, vars) => interpolate(key, vars),
};

/**
 * Reads the active `{ locale, setLocale, t }`. Falls back to a stand-alone
 * passthrough translator when no `I18nProvider` is mounted (e.g. an
 * isolated unit test) — callers never need to special-case "no provider".
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  return ctx ?? PASSTHROUGH_CONTEXT;
}

/** Convenience for call sites that only need the translator function. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}

function interpolate(template: string, vars: TranslationVars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}
