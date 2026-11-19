/** Direct tests for the agent-executor's untyped-value readers (used on raw ACP/MCP payloads). */
import { describe, expect, it } from 'vitest';
import { asOptionalString, asString, errorMessage, isRecord } from '../values.js';

describe('agent-executor values', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({ value: {} })).toBe(true);
    expect(isRecord({ value: { a: 1 } })).toBe(true);
    for (const value of [null, undefined, [], [1], 'x', 1, true]) expect(isRecord({ value })).toBe(false);
  });

  it('asString keeps strings (including empty) and substitutes the fallback otherwise', () => {
    expect(asString({ value: 'hi' })).toBe('hi');
    expect(asString({ value: '' }, { fallback: 'fb' })).toBe('');
    expect(asString({ value: 5 })).toBe('');
    expect(asString({ value: null }, { fallback: 'fb' })).toBe('fb');
  });

  it('asOptionalString keeps strings and drops everything else to undefined', () => {
    expect(asOptionalString({ value: '' })).toBe('');
    expect(asOptionalString({ value: 'x' })).toBe('x');
    expect(asOptionalString({ value: 0 })).toBeUndefined();
    expect(asOptionalString({ value: undefined })).toBeUndefined();
  });

  it('errorMessage reads an Error message and stringifies anything else', () => {
    expect(errorMessage({ err: new TypeError('bad type') })).toBe('bad type');
    expect(errorMessage({ err: 'plain' })).toBe('plain');
    expect(errorMessage({ err: 42 })).toBe('42');
    expect(errorMessage({ err: null })).toBe('null');
    expect(errorMessage({ err: { message: 'not an Error' } })).toBe('[object Object]');
  });
});
