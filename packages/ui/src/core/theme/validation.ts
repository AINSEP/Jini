import type { AdminTheme, AdminThemeColors } from './types.js';

export const adminThemeColorKeys = ['primary', 'primaryInk', 'bg', 'surface', 'text', 'muted', 'border', 'danger', 'success', 'warning'] as const satisfies readonly (keyof AdminThemeColors)[];
type Validation = { readonly valid: true; readonly theme: AdminTheme } | { readonly valid: false; readonly errors: readonly string[] };
type Fields = Record<string, unknown>;
const record = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 512 && !/[;{}\x00-\x1f<>\\]/.test(value) && !/url\s*\(|\/\*|\*\//i.test(value);
// Concrete palette values, deliberately excluding dependent var()/url() expressions.
const component = '(?:[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:%|deg|rad|grad|turn)?|none)';
const components = new RegExp(`^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\\(\\s*${component}(?:\\s*,\\s*|\\s+)${component}(?:\\s*,\\s*|\\s+)${component}(?:(?:\\s*[,/]\\s*)${component})?\\s*\\)$`, 'i');
const colorValue = (value: unknown): value is string => safeValue(value)
  && (/^#[\da-f]{3}(?:[\da-f]|[\da-f]{3}|[\da-f]{5})?$/i.test(value)
    || components.test(value)
    || /^(?:transparent|black|white|red|green|blue|gray|grey)$/i.test(value));

const fontStacksValid = ({ fonts }: { readonly fonts: unknown }): boolean =>
  record(fonts) && safeValue(fonts.body) && safeValue(fonts.heading) && (fonts.mono === undefined || safeValue(fonts.mono));

const stylesheetUrlValid = ({ url }: { readonly url: unknown }): boolean => {
  if (typeof url !== 'string' || url.length > 4096 || /[\x00-\x20<>]/.test(url)) return false;
  try { return new URL(url, 'https://font-base.invalid').protocol === 'https:'; } catch { return false; }
};

const fontLoadValid = ({ load }: { readonly load: unknown }): boolean =>
  load === undefined || (Array.isArray(load) && load.length <= 16 && load.every((url: unknown) => stylesheetUrlValid({ url })));

function fontErrors({ fonts }: { readonly fonts: unknown }): string[] {
  const errors: string[] = [];
  if (!fontStacksValid({ fonts })) errors.push('fonts must provide body and heading font stacks');
  if (record(fonts) && !fontLoadValid({ load: fonts.load })) errors.push('fonts.load must contain relative or HTTPS stylesheet URLs');
  return errors;
}

function paletteErrors({ scheme, colors }: { readonly scheme: 'light' | 'dark'; readonly colors: unknown }): string[] {
  if (!record(colors)) return [`${scheme} must be a complete palette`];
  const known: readonly string[] = adminThemeColorKeys;
  const invalid = adminThemeColorKeys.filter((key) => !Object.hasOwn(colors, key) || !colorValue(colors[key]))
    .map((key) => `${scheme}.${key} must be a concrete CSS color`);
  const unknown = Object.keys(colors).filter((key) => !known.includes(key)).map((key) => `${scheme}.${key} is not a theme color`);
  return [...invalid, ...unknown];
}

const radiusValid = ({ radius }: { readonly radius: unknown }): boolean =>
  radius === undefined || (typeof radius === 'string' && /^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/.test(radius));

const densityValid = ({ density }: { readonly density: unknown }): boolean =>
  density === undefined || (typeof density === 'number' && Number.isFinite(density) && density >= 0.5 && density <= 2);

/** Validate serializable theme data before any DOM or font-loading effect. */
export function validateAdminTheme({ theme }: { readonly theme: unknown }): Validation {
  if (!record(theme)) return { valid: false, errors: ['Theme must be an object'] };
  const errors = [
    ...(safeValue(theme.name) ? [] : ['name must be a nonempty safe string']),
    ...fontErrors({ fonts: theme.fonts }),
    ...paletteErrors({ scheme: 'light', colors: theme.light }),
    ...paletteErrors({ scheme: 'dark', colors: theme.dark }),
    ...(radiusValid({ radius: theme.radius }) ? [] : ['radius must be a nonnegative CSS length']),
    ...(densityValid({ density: theme.density }) ? [] : ['density must be between 0.5 and 2']),
  ];
  return errors.length ? { valid: false, errors } : { valid: true, theme: theme as unknown as AdminTheme };
}
