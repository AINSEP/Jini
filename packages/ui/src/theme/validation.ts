import type { AdminTheme, AdminThemeColors } from './types.js';

export const adminThemeColorKeys = ['primary', 'primaryInk', 'bg', 'surface', 'text', 'muted', 'border', 'danger', 'success', 'warning'] as const satisfies readonly (keyof AdminThemeColors)[];
type Validation = { readonly valid: true; readonly theme: AdminTheme } | { readonly valid: false; readonly errors: readonly string[] };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 512 && !/[;{}\x00-\x1f<>\\]/.test(value) && !/url\s*\(|\/\*|\*\//i.test(value);
// Concrete palette values, deliberately excluding dependent var()/url() expressions.
const component = '(?:[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:%|deg|rad|grad|turn)?|none)';
const components = new RegExp(`^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\\(\\s*${component}(?:\\s*,\\s*|\\s+)${component}(?:\\s*,\\s*|\\s+)${component}(?:(?:\\s*[,/]\\s*)${component})?\\s*\\)$`, 'i');
const colorValue = (value: unknown): value is string => safeValue(value)
  && (/^#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?$/i.test(value)
    || components.test(value)
    || /^(?:transparent|black|white|red|green|blue|gray|grey)$/i.test(value));

/** Validate serializable theme data before any DOM or font-loading effect. */
export function validateAdminTheme({ theme }: { readonly theme: unknown }): Validation {
  const errors: string[] = [];
  if (!record(theme)) return { valid: false, errors: ['Theme must be an object'] };
  if (!safeValue(theme.name)) errors.push('name must be a nonempty safe string');
  const fonts = theme.fonts;
  if (!record(fonts) || !safeValue(fonts.body) || !safeValue(fonts.heading) || (fonts.mono !== undefined && !safeValue(fonts.mono))) {
    errors.push('fonts must provide body and heading font stacks');
  }
  if (record(fonts) && fonts.load !== undefined) {
    if (!Array.isArray(fonts.load) || fonts.load.length > 16 || !fonts.load.every((url: unknown) => {
      if (typeof url !== 'string' || url.length > 4096 || /[\x00-\x20<>]/.test(url)) return false;
      try { return new URL(url, 'https://font-base.invalid').protocol === 'https:'; } catch { return false; }
    })) errors.push('fonts.load must contain relative or HTTPS stylesheet URLs');
  }
  for (const scheme of ['light', 'dark'] as const) {
    const colors = theme[scheme];
    if (!record(colors)) { errors.push(`${scheme} must be a complete palette`); continue; }
    for (const key of adminThemeColorKeys) if (!Object.hasOwn(colors, key) || !colorValue(colors[key])) errors.push(`${scheme}.${key} must be a concrete CSS color`);
    for (const key of Object.keys(colors)) if (!(adminThemeColorKeys as readonly string[]).includes(key)) errors.push(`${scheme}.${key} is not a theme color`);
  }
  if (theme.radius !== undefined && (typeof theme.radius !== 'string' || !/^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/.test(theme.radius))) errors.push('radius must be a nonnegative CSS length');
  if (theme.density !== undefined && (typeof theme.density !== 'number' || !Number.isFinite(theme.density) || theme.density < 0.5 || theme.density > 2)) errors.push('density must be between 0.5 and 2');
  return errors.length ? { valid: false, errors } : { valid: true, theme: theme as unknown as AdminTheme };
}
