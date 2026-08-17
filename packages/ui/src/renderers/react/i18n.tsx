/**
 * Minimal generic i18n context, local to this package (no dependency on
 * `@jini-ai/ui` — see this package's "Allowed deps" in
 * `ADS-memory/reports/jini-port/recon/r4b-webui-design.md` §1, which does not include
 * `@jini-ai/ui`). Same "context + host-injected dictionary, zero-cost
 * passthrough when unconfigured" shape as `@jini-ai/ui`'s
 * `features/i18n`, kept intentionally tiny since this package only has a
 * handful of user-facing strings (fallback/loading text in
 * `ArtifactView`/`SrcDocSandbox`).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type TranslationVars = Record<string, string | number>;
export interface TranslationDict {
  [key: string]: string;
}

export interface I18nContextValue {
  t: (key: string, vars?: TranslationVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  /** The host owns the actual translated copy; omit to run in passthrough mode (`t(key)` returns `key`). */
  dictionary?: TranslationDict;
  children: ReactNode;
}

/** Provides `t` to `useT`/`useI18n`. Safe to mount with no `dictionary` — every lookup falls through to the key itself. */
export function I18nProvider({ dictionary, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({
      t: (key: string, vars?: TranslationVars) => interpolate(dictionary?.[key] ?? key, vars),
    }),
    [dictionary],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const PASSTHROUGH: I18nContextValue = {
  t: (key, vars) => interpolate(key, vars),
};

/** Reads the active `{ t }`. Falls back to a passthrough translator when no {@link I18nProvider} is mounted. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? PASSTHROUGH;
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
