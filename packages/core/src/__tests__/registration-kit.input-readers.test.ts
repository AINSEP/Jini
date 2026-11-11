import { describe, expect, it } from 'vitest';
import { optionalBoolean, optionalNumber, optionalOneOf, optionalString, readToolLimit, requireInputRecord, requireNoInput, requireNumber, requireObject, requireString } from '../registration-kit.js';
import { ToolInputError } from '../tool-registry.js';

/** AP3 HOSTILE table through every tool-input reader: each wrong type yields ToolInputError with
 *  its documented message (never a TypeError), and missing-field hints name keys, never values. */
const HOSTILE: unknown[] = [null, [], {}, 0, Number.NaN, Number.POSITIVE_INFINITY, '', '  ', true];
const err = (fn: () => unknown) => { try { fn(); } catch (e) { return e; } return undefined; };

describe('requireInputRecord / requireNoInput', () => {
  it.each([null, 'x', 1, undefined])('requireInputRecord refuses %j', (input) => {
    const e = err(() => requireInputRecord({ input }));
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toBe('input must be an object');
  });
  it('requireNoInput accepts undefined and {} only', () => {
    expect(() => requireNoInput({ input: undefined })).not.toThrow();
    expect(() => requireNoInput({ input: {} })).not.toThrow();
    for (const input of [{ a: 1 }, null, 'x']) expect(() => requireNoInput({ input })).toThrow("this tool accepts no input — omit 'input' or pass {}");
  });
  it('arrays are accepted as records by documented design (records.ts isRecord contract)', () => {
    expect(requireInputRecord({ input: [] })).toEqual([]);
    expect(() => requireNoInput({ input: [] })).not.toThrow();
  });
});

describe('required readers', () => {
  it('requireString: empty refused unless allowEmpty; hint names keys and items[] batching, never values', () => {
    expect(requireString({ input: { k: 'v' }, key: 'k' })).toBe('v');
    expect(requireString({ input: { k: '' }, key: 'k' }, { allowEmpty: true })).toBe('');
    expect(() => requireString({ input: { k: '' }, key: 'k' })).toThrow("'k' (non-empty string) is required");
    expect(() => requireString({ input: { other: 'SECRET', items: [] }, key: 'k' })).toThrow("'k' (non-empty string) is required; received: other, items; this tool takes one input per call — items[] batching is not supported here");
    expect(() => requireString({ input: { k: 5 }, key: 'k' }, { allowEmpty: true })).toThrow(/^'k' \(string\) is required$/);
    expect(err(() => requireString({ input: { x: 'SECRET' }, key: 'k' }))).not.toMatchObject({ message: expect.stringContaining('SECRET') });
  });
  it.each(HOSTILE.filter(v => typeof v !== 'number' || !Number.isFinite(v)))('requireNumber refuses %j', (value) => {
    expect(() => requireNumber({ input: { n: value }, key: 'n' })).toThrow(/^'n' \(number\) is required$/);
  });
  it.each([null, [], 'x', 1, true])('requireObject refuses %j', (value) => {
    expect(() => requireObject({ input: { o: value }, key: 'o' })).toThrow(/^'o' \(object\) is required$/);
  });
  it('requireNumber/requireObject accept good values', () => {
    expect(requireNumber({ input: { n: 0 }, key: 'n' })).toBe(0);
    expect(requireObject({ input: { o: { a: 1 } }, key: 'o' })).toEqual({ a: 1 });
  });
});

describe('optional readers', () => {
  it.each(HOSTILE.filter(v => typeof v !== 'string'))('optionalString refuses %j', (value) => {
    expect(() => optionalString({ input: { s: value }, key: 's' })).toThrow("'s' must be a string");
  });
  it.each(HOSTILE.filter(v => typeof v !== 'number' || !Number.isFinite(v)))('optionalNumber refuses %j', (value) => {
    expect(() => optionalNumber({ input: { n: value }, key: 'n' })).toThrow("'n' must be a number");
  });
  it.each(HOSTILE.filter(v => typeof v !== 'boolean'))('optionalBoolean refuses %j', (value) => {
    expect(() => optionalBoolean({ input: { b: value }, key: 'b' })).toThrow("'b' must be a boolean");
  });
  it('absent optional values are undefined; present good values pass through', () => {
    expect(optionalString({ input: {}, key: 's' })).toBeUndefined();
    expect(optionalNumber({ input: { n: -1.5 }, key: 'n' })).toBe(-1.5);
    expect(optionalBoolean({ input: { b: false }, key: 'b' })).toBe(false);
  });
  it('optionalOneOf accepts members only (case-sensitive)', () => {
    expect(optionalOneOf({ input: { m: 'a' }, key: 'm', values: ['a', 'b'] })).toBe('a');
    for (const m of ['A', 'c', 1, null]) expect(() => optionalOneOf({ input: { m }, key: 'm', values: ['a', 'b'] })).toThrow("'m' must be one of: a, b");
  });
});

describe('readToolLimit', () => {
  it('falls back when absent, clamps to max, and refuses 0, negatives, fractions and non-numbers', () => {
    expect(readToolLimit({ input: {}, max: 50, fallback: 10 })).toBe(10);
    expect(readToolLimit({ input: { limit: 1 }, max: 50, fallback: 10 })).toBe(1);
    expect(readToolLimit({ input: { limit: 50 }, max: 50, fallback: 10 })).toBe(50);
    expect(readToolLimit({ input: { limit: 51 }, max: 50, fallback: 10 })).toBe(50);
    expect(readToolLimit({ input: { top: 3 }, max: 50, fallback: 10 }, { key: 'top' })).toBe(3);
    for (const limit of [0, -1, 1.5, '5', null, Number.NaN]) expect(() => readToolLimit({ input: { limit }, max: 50, fallback: 10 })).toThrow("'limit' must be an integer between 1 and 50");
  });
});
