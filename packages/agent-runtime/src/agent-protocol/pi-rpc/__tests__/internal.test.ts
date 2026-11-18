import { describe, expect, it } from 'vitest';
import { isRecord, errorMessage, errorCode, getRecord } from '../internal.js';

describe('isRecord', () => {
  it('returns true for plain objects and arrays', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
  });
  it('returns false for null and primitives', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage({ err: new Error('boom') })).toBe('boom');
  });
  it('stringifies non-Error values', () => {
    expect(errorMessage({ err: 'plain' })).toBe('plain');
    expect(errorMessage({ err: 7 })).toBe('7');
  });
});

describe('errorCode', () => {
  it('extracts a string code field', () => {
    expect(errorCode({ err: { code: 'EPIPE' } })).toBe('EPIPE');
  });
  it('returns undefined when code is missing, not a string, or value is not a record', () => {
    expect(errorCode({ err: {} })).toBeUndefined();
    expect(errorCode({ err: { code: 42 } })).toBeUndefined();
    expect(errorCode({ err: 'not a record' })).toBeUndefined();
    expect(errorCode({ err: null })).toBeUndefined();
  });
});

describe('getRecord', () => {
  it('returns the value when it is a record', () => {
    const v = { a: 1 };
    expect(getRecord({ value: v })).toBe(v);
  });
  it('returns undefined otherwise', () => {
    expect(getRecord({ value: null })).toBeUndefined();
    expect(getRecord({ value: 'x' })).toBeUndefined();
  });
});
