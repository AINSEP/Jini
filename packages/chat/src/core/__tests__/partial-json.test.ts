import { describe, expect, it } from 'vitest';
import { parsePartialJson, repairJsonPrefix } from '../partial-json.js';

describe('partial-json: repairJsonPrefix', () => {
  it('round-trips already-complete JSON unchanged', () => {
    expect(repairJsonPrefix({ buf: '{"a":1}' })).toBe('{"a":1}');
  });

  it('closes a string cut off mid-value, handling a dangling escape and a partial \\u escape', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":"hello' }))).toEqual({ a: 'hello' });
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":"line\\\\' }))).toEqual({ a: 'line\\' });
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":"emoji\\u00' }))).toEqual({ a: 'emoji' });
  });

  it('tracks escaped characters inside a string so an escaped quote does not prematurely close it', () => {
    // The `\"` here is an escaped quote *inside* the string value, not its terminator — if the
    // escape tracking were wrong, the string would appear closed and "more text" would be parsed
    // as trailing structural garbage instead of being folded back into the string.
    const result = JSON.parse(repairJsonPrefix({ buf: '{"a":"has \\"a quote\\" and more text' }));
    expect(result).toEqual({ a: 'has "a quote" and more text' });
  });

  it('trims a dangling comma, a key with no value yet, and a partial boolean/null literal', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":1,' }))).toEqual({ a: 1 });
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":1,"b":' }))).toEqual({ a: 1 });
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":tru' }))).toEqual({});
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":fal' }))).toEqual({});
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":nu' }))).toEqual({});
  });

  it('trims a number cut mid-token: dangling exponent, trailing decimal point, or lone minus', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":1.5e' }))).toEqual({});
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":1.' }))).toEqual({});
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":-' }))).toEqual({});
  });

  it('preserves a complete literal that happens to be a prefix of another token (true/12/1.5/1e3 are not trimmed)', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":true,"b":12,"c":1.5,"d":1e3}' }))).toEqual({ a: true, b: 12, c: 1.5, d: 1000 });
  });

  it('drops a bare trailing key (string with no colon yet) only when it is a pending object key', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":1,"hea' }))).toEqual({ a: 1 });
    // A string that IS a completed value (not a pending key) must survive.
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":"complete value"' }))).toEqual({ a: 'complete value' });
  });

  it('closes every still-open container, innermost first', () => {
    expect(JSON.parse(repairJsonPrefix({ buf: '{"a":[1,2,{"b":3' }))).toEqual({ a: [1, 2, { b: 3 }] });
  });

  it('round-trips a buffer with no open containers or strings unchanged (nothing to close)', () => {
    expect(repairJsonPrefix({ buf: '' })).toBe('');
    expect(repairJsonPrefix({ buf: '42' })).toBe('42');
  });
});

describe('partial-json: parsePartialJson', () => {
  it('repairs a 60k-digit prefix within the time budget', () => {
    const buf = '{"n":' + '1'.repeat(60_000);
    const start = performance.now();
    const result = parsePartialJson({ buf });
    const elapsed = performance.now() - start;
    expect(result).toEqual({ n: Infinity });
    expect(elapsed).toBeLessThan(1000);
  });

  // Each of these took 9-60s before linear separator trimming and the pass bound.
  it.each([
    ['a whitespace run', '[' + ' '.repeat(60_000) + 'x', null],
    ['a non-JSON value chain', '[' + 't,'.repeat(30_000), null],
  ])('settles %s within the time budget', (_name, buf, expected) => {
    const start = performance.now();
    expect(parsePartialJson({ buf })).toEqual(expected);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('accepts the structured-input limit and rejects larger buffers before repair', () => {
    const atLimit = JSON.stringify('x'.repeat(64 * 1024 - 2));
    expect(parsePartialJson({ buf: atLimit })).toBe('x'.repeat(64 * 1024 - 2));
    const oversized = atLimit + ' ';
    expect(parsePartialJson({ buf: oversized })).toBeNull();
    expect(repairJsonPrefix({ buf: oversized })).toBe('');
  });

  it.each(['12e', '12.5e+', '.5e-', '-12.e'])('still removes an incomplete exponent %s', number => {
    expect(parsePartialJson({ buf: `{"n":${number}` })).toEqual({});
  });

  it('parses a repaired truncated object', () => {
    expect(parsePartialJson({ buf: '{"a":1,"b":"hel' })).toEqual({ a: 1, b: 'hel' });
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parsePartialJson({ buf: '' })).toBeNull();
    expect(parsePartialJson({ buf: '   \n  ' })).toBeNull();
  });

  it('returns null (rather than throwing) when the repaired text is still not valid JSON', () => {
    // A lone closing bracket has no matching opener to repair against, so the repair pass leaves
    // it untouched and JSON.parse rejects it — this exercises the catch path, not just an early return.
    expect(parsePartialJson({ buf: ']' })).toBeNull();
  });
});
