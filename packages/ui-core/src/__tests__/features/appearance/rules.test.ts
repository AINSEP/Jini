import { describe, expect, it } from 'vitest';
import { ACCENT_SWATCHES, DEFAULT_ACCENT_COLOR, accentVars, normalizeAccentColor, resolveAccentColor } from '../../../features/appearance/index.js';

describe('normalizeAccentColor', () => {
  it('accepts a lowercase 6-digit hex color unchanged', () => {
    expect(normalizeAccentColor('#2563eb')).toBe('#2563eb');
  });

  it('lowercases an uppercase hex color', () => {
    expect(normalizeAccentColor('#ABCDEF')).toBe('#abcdef');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeAccentColor('  #2563eb  ')).toBe('#2563eb');
  });

  it('rejects non-string, malformed, and short-hex values', () => {
    expect(normalizeAccentColor(undefined)).toBeNull();
    expect(normalizeAccentColor(123)).toBeNull();
    expect(normalizeAccentColor('#abc')).toBeNull();
    expect(normalizeAccentColor('not-a-color')).toBeNull();
  });
});

describe('resolveAccentColor', () => {
  it('falls back to the default when the input is invalid', () => {
    expect(resolveAccentColor('nope')).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('passes through a valid color', () => {
    expect(resolveAccentColor('#ff0000')).toBe('#ff0000');
  });
});

describe('ACCENT_SWATCHES', () => {
  it('leads with the default accent color', () => {
    expect(ACCENT_SWATCHES[0]).toBe(DEFAULT_ACCENT_COLOR);
  });
});

describe('accentVars', () => {
  it('returns all five --accent* vars, each derived from the given color', () => {
    expect(accentVars('#ff0000')).toEqual({
      '--accent': '#ff0000',
      '--accent-strong': 'color-mix(in srgb, #ff0000 86%, var(--text-strong))',
      '--accent-soft': 'color-mix(in srgb, #ff0000 22%, var(--bg-panel))',
      '--accent-tint': 'color-mix(in srgb, #ff0000 12%, var(--bg-panel))',
      '--accent-hover': 'color-mix(in srgb, #ff0000 90%, var(--text-strong))',
    });
  });

  it('does not validate its input — callers resolve the color first', () => {
    // `accentVars` trusts its caller (`applyAppearanceToDocument` always
    // passes it through `resolveAccentColor` first); it splices the raw
    // string into every formula rather than re-validating.
    expect(accentVars('garbage')['--accent']).toBe('garbage');
  });
});
