import { describe, expect, it } from 'vitest';
import { ACCENT_SWATCHES, DEFAULT_ACCENT_COLOR } from '../../../features/appearance/constants.js';
import {
  accentVars,
  normalizeAccentColor,
  resolveAccentColor,
} from '../../../features/appearance/rules.js';

describe('normalizeAccentColor', () => {
  it('accepts a lowercase 6-digit hex color unchanged', () => {
    expect(normalizeAccentColor({ value: '#2563eb' })).toBe('#2563eb');
  });

  it('lowercases an uppercase hex color', () => {
    expect(normalizeAccentColor({ value: '#ABCDEF' })).toBe('#abcdef');
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeAccentColor({ value: '  #2563eb  ' })).toBe('#2563eb');
  });

  it('rejects non-string, malformed, and short-hex values', () => {
    expect(normalizeAccentColor({ value: undefined })).toBeNull();
    expect(normalizeAccentColor({ value: 123 })).toBeNull();
    expect(normalizeAccentColor({ value: '#abc' })).toBeNull();
    expect(normalizeAccentColor({ value: 'not-a-color' })).toBeNull();
  });
});

describe('resolveAccentColor', () => {
  it('falls back to the default when the input is invalid', () => {
    expect(resolveAccentColor({ value: 'nope' })).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('passes through a valid color', () => {
    expect(resolveAccentColor({ value: '#ff0000' })).toBe('#ff0000');
  });
});

describe('ACCENT_SWATCHES', () => {
  it('leads with the default accent color', () => {
    expect(ACCENT_SWATCHES[0]).toBe(DEFAULT_ACCENT_COLOR);
  });
});

describe('accentVars', () => {
  it('returns all five --accent* vars, each derived from the given color', () => {
    expect(accentVars({ accentColor: '#ff0000' })).toEqual({
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
    expect(accentVars({ accentColor: 'garbage' })['--accent']).toBe('garbage');
  });
});
