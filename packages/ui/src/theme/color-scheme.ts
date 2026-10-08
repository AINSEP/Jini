import type { ColorScheme, ColorSchemePreference, MatchMediaPort } from '../core/theme/types.js';

/** Explicit choices are deterministic; system resolution requires the host's media port. */
export function resolveColorScheme({ preference }: { readonly preference: ColorSchemePreference },
  { matchMedia }: { readonly matchMedia?: MatchMediaPort } = {}): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  if (preference !== 'system' || !matchMedia) throw new TypeError('System color scheme requires matchMedia');
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
