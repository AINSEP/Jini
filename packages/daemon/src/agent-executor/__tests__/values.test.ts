/** Direct tests for the agent-executor's untyped-value readers (used on raw ACP/MCP payloads). */
import { describe, expect, it } from 'vitest';
import { asOptionalString, asString, errorMessage, isRecord } from '../values.js';

describe('agent-executor values', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    for (const value of [null, undefined, [], [1], 'x', 1, true]) expect(isRecord(value)).toBe(false);
  });

  it('asString keeps strings (including empty) and substitutes the fallback otherwise', () => {
    expect(asString('hi')).toBe('hi');
    expect(asString('', 'fb')).toBe('');
    expect(asString(5)).toBe('');
    expect(asString(null, 'fb')).toBe('fb');
  });

  it('asOptionalString keeps strings and drops everything else to undefined', () => {
    expect(asOptionalString('')).toBe('');
    expect(asOptionalString('x')).toBe('x');
    expect(asOptionalString(0)).toBeUndefined();
    expect(asOptionalString(undefined)).toBeUndefined();
  });

  it('errorMessage reads an Error message and stringifies anything else', () => {
    expect(errorMessage(new TypeError('bad type'))).toBe('bad type');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage({ message: 'not an Error' })).toBe('[object Object]');
  });
});
