import { describe, expect, it } from 'vitest';
import { safeDnsLabel, safeProjectLabel } from '../naming.js';

describe('safeProjectLabel', () => {
  it('lowercases, hyphenates non-alphanumeric runs, and strips leading/trailing hyphens', () => {
    expect(safeProjectLabel({ raw: 'My Cool Site!!', maxLength: 80 })).toBe('my-cool-site');
  });

  it('collapses consecutive separators into a single hyphen', () => {
    expect(safeProjectLabel({ raw: 'a___b   c', maxLength: 80 })).toBe('a-b-c');
  });

  it('truncates to maxLength and re-trims a trailing hyphen exposed by truncation', () => {
    expect(safeProjectLabel({ raw: 'abcdefgh', maxLength: 5 })).toBe('abcde');
    expect(safeProjectLabel({ raw: 'abc-defgh', maxLength: 4 })).toBe('abc');
  });

  it('decomposes accented characters via NFKD, turning the isolated combining marks into hyphens', () => {
    // NFKD splits 'é'/'à' into a base letter + a combining diacritical mark;
    // the mark itself isn't [a-z0-9-] so it becomes its own hyphen, same as
    // any other stripped character — this only strips ASCII-incompatible
    // bytes, it does not attempt accent-folding to the bare letter.
    expect(safeProjectLabel({ raw: 'café déjà-vu', maxLength: 80 })).toBe('cafe-de-ja-vu');
  });

  it('returns an empty string for input that sanitizes to nothing', () => {
    expect(safeProjectLabel({ raw: '###', maxLength: 80 })).toBe('');
    expect(safeProjectLabel({ raw: '', maxLength: 80 })).toBe('');
  });
});

describe('safeDnsLabel', () => {
  it('caps at the 63-char DNS label limit', () => {
    const raw = 'x'.repeat(100);
    expect(safeDnsLabel({ raw })).toHaveLength(63);
  });
});
