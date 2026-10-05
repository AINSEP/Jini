import { describe, expect, it } from 'vitest';
import { optionalOneOf, readToolLimit, ToolInputError } from '../index.js';

/**
 * @file The two list-input readers (`readToolLimit`, `optionalOneOf`). Before them, every list tool
 * read `limit`/`status` with a bare `typeof` check: a `limit` of 0 or -5 reached the query (an empty
 * or nonsensical page), a fractional one reached SQL, and an off-enum `status` silently matched
 * nothing — the model saw "no rows" instead of "your input was wrong".
 */
describe('readToolLimit', () => {
  const bounds = { max: 100, fallback: 25 };

  it('returns the fallback when the key is absent', () => {
    expect(readToolLimit({ input: {}, ...bounds })).toBe(25);
  });

  it('returns an in-range integer unchanged, including both ends', () => {
    expect(readToolLimit({ input: { limit: 1 }, ...bounds })).toBe(1);
    expect(readToolLimit({ input: { limit: 40 }, ...bounds })).toBe(40);
    expect(readToolLimit({ input: { limit: 100 }, ...bounds })).toBe(100);
  });

  it('caps a request above max at max', () => {
    expect(readToolLimit({ input: { limit: 300 }, ...bounds })).toBe(100);
  });

  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, true]) {
    it(`rejects ${String(bad)} with the model-facing range message`, () => {
      expect(() => readToolLimit({ input: { limit: bad }, ...bounds })).toThrow(
        new ToolInputError({ message: "'limit' must be an integer between 1 and 100" }),
      );
    });
  }

  it('names a non-default key in the message', () => {
    expect(() => readToolLimit({ input: { pageSize: 0 }, ...bounds }, { key: 'pageSize' })).toThrow(
      "'pageSize' must be an integer between 1 and 100",
    );
    expect(readToolLimit({ input: { pageSize: 7 }, ...bounds }, { key: 'pageSize' })).toBe(7);
  });

  it('throws ToolInputError specifically, so the transport answers 400 rather than a redacted 500', () => {
    expect(() => readToolLimit({ input: { limit: 0 }, ...bounds })).toThrow(ToolInputError);
  });
});

describe('optionalOneOf', () => {
  const values = ['pending', 'approved', 'spam'] as const;

  it('returns undefined when the key is absent', () => {
    expect(optionalOneOf({ input: {}, key: 'status', values })).toBeUndefined();
  });

  it('returns a listed value', () => {
    expect(optionalOneOf({ input: { status: 'spam' }, key: 'status', values })).toBe('spam');
  });

  for (const bad of ['bogus', 'Pending', '', 3]) {
    it(`rejects ${JSON.stringify(bad)} naming every allowed value`, () => {
      expect(() => optionalOneOf({ input: { status: bad }, key: 'status', values })).toThrow(
        new ToolInputError({ message: "'status' must be one of: pending, approved, spam" }),
      );
    });
  }
});
