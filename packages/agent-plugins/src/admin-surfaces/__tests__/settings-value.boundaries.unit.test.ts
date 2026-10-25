/**
 * @file `storedStateValue` admits only plain JSON, at its exact limits: every scalar kind, NaN and
 * ±Infinity refused, ONE bad item among good ones in an array or object refused, nesting depth 16
 * (17 nested containers) refused vs 16 admitted, 16 KiB of JSON admitted vs one byte more refused, and the published limits.
 * Closes Stryker run-2 survivors at settings-value.ts:11, 15, 22, 24.
 */
import { describe, expect, test } from 'vitest';
import { openCapabilityGate } from '../../lifecycle/tools/capabilities.js';
import { ADMIN_SURFACE_STATE_LIMITS, storedStateValue } from '../settings-value.js';

const gate = openCapabilityGate({ isLive: () => true, issued: new Set() });
const store = (value: unknown) => storedStateValue({ gate, value });
const PLAIN = 'A settings value must be plain JSON data (no undefined, functions, NaN or class instances).';

describe('storedStateValue', () => {
  test('publishes its limits', () => {
    expect(ADMIN_SURFACE_STATE_LIMITS).toEqual({ maxKeyLength: 128, maxValueBytes: 16 * 1024, maxDepth: 16 });
  });

  test.each([[null], ['s'], [''], [true], [false], [0], [-1.5]])('scalar %j is stored as is', (value) => {
    expect(store(value)).toEqual(value);
  });

  test.each([[Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], [undefined], [() => 1], [1n], [new Date(0)], [new Map()]])('%s is refused', (value) => {
    expect(() => store(value)).toThrow(PLAIN);
  });

  test('one bad item anywhere in an array or object refuses the whole value', () => {
    for (const bad of [Number.NaN, undefined]) {
      expect(() => store([1, bad, 2])).toThrow(PLAIN);
      expect(() => store([bad, 1, 2])).toThrow(PLAIN);
      expect(() => store({ a: 1, b: bad, c: 2 })).toThrow(PLAIN);
    }
    expect(store([1, 'two', null, { x: [true] }])).toEqual([1, 'two', null, { x: [true] }]);
  });

  test('a null-prototype object is plain; 16 nested containers are admitted and 17 refused', () => {
    expect(store(Object.assign(Object.create(null) as object, { a: 1 }))).toEqual({ a: 1 });
    const nest = (levels: number, wrap: (v: unknown) => unknown) => { let v: unknown = 1; for (let i = 0; i < levels; i++) v = wrap(v); return v; };
    for (const wrap of [(v: unknown) => [v], (v: unknown) => ({ k: v })]) {
      expect(store(nest(16, wrap))).toEqual(nest(16, wrap));
      expect(() => store(nest(17, wrap))).toThrow(PLAIN);
    }
  });

  test('exactly 16 KiB of JSON is admitted; one byte more is refused', () => {
    const atLimit = 'x'.repeat(16 * 1024 - 2); // the two quotes make 16384 bytes of JSON
    expect(store(atLimit)).toBe(atLimit);
    expect(() => store(`${atLimit}x`)).toThrow('A settings value may be at most 16384 bytes of JSON.');
  });
});
