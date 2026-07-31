import { DEFAULT_ACCENT_COLOR } from './constants.js';

/**
 * The five `--accent*` CSS custom property names this feature writes.
 * Module-private: callers get values back from `accentVars`, keyed by these
 * names, rather than needing the list itself.
 */
const ACCENT_VARS = ['--accent', '--accent-strong', '--accent-soft', '--accent-tint', '--accent-hover'] as const;

export type AccentCssVars = Record<(typeof ACCENT_VARS)[number], string>;

/**
 * Validate and lowercase a `#rrggbb` accent color string.
 *
 * @param value - Candidate accent color, typically from persisted config.
 * @returns The lowercased 6-digit hex string, or `null` if `value` is not a
 *   string or does not match `#rrggbb`.
 * @complexity O(1).
 */
export function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** `normalizeAccentColor(value) ?? DEFAULT_ACCENT_COLOR` — always returns a
 *  usable color. */
export function resolveAccentColor(value: unknown): string {
  return normalizeAccentColor(value) ?? DEFAULT_ACCENT_COLOR;
}

/**
 * Pure computation of the five `--accent*` CSS custom property values for a
 * given (already-resolved) accent color, via `color-mix()` formulas. The DOM
 * write itself (`applyAppearanceToDocument`) lives in `packages/ui` — it
 * needs `document`, which is the one thing this package can't have — and
 * calls this for the values it writes.
 *
 * @complexity O(1) — five template-string formulas, no DOM access.
 */
export function accentVars(accentColor: string): AccentCssVars {
  return {
    '--accent': accentColor,
    '--accent-strong': `color-mix(in srgb, ${accentColor} 86%, var(--text-strong))`,
    '--accent-soft': `color-mix(in srgb, ${accentColor} 22%, var(--bg-panel))`,
    '--accent-tint': `color-mix(in srgb, ${accentColor} 12%, var(--bg-panel))`,
    '--accent-hover': `color-mix(in srgb, ${accentColor} 90%, var(--text-strong))`,
  };
}
