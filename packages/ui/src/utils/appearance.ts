// Generic light/dark theme + accent-color application: writes a
// `data-theme` attribute and a small set of `--accent*` CSS custom
// properties onto `document.documentElement`. Framework-free — a host
// calls `applyAppearanceToDocument` from whatever state layer it uses
// (a settings store, a React effect, etc.).
//
// The accent-color validation and the color-mix formulas behind the five
// `--accent*` values have no DOM dependency and live in `@jini-ai/ui-core`
// (`tabs/appearance`) instead — re-exported below so every existing
// importer of this module (including this package's own public `index.ts`)
// keeps working unchanged.

import { accentVars, resolveAccentColor } from '@jini-ai/ui-core';

export { DEFAULT_ACCENT_COLOR, ACCENT_SWATCHES, normalizeAccentColor, resolveAccentColor } from '@jini-ai/ui-core';

export type AppearanceTheme = 'light' | 'dark';

/**
 * Apply a theme + accent color to `document.documentElement`: sets/clears
 * `data-theme` and writes the five `--accent*` custom properties (using
 * `resolveAccentColor`'s fallback when `accentColor` is missing/invalid).
 *
 * @param options.theme - `'light'` / `'dark'` to set `data-theme`, or
 *   `undefined` to remove the attribute (system/auto).
 * @param options.accentColor - Candidate accent color; validated before use.
 * @complexity O(1) — five DOM property writes.
 */
export function applyAppearanceToDocument({
  theme,
  accentColor,
}: {
  theme?: AppearanceTheme;
  accentColor?: string;
}): void {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }

  const vars = accentVars(resolveAccentColor(accentColor));
  for (const name of Object.keys(vars) as (keyof typeof vars)[]) {
    root.style.setProperty(name, vars[name]);
  }
}
