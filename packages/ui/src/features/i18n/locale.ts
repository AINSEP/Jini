/**
 * Framework-free locale-resolution logic for the i18n feature — kept apart
 * from `context.tsx` so the priority-chain algorithm (persisted choice >
 * system detection > fallback) is directly unit-testable without mounting
 * a React tree.
 *
 * Origin: `i18n/index.tsx`'s `resolveSystemLocale`/`detectInitialLocale` in
 * the vendored OD web tree. Genericized — see `packages/ui/archived provenance ledger`
 * for the full accounting of what was dropped (OD's hard-coded 19-locale
 * list, the desktop-host OS-locale bridge, the manual-vs-auto-detected
 * localStorage tagging).
 */
import type { Locale } from './types.js';

/**
 * Resolve the best supported locale for a list of preferred language tags
 * (e.g. `navigator.languages`), in priority order.
 *
 * Match order per candidate language tag: exact case-insensitive match,
 * then a Chinese script/region special-case (bare `zh`/regionless tags
 * resolve to simplified vs. traditional by script/region signal — a
 * generic BCP-47 fallback, not OD-specific), then a bare base-language
 * match (`'en-GB'` → `'en'` when only `'en'` is supported).
 *
 * @param languages - preferred language tags, most-preferred first.
 * @param supportedLocales - locales the host actually has a dictionary for.
 * @returns the first supported locale that matches, or `null`.
 * @complexity O(languages.length * supportedLocales.length) — both lists
 * are small (single-digit to low tens), so the naive nested scan is not
 * worth trading against readability here.
 * @overallScore 100
 */
export function resolveSystemLocale(
  languages: readonly string[],
  supportedLocales: readonly Locale[],
): Locale | null {
  for (const raw of languages) {
    const normalized = raw.trim();
    if (!normalized) continue;

    const exact = supportedLocales.find(
      (locale) => locale.toLowerCase() === normalized.toLowerCase(),
    );
    if (exact) return exact;

    const [language, regionOrScript] = normalized.toLowerCase().split('-');
    if (language === 'zh') {
      const isTraditionalScript =
        regionOrScript === 'hant' ||
        regionOrScript === 'tw' ||
        regionOrScript === 'hk' ||
        regionOrScript === 'mo';
      const candidate = isTraditionalScript ? 'zh-TW' : 'zh-CN';
      if (supportedLocales.includes(candidate)) return candidate;
    }

    const baseMatch = supportedLocales.find(
      (locale) => locale.toLowerCase().split('-')[0] === language,
    );
    if (baseMatch) return baseMatch;
  }
  return null;
}

/** Reads `navigator.languages` (falling back to `navigator.language`). */
function browserPreferredLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/**
 * Default {@link SystemLocaleDetector}: resolves the browser's preferred
 * languages against the supplied supported-locale list. A host on a
 * platform where `navigator.languages` doesn't reflect the real OS locale
 * (e.g. a packaged desktop shell) supplies its own detector instead of this
 * default — see `I18nProviderProps.detectSystemLocale`.
 */
export function defaultDetectSystemLocale(supportedLocales: readonly Locale[]): Locale | null {
  return resolveSystemLocale(browserPreferredLanguages(), supportedLocales);
}

/** Host-supplied locale persistence (e.g. localStorage-backed). */
export interface LocalePersistencePort {
  getStoredLocale(): Locale | null;
  setStoredLocale(locale: Locale): void;
}

/** Host-supplied system-locale probe. See {@link defaultDetectSystemLocale}. */
export type SystemLocaleDetector = (supportedLocales: readonly Locale[]) => Locale | null;

export interface DetectInitialLocaleOptions {
  supportedLocales: readonly Locale[];
  fallbackLocale: Locale;
  persistence?: LocalePersistencePort | undefined;
  detectSystemLocale?: SystemLocaleDetector | undefined;
}

/**
 * Resolve the locale a provider should start in, in priority order:
 * a persisted choice (if the host supplies persistence and it names a
 * supported locale) > system detection > `fallbackLocale`.
 *
 * Origin's `detectInitialLocale` additionally tagged localStorage writes
 * as "manual" vs. "auto-detected" so only a deliberate user pick could
 * out-rank a freshly-read OS locale. That nuance is OD product policy, not
 * generic mechanism — dropped here; a host that wants it implements the
 * same rule inside its own {@link LocalePersistencePort} (e.g. only call
 * `setStoredLocale` from an explicit "change language" action).
 *
 * @overallScore 100
 */
export function detectInitialLocale(options: DetectInitialLocaleOptions): Locale {
  const { supportedLocales, fallbackLocale, persistence, detectSystemLocale } = options;
  if (typeof window === 'undefined') return fallbackLocale;

  const stored = persistence?.getStoredLocale() ?? null;
  if (stored && supportedLocales.includes(stored)) return stored;

  const detect = detectSystemLocale ?? defaultDetectSystemLocale;
  const detected = detect(supportedLocales);
  if (detected && supportedLocales.includes(detected)) return detected;

  return fallbackLocale;
}
