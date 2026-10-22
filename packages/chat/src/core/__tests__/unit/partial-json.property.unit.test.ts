import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parsePartialJson } from '../../partial-json.js';

const seed = Number(process.env.FC_SEED ?? 20261020);
const options = { seed, numRuns: 150 };
const scalar = fc.oneof(fc.string({ maxLength: 40 }), fc.integer({ min: -99999, max: 99999 }), fc.boolean(), fc.constant(null));
const leaf = fc.oneof(scalar, fc.array(scalar, { maxLength: 6 }), fc.dictionary(fc.string({ maxLength: 8 }), scalar, { maxKeys: 4 }));
const json = fc.oneof(leaf, fc.array(leaf, { maxLength: 4 }), fc.dictionary(fc.string({ maxLength: 8 }), leaf, { maxKeys: 4 }));

beforeAll(() => console.info(`[fast-check chat/partial-json] seed=${seed}, numRuns=${options.numRuns}`));

// A streamed value may end inside a string or integer, or omit trailing members/items.
// Integers are bounded to avoid exponent notation: a prefix of 1e-7 can be 1e-1,
// whose numeric value is NOT a decimal prefix of the final value.
function isValuePrefix(partial: unknown, complete: unknown): boolean {
  if (typeof partial === 'string') return typeof complete === 'string' && complete.startsWith(partial);
  if (typeof partial === 'number') return typeof complete === 'number' && String(complete).startsWith(String(partial));
  if (partial === null || typeof partial !== 'object') return Object.is(partial, complete);
  if (Array.isArray(partial)) return Array.isArray(complete) && partial.length <= complete.length
    && partial.every((value, index) => isValuePrefix(value, complete[index]));
  return complete !== null && typeof complete === 'object' && !Array.isArray(complete)
    && Object.entries(partial).every(([key, value]) => Object.hasOwn(complete, key)
      && isValuePrefix(value, (complete as Record<string, unknown>)[key]));
}

describe('streamed JSON properties', () => {
  it('never throws for arbitrary text, including unpaired UTF-16 surrogates', () => {
    const utf16 = fc.array(fc.integer({ min: 0, max: 65535 }), { maxLength: 2048 }).map(units => String.fromCharCode(...units));
    fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 2048 }), utf16), buf => {
      expect(() => parsePartialJson({ buf })).not.toThrow();
    }), options);
  });

  it('round-trips complete generated JSON exactly', () => {
    fc.assert(fc.property(json, value => {
      expect(parsePartialJson({ buf: JSON.stringify(value) })).toEqual(value);
    }), options);
  });

  it('every recoverable prefix contains only prefix-consistent values', () => {
    fc.assert(fc.property(json, value => {
      const text = JSON.stringify(value);
      for (let cut = 0; cut <= text.length; cut++) {
        const parsed = parsePartialJson({ buf: text.slice(0, cut) });
        // null is the documented fallback for an unrecoverable prefix, not an exception.
        if (parsed !== null) expect(isValuePrefix(parsed, value), `cut=${cut}, text=${text}`).toBe(true);
      }
      expect(parsePartialJson({ buf: text })).toEqual(value);
    }), options);
  });

  it('preserves completed members while the next key or value is incomplete', () => {
    fc.assert(fc.property(json, value => {
      const complete = `{"complete":${JSON.stringify(value)}`;
      for (const tail of [',', ',"pending', ',"pending":', ',"pending":tru', ',"pending":1e+']) {
        expect(parsePartialJson({ buf: complete + tail })).toEqual({ complete: value });
      }
    }), options);
  });
});
