import { describe, expect, it } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { canonicalArgumentDigest, CanonicalJsonError, canonicalJson, deleteMapRecord, matchesRecordFields, upsertRecord } from './records.js';

describe('memory record operations', () => {
  it('matches all supplied fields strictly, including explicit undefined', () => {
    const record = { scope: 'one', id: 'same', value: 1 };
    expect(matchesRecordFields({ record, fields: { scope: 'one', id: 'same' } })).toBe(true);
    expect(matchesRecordFields({ record, fields: { scope: 'other', id: 'same' } })).toBe(false);
    expect(matchesRecordFields({ record, fields: {} })).toBe(true);
    const optionalRecord: { value: number | undefined } = { value: 0 };
    expect(matchesRecordFields({ record: optionalRecord, fields: { value: undefined } })).toBe(false);
  });

  it('upserts by the full identity without replacing other scopes or reordering rows', () => {
    const first = { scope: 'one', id: 'same', value: 'first' };
    const other = { scope: 'two', id: 'same', value: 'other' };
    const records = [first, other];
    const changed = { ...first, value: 'changed' };
    upsertRecord({ records, record: changed, identity: { scope: 'one', id: 'same' } });
    const added = { scope: 'one', id: 'new', value: 'added' };
    upsertRecord({ records, record: added, identity: { scope: 'one', id: 'new' } });
    expect(records).toEqual([changed, other, added]);
    expect(records[0]).toBe(changed);
    expect(records[1]).toBe(other);
  });

  it('deletes only the keyed row in the selected scope', () => {
    const records = new Map([['same', { scope: 'one' }], ['kept', { scope: 'one' }]]);
    deleteMapRecord({ records, key: 'missing', fields: { scope: 'one' } });
    deleteMapRecord({ records, key: 'same', fields: { scope: 'other' } });
    expect([...records.keys()]).toEqual(['same', 'kept']);
    deleteMapRecord({ records, key: 'same', fields: { scope: 'one' } });
    expect([...records.keys()]).toEqual(['kept']);
  });
});

describe('canonicalJson', () => {
  it('sorts keys, drops undefined members, keeps array order', () => {
    expect(canonicalJson({ value: { b: 1, a: [2, { d: null, c: undefined }], e: 'x' } })).toBe('{"a":[2,{"d":null}],"b":1,"e":"x"}');
  });

  it.each([null, true, false, 0, -0, 1.25, '', 'quote"\\\n'])('preserves JSON scalar semantics for %j', value => {
    expect(canonicalJson({ value })).toBe(JSON.stringify(value));
  });

  it('sorts numeric-looking and Unicode keys by code point at every depth', () => {
    const value = { '\u{10000}': 1, '\ue000': 2, '2': { '2': true, '10': false }, '10': 3 };
    expect(canonicalJson({ value })).toBe('{"10":3,"2":{"10":false,"2":true},"\ue000":2,"\u{10000}":1}');
  });

  it('orders key prefixes before longer keys, including the empty key', () => {
    expect(canonicalJson({ value: { aa: 3, a: 2, '': 1 } })).toBe('{"":1,"a":2,"aa":3}');
  });

  it('produces the same JSON for every permutation of object keys', () => {
    const keys = ['a', 'b', 'c'];
    for (const first of keys) {
      for (const second of keys.filter(key => key !== first)) {
        const order = [first, second, ...keys.filter(key => key !== first && key !== second)];
        const value = Object.fromEntries(order.map(key => [key, { z: 2, a: 1 }]));
        expect(canonicalJson({ value })).toBe('{"a":{"a":1,"z":2},"b":{"a":1,"z":2},"c":{"a":1,"z":2}}');
      }
    }
  });

  it('omits undefined object fields without mutating records or arrays', () => {
    const item = Object.freeze({ z: undefined, a: 1 });
    const value = Object.freeze({ z: Object.freeze([item, null]), a: item });
    expect(canonicalJson({ value })).toBe('{"a":{"a":1},"z":[{"a":1},null]}');
    expect(Object.keys(item)).toEqual(['z', 'a']);
    expect(value.z).toEqual([item, null]);
  });

  it('accepts null-prototype objects and treats prototype-like keys as data', () => {
    const value = Object.assign(Object.create(null), JSON.parse('{"constructor":1,"__proto__":2}'));
    expect(canonicalJson({ value })).toBe('{"__proto__":2,"constructor":1}');
  });

  const invalid = [undefined, () => 1, 1n, NaN, Infinity, -Infinity, Symbol('value'), new Date(0), new Map(), new Set(), new Number(1), new Uint8Array([1])];
  it.each(invalid)('rejects non-JSON values with a typed error (%#)', value => {
    expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: [value] })).toThrow(CanonicalJsonError);
  });

  it.each(invalid.filter(value => value !== undefined))('rejects non-JSON object fields (%#)', value => {
    expect(() => canonicalJson({ value: { field: value } })).toThrow(CanonicalJsonError);
  });

  it('rejects sparse arrays instead of emitting invalid JSON', () => {
    expect(() => canonicalJson({ value: new Array(2) })).toThrow(CanonicalJsonError);
  });

  it('rejects cycles through records and arrays, while allowing repeated references', () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push({ array });
    expect(() => canonicalJson({ value: object })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ value: array })).toThrow(CanonicalJsonError);
    const shared = { b: 2, a: 1 };
    expect(canonicalJson({ value: [shared, shared] })).toBe('[{"a":1,"b":2},{"a":1,"b":2}]');
  });

  it('rejects enumerable symbol keys instead of discarding non-JSON data', () => {
    expect(() => canonicalJson({ value: { [Symbol('field')]: 1 } })).toThrow(CanonicalJsonError);
  });

  it('ignores non-enumerable properties, including symbols, as JSON does', () => {
    const value = Object.defineProperties({ a: 1 }, {
      hidden: { value: () => 1 },
      [Symbol('hidden')]: { value: 1n },
    });
    expect(canonicalJson({ value })).toBe('{"a":1}');
  });

  it('reads array indexes in order without invoking custom iterators', () => {
    const value = [1, 2];
    value[Symbol.iterator] = () => [2, 1][Symbol.iterator]();
    expect(canonicalJson({ value })).toBe('[1,2]');
  });

  it('rejects toJSON functions without invoking them', () => {
    const value = { toJSON: () => { throw new Error('must not invoke toJSON'); } };
    expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError);
  });
});

describe('canonicalArgumentDigest', () => {
  it('returns the known SHA-256 hex digest of canonical UTF-8 JSON', async () => {
    expect(await canonicalArgumentDigest({ args: {} })).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    const args = { z: ['\u{1f600}', '\u00e9'], a: { y: null, x: true } };
    const bytes = '{"a":{"x":true,"y":null},"z":["\u{1f600}","\u00e9"]}';
    expect(await canonicalArgumentDigest({ args })).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('matches the host digest for reordered keys but distinguishes array and value changes', async () => {
    const first = await canonicalArgumentDigest({ args: { b: { d: 4, c: 3 }, a: [1, 2] } });
    const reordered = await canonicalArgumentDigest({ args: { a: [1, 2], b: { c: 3, d: 4 }, omitted: undefined } });
    expect(reordered).toBe(first);
    expect(first).toBe(createHash('sha256').update('{"a":[1,2],"b":{"c":3,"d":4}}').digest('hex'));
    expect(await canonicalArgumentDigest({ args: { a: [2, 1], b: { c: 3, d: 4 } } })).not.toBe(first);
    expect(await canonicalArgumentDigest({ args: { a: [1, 2], b: { c: 3, d: 5 } } })).not.toBe(first);
  });

  it('supports a host-supplied WebCrypto port', async () => {
    expect(await canonicalArgumentDigest({ args: {} }, { crypto: webcrypto })).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('rejects invalid arguments before invoking crypto', async () => {
    const crypto = { subtle: { digest: () => { throw new Error('crypto must not run'); } } };
    await expect(canonicalArgumentDigest({ args: [undefined] }, { crypto })).rejects.toBeInstanceOf(CanonicalJsonError);
  });

  it('propagates failures from the host crypto port', async () => {
    const error = new Error('digest unavailable');
    const crypto = { subtle: { digest: async () => { throw error; } } };
    await expect(canonicalArgumentDigest({ args: {} }, { crypto })).rejects.toBe(error);
  });
});
