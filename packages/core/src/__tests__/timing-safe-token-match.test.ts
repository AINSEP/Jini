import { timingSafeEqual as nativeEqual } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { timingSafeTokenMatch, type TimingSafeByteComparison } from '../token.js';

const timingSafeEqual: TimingSafeByteComparison = ({ left, right }) => nativeEqual(left, right);

const vectors: Array<[string, string, boolean]> = [
    ['secret', 'secret', true], ['secreT', 'secret', false], ['short', 'longer-secret', false],
    ['', 'secret', false], ['secret', '', false], ['', '', true], ['café', 'café', true],
    ['café', 'cafe', false], ['ab', 'é', false], ['😀', '😀', true], ['\uD800', '\uFFFD', true],
];

describe('timingSafeTokenMatch', () => {
  it.each(vectors)('preserves both old native UTF-8 comparators for %j and %j', (presented, expected, match) => {
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const oldHttpResult = a.length === b.length ? nativeEqual(a, b) : false;
    const oldDaemonResult = a.length === b.length && nativeEqual(a, b);
    expect(oldHttpResult).toBe(match);
    expect(oldDaemonResult).toBe(match);
    expect(timingSafeTokenMatch({ presented, expected, timingSafeEqual })).toBe(match);
  });

  it('never calls a native comparator with unequal UTF-8 byte lengths', () => {
    const compare = vi.fn(timingSafeEqual);
    expect(timingSafeTokenMatch({ presented: 'é', expected: 'e', timingSafeEqual: compare })).toBe(false);
    expect(compare).not.toHaveBeenCalled();
    expect(timingSafeTokenMatch({ presented: 'é', expected: 'ab', timingSafeEqual: compare })).toBe(false);
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith({ left: new Uint8Array([195, 169]), right: new Uint8Array([97, 98]) });
  });
});
