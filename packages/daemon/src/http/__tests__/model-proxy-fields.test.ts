import { describe, expect, it } from 'vitest';
import {
  firstOptionalFieldError,
  isArray,
  isNumber,
  isRecord,
  isString,
  nonEmptyString,
  pickDefined,
  requiredFieldError,
  type OptionalFieldCheck,
} from '../model-proxy-fields.js';

describe('model-proxy-fields — primitive tests', () => {
  it('isRecord accepts plain objects only', () => {
    expect([{}, { a: 1 }].map(isRecord)).toEqual([true, true]);
    expect([null, [], 'x', 1, undefined].map(isRecord)).toEqual([false, false, false, false, false]);
  });

  it('nonEmptyString returns the original (untrimmed) string, or null for blank/non-strings', () => {
    expect(nonEmptyString(' k ')).toBe(' k ');
    expect([' ', '', 5, null].map(nonEmptyString)).toEqual([null, null, null, null]);
  });

  it('isString/isNumber/isArray are plain typeof/Array.isArray tests (NaN counts as a number)', () => {
    expect([isString('s'), isString(1)]).toEqual([true, false]);
    expect([isNumber(Number.NaN), isNumber('1')]).toEqual([true, false]);
    expect([isArray([]), isArray({})]).toEqual([true, false]);
  });
});

describe('model-proxy-fields — firstOptionalFieldError', () => {
  const checks: OptionalFieldCheck[] = [
    ['a', isString, 'a must be a string when provided'],
    ['b', isNumber, 'b must be a number when provided'],
  ];

  it('returns undefined when every present field is well-typed and absent ones are skipped', () => {
    expect(firstOptionalFieldError({ a: 'x' }, checks)).toBeUndefined();
  });

  it('treats an explicitly-undefined field as absent', () => {
    expect(firstOptionalFieldError({ a: undefined, b: undefined }, checks)).toBeUndefined();
  });

  it('treats null as present, so it fails the type test', () => {
    expect(firstOptionalFieldError({ b: null }, checks)).toEqual({ code: 'BAD_REQUEST', message: 'b must be a number when provided' });
  });

  it('reports only the first failing field in check order', () => {
    expect(firstOptionalFieldError({ b: 'no', a: 1 }, checks)).toEqual({ code: 'BAD_REQUEST', message: 'a must be a string when provided' });
  });
});

describe('model-proxy-fields — requiredFieldError', () => {
  it('carries a single validation issue naming the field', () => {
    expect(requiredFieldError('apiKey', 'apiKey must be a non-empty string', 'required non-empty string')).toEqual({
      code: 'BAD_REQUEST',
      message: 'apiKey must be a non-empty string',
      details: { kind: 'validation', issues: [{ path: 'apiKey', message: 'required non-empty string' }] },
    });
  });
});

describe('model-proxy-fields — pickDefined', () => {
  it('omits keys whose value is undefined, including explicitly-undefined ones', () => {
    const picked = pickDefined({ a: 1, b: undefined as number | undefined }, ['a', 'b']);
    expect(picked).toEqual({ a: 1 });
    expect(Object.keys(picked)).toEqual(['a']);
  });

  it('keeps falsy-but-defined values (0, empty string, null, false)', () => {
    expect(pickDefined({ z: 0, e: '', n: null, f: false }, ['z', 'e', 'n', 'f'])).toEqual({ z: 0, e: '', n: null, f: false });
  });

  it('copies only the listed keys, in list order', () => {
    const picked = pickDefined({ a: 1, b: 2, c: 3 }, ['c', 'a']);
    expect(Object.keys(picked)).toEqual(['c', 'a']);
  });
});
