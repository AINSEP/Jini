import { describe, expect, it } from 'vitest';
import { hexToRgb, luminance, mixHex, normalizeHex, readableTextColor, toHexByte } from '../color-math.js';

describe('normalizeHex', () => {
  it('returns null for undefined', () => {
    expect(normalizeHex({ value: undefined })).toBeNull();
  });

  it('returns null when no hex-color substring is present', () => {
    expect(normalizeHex({ value: 'not a color' })).toBeNull();
  });

  it('returns null for a hex-shaped string of the wrong length (4 digits)', () => {
    expect(normalizeHex({ value: '#1234' })).toBeNull();
  });

  it('expands a 3-digit shorthand to 6 digits', () => {
    expect(normalizeHex({ value: '#abc' })).toBe('#aabbcc');
  });

  it('lowercases an uppercase 3-digit shorthand while expanding it', () => {
    expect(normalizeHex({ value: '#ABC' })).toBe('#aabbcc');
  });

  it('passes a 6-digit hex through unchanged (lowercased)', () => {
    expect(normalizeHex({ value: '#AABBCC' })).toBe('#aabbcc');
    expect(normalizeHex({ value: '#123456' })).toBe('#123456');
  });

  it('drops the alpha channel from an 8-digit hex', () => {
    expect(normalizeHex({ value: '#aabbccdd' })).toBe('#aabbcc');
  });

  it('extracts a hex color embedded in a longer string', () => {
    expect(normalizeHex({ value: 'color: #ff0000; /* red */' })).toBe('#ff0000');
  });
});

describe('hexToRgb', () => {
  it('decodes a valid hex color', () => {
    expect(hexToRgb({ hex: '#ff8000' })).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('decodes via shorthand expansion', () => {
    expect(hexToRgb({ hex: '#0f0' })).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('returns null for an invalid color', () => {
    expect(hexToRgb({ hex: 'nope' })).toBeNull();
  });
});

describe('luminance', () => {
  it('is 1 for white', () => {
    expect(luminance({ hex: '#ffffff' })).toBeCloseTo(1, 10);
  });

  it('is 0 for black', () => {
    expect(luminance({ hex: '#000000' })).toBe(0);
  });

  it('is 1 (treated as light) for an undecodable color', () => {
    expect(luminance({ hex: 'not-a-color' })).toBe(1);
  });

  it('weights green highest and blue lowest (BT.709 luma)', () => {
    expect(luminance({ hex: '#00ff00' })).toBeCloseTo(0.7152, 4);
    expect(luminance({ hex: '#ff0000' })).toBeCloseTo(0.2126, 4);
    expect(luminance({ hex: '#0000ff' })).toBeCloseTo(0.0722, 4);
  });
});

describe('toHexByte', () => {
  it('formats a mid-range value as a padded 2-digit hex byte', () => {
    expect(toHexByte({ value: 128 })).toBe('80');
  });

  it('pads single-hex-digit values with a leading zero', () => {
    expect(toHexByte({ value: 5 })).toBe('05');
  });

  it('clamps negative values to 0', () => {
    expect(toHexByte({ value: -50 })).toBe('00');
  });

  it('clamps values above 255 to 255', () => {
    expect(toHexByte({ value: 999 })).toBe('ff');
  });
});

describe('mixHex', () => {
  it('returns the first color at weight 1', () => {
    expect(mixHex({ hex: '#ff0000', other: '#0000ff', weight: 1 })).toBe('#ff0000');
  });

  it('returns the second color at weight 0', () => {
    expect(mixHex({ hex: '#ff0000', other: '#0000ff', weight: 0 })).toBe('#0000ff');
  });

  it('returns the midpoint at weight 0.5', () => {
    expect(mixHex({ hex: '#000000', other: '#ffffff', weight: 0.5 })).toBe('#808080');
  });

  it('clamps a weight above 1 to 1', () => {
    expect(mixHex({ hex: '#ff0000', other: '#0000ff', weight: 5 })).toBe('#ff0000');
  });

  it('clamps a negative weight to 0', () => {
    expect(mixHex({ hex: '#ff0000', other: '#0000ff', weight: -5 })).toBe('#0000ff');
  });

  it('falls back to black when the first color fails to decode', () => {
    expect(mixHex({ hex: 'nope', other: '#ffffff', weight: 1 })).toBe('#000000');
  });

  it('falls back to white when the second color fails to decode', () => {
    expect(mixHex({ hex: '#000000', other: 'nope', weight: 0 })).toBe('#ffffff');
  });
});

describe('readableTextColor', () => {
  it('picks near-black text on a light background', () => {
    expect(readableTextColor({ hex: '#ffffff' })).toBe('#111111');
  });

  it('picks white text on a dark background', () => {
    expect(readableTextColor({ hex: '#000000' })).toBe('#ffffff');
  });

  it('picks near-black just above the 0.56 luminance threshold', () => {
    // 143/255 = 0.5608 (> 0.56)
    expect(readableTextColor({ hex: '#8f8f8f' })).toBe('#111111');
  });

  it('picks white just at/below the 0.56 luminance threshold', () => {
    // 142/255 = 0.5569 (<= 0.56)
    expect(readableTextColor({ hex: '#8e8e8e' })).toBe('#ffffff');
  });
});
