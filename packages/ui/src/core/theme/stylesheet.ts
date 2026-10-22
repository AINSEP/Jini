import { adminThemeColorKeys, validateAdminTheme } from './validation.js';
import { defaultAdminTheme } from './default.js';
import type { AdminTheme, ColorScheme } from './types.js';

/** Internal document adapter: isolated previews cannot inherit the admin's stylesheet. */
export function renderAdminThemeVariables({ theme }: { readonly theme: AdminTheme },
  { colorScheme = 'light' }: { readonly colorScheme?: ColorScheme } = {}): string {
  if (colorScheme !== 'light' && colorScheme !== 'dark') throw new TypeError('Invalid resolved color scheme');
  const checked = validateAdminTheme({ theme });
  if (!checked.valid) throw new TypeError(checked.errors.join('; '));
  const values = adminThemeColorKeys.map((key) => `--jini-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${theme[colorScheme][key]};`);
  values.push(`--jini-font-body:${theme.fonts.body};`, `--jini-font-heading:${theme.fonts.heading};`,
    `--jini-font-mono:${theme.fonts.mono ?? defaultAdminTheme.fonts.mono};`, `--jini-radius:${theme.radius ?? defaultAdminTheme.radius};`);
  return `:root{color-scheme:${colorScheme};${values.join('')}}`;
}
