import { describe, expect, it } from 'vitest';
import { trimTrailingWhere } from '../trim-chars.js';

/**
 * @file `trimTrailingWhere`: the predicate form of `trimTrailingChars`, for a class a plain character
 * list cannot spell (the markdown href sanitizer passes `/[!"')}\],.;:\s]/`).
 */
describe('trimTrailingWhere', () => {
  const isHrefTail = (char: string) => /[!"')}\],.;:\s]/.test(char);

  it('removes the whole trailing run the predicate accepts and keeps the same characters elsewhere', () => {
    expect(trimTrailingWhere({ value: 'https://x.test/a.b?c=1). \t', isTrimmed: isHrefTail })).toBe('https://x.test/a.b?c=1');
  });

  it('returns the value unchanged when its last character is kept, and empty when every character is trimmed', () => {
    expect(trimTrailingWhere({ value: '.a.', isTrimmed: (char) => char === 'x' })).toBe('.a.');
    expect(trimTrailingWhere({ value: '),. ', isTrimmed: isHrefTail })).toBe('');
    expect(trimTrailingWhere({ value: '', isTrimmed: isHrefTail })).toBe('');
  });

  it('matches the anchored-regex form it replaces over a spread of inputs', () => {
    const inputs = ['a', 'a!', 'a!!', '!a!', ' ', ' a ', 'a)]}', '(a)', 'a\n', 'a.b.', '..', 'x;:,'];
    for (const value of inputs) {
      expect(trimTrailingWhere({ value, isTrimmed: isHrefTail })).toBe(value.replace(/[!"')}\],.;:\s]+$/, ''));
    }
  });
});
