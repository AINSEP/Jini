import { describe, expect, it } from 'vitest';
import { isRenderableColor } from '../question-form.js';

/**
 * `isRenderableColor` is the CSS-injection guard on direction-card palettes. The sibling
 * `question-form.test.ts` proves the url()/var()/image-set() rejections through a parsed form; this
 * file pins the input-length bound and the trim rule, which no other test reaches.
 */
describe('isRenderableColor length bound and trimming', () => {
  it('accepts a 64-character colour and rejects the same colour shape at 65 characters', () => {
    const at64 = `rgb(${' '.repeat(59)})`;
    const at65 = `rgb(${' '.repeat(60)})`;
    expect(at64).toHaveLength(64);
    expect(at65).toHaveLength(65);
    expect(isRenderableColor({ value: at64 })).toBe(true);
    expect(isRenderableColor({ value: at65 })).toBe(false);
    expect(isRenderableColor({ value: 'a'.repeat(64) })).toBe(true);
    expect(isRenderableColor({ value: 'a'.repeat(65) })).toBe(false);
  });

  it('measures the bound after trimming, so surrounding whitespace never counts against it', () => {
    expect(isRenderableColor({ value: `  ${'a'.repeat(64)}  ` })).toBe(true);
    expect(isRenderableColor({ value: '  #abc\n' })).toBe(true);
  });

  it('rejects an empty or whitespace-only value', () => {
    expect(isRenderableColor({ value: '' })).toBe(false);
    expect(isRenderableColor({ value: ' \t\n ' })).toBe(false);
  });

  it('accepts every hex length the guard documents and rejects the lengths in between', () => {
    for (const ok of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) expect(isRenderableColor({ value: ok })).toBe(true);
    for (const bad of ['#ab', '#abcde', '#abcdefg', '#aabbccddee', '#ggg']) expect(isRenderableColor({ value: bad })).toBe(false);
  });
});
