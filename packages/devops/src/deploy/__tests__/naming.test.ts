import { describe, expect, it } from 'vitest';
import { safeDnsLabel, safeProjectLabel } from '../naming.js';

describe('safeProjectLabel', () => {
  it('lowercases, hyphenates non-alphanumeric runs, and strips leading/trailing hyphens', () => {
    expect(safeProjectLabel('My Cool Site!!', 80)).toBe('my-cool-site');
  });

  it('collapses consecutive separators into a single hyphen', () => {
    expect(safeProjectLabel('a___b   c', 80)).toBe('a-b-c');
  });

  it('truncates to maxLength and re-trims a trailing hyphen exposed by truncation', () => {
    expect(safeProjectLabel('abcdefgh', 5)).toBe('abcde');
    expect(safeProjectLabel('abc-defgh', 4)).toBe('abc');
  });

  it('decomposes accented characters via NFKD, turning the isolated combining marks into hyphens', () => {
    // NFKD splits 'é'/'à' into a base letter + a combining diacritical mark;
    // the mark itself isn't [a-z0-9-] so it becomes its own hyphen, same as
    // any other stripped character — this only strips ASCII-incompatible
    // bytes, it does not attempt accent-folding to the bare letter.
    expect(safeProjectLabel('café déjà-vu', 80)).toBe('cafe-de-ja-vu');
  });

  it('returns an empty string for input that sanitizes to nothing', () => {
    expect(safeProjectLabel('###', 80)).toBe('');
    expect(safeProjectLabel('', 80)).toBe('');
  });
});

describe('safeDnsLabel', () => {
  it('caps at the 63-char DNS label limit', () => {
    const raw = 'x'.repeat(100);
    expect(safeDnsLabel(raw)).toHaveLength(63);
  });
});
