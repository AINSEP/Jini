import { describe, expect, it } from 'vitest';
import { parsePartialJson, repairJsonPrefix } from '../partial-json.js';

describe('partial-json: repairJsonPrefix', () => {
  it('round-trips already-complete JSON unchanged', () => {
    expect(repairJsonPrefix('{"a":1}')).toBe('{"a":1}');
  });

  it('closes a string cut off mid-value, handling a dangling escape and a partial \\u escape', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":"hello'))).toEqual({ a: 'hello' });
    expect(JSON.parse(repairJsonPrefix('{"a":"line\\\\'))).toEqual({ a: 'line\\' });
    expect(JSON.parse(repairJsonPrefix('{"a":"emoji\\u00'))).toEqual({ a: 'emoji' });
  });

  it('tracks escaped characters inside a string so an escaped quote does not prematurely close it', () => {
    // The `\"` here is an escaped quote *inside* the string value, not its terminator — if the
    // escape tracking were wrong, the string would appear closed and "more text" would be parsed
    // as trailing structural garbage instead of being folded back into the string.
    const result = JSON.parse(repairJsonPrefix('{"a":"has \\"a quote\\" and more text'));
    expect(result).toEqual({ a: 'has "a quote" and more text' });
  });

  it('trims a dangling comma, a key with no value yet, and a partial boolean/null literal', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1,'))).toEqual({ a: 1 });
    expect(JSON.parse(repairJsonPrefix('{"a":1,"b":'))).toEqual({ a: 1 });
    expect(JSON.parse(repairJsonPrefix('{"a":tru'))).toEqual({});
    expect(JSON.parse(repairJsonPrefix('{"a":fal'))).toEqual({});
    expect(JSON.parse(repairJsonPrefix('{"a":nu'))).toEqual({});
  });

  it('trims a number cut mid-token: dangling exponent, trailing decimal point, or lone minus', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1.5e'))).toEqual({});
    expect(JSON.parse(repairJsonPrefix('{"a":1.'))).toEqual({});
    expect(JSON.parse(repairJsonPrefix('{"a":-'))).toEqual({});
  });

  it('preserves a complete literal that happens to be a prefix of another token (true/12/1.5/1e3 are not trimmed)', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":true,"b":12,"c":1.5,"d":1e3}'))).toEqual({ a: true, b: 12, c: 1.5, d: 1000 });
  });

  it('drops a bare trailing key (string with no colon yet) only when it is a pending object key', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":1,"hea'))).toEqual({ a: 1 });
    // A string that IS a completed value (not a pending key) must survive.
    expect(JSON.parse(repairJsonPrefix('{"a":"complete value"'))).toEqual({ a: 'complete value' });
  });

  it('closes every still-open container, innermost first', () => {
    expect(JSON.parse(repairJsonPrefix('{"a":[1,2,{"b":3'))).toEqual({ a: [1, 2, { b: 3 }] });
  });

  it('round-trips a buffer with no open containers or strings unchanged (nothing to close)', () => {
    expect(repairJsonPrefix('')).toBe('');
    expect(repairJsonPrefix('42')).toBe('42');
  });
});

describe('partial-json: parsePartialJson', () => {
  it('parses a repaired truncated object', () => {
    expect(parsePartialJson('{"a":1,"b":"hel')).toEqual({ a: 1, b: 'hel' });
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parsePartialJson('')).toBeNull();
    expect(parsePartialJson('   \n  ')).toBeNull();
  });

  it('returns null (rather than throwing) when the repaired text is still not valid JSON', () => {
    // A lone closing bracket has no matching opener to repair against, so the repair pass leaves
    // it untouched and JSON.parse rejects it — this exercises the catch path, not just an early return.
    expect(parsePartialJson(']')).toBeNull();
  });
});
