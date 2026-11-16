import { describe, expect, it } from 'vitest';
import { getAtPointer, joinPointer, parsePointerTokens, setAtPointer } from '../json-pointer.js';

describe('parsePointerTokens', () => {
  it('splits a simple pointer into unescaped tokens', () => {
    expect(parsePointerTokens({ pointer: '/user/name' })).toEqual(['user', 'name']);
  });
  it('returns an empty array for the empty-string pointer', () => {
    expect(parsePointerTokens({ pointer: '' })).toEqual([]);
  });
  it('unescapes ~1 to / and ~0 to ~, decoding ~1 before ~0 per RFC 6901 §4', () => {
    expect(parsePointerTokens({ pointer: '/a~1b/c~0d' })).toEqual(['a/b', 'c~d']);
  });
  it('throws for a pointer not starting with /', () => {
    expect(() => parsePointerTokens({ pointer: 'user/name' })).toThrow(/must start with/);
  });
});

describe('joinPointer', () => {
  it('joins a base pointer with additional escaped tokens', () => {
    expect(joinPointer({ base: '/users', tokens: ['3', 'firstName'] })).toBe('/users/3/firstName');
  });
  it('treats "" and "/" base as root when joining', () => {
    expect(joinPointer({ base: '', tokens: ['a'] })).toBe('/a');
    expect(joinPointer({ base: '/', tokens: ['a'] })).toBe('/a');
  });
  it('escapes ~ and / in joined tokens', () => {
    expect(joinPointer({ base: '/x', tokens: ['a/b', 'c~d'] })).toBe('/x/a~1b/c~0d');
  });
});

describe('getAtPointer', () => {
  const doc = { user: { name: 'Ada', tags: ['a', 'b', 'c'] }, count: 3 };

  it('resolves the whole document for "" per RFC 6901', () => {
    expect(getAtPointer({ doc, pointer: '' })).toEqual({ found: true, value: doc });
  });
  it("resolves the whole document for '/' per A2UI's own spec text (documented deviation from strict RFC 6901)", () => {
    expect(getAtPointer({ doc, pointer: '/' })).toEqual({ found: true, value: doc });
  });
  it('resolves a nested object path', () => {
    expect(getAtPointer({ doc, pointer: '/user/name' })).toEqual({ found: true, value: 'Ada' });
  });
  it('resolves an array index', () => {
    expect(getAtPointer({ doc, pointer: '/user/tags/1' })).toEqual({ found: true, value: 'b' });
  });
  it('reports not-found for a path with a missing intermediate key — degrades sanely, does not throw', () => {
    expect(getAtPointer({ doc, pointer: '/nope/deeper' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found for an out-of-range array index', () => {
    expect(getAtPointer({ doc, pointer: '/user/tags/99' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found for a non-numeric array segment', () => {
    expect(getAtPointer({ doc, pointer: '/user/tags/foo' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found when descending into a primitive', () => {
    expect(getAtPointer({ doc, pointer: '/count/anything' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found (never throws) for a pointer missing its leading slash', () => {
    expect(getAtPointer({ doc, pointer: 'user/name' })).toEqual({ found: false, value: undefined });
  });
});

describe('setAtPointer', () => {
  it('C42: refuses sparse array writes at both leaf and intermediate segments', () => {
    const doc = { items: [{ name: 'kept' }] };
    // A small gap exercises the same unchecked index assignment as /items/100000000.
    expect({
      leaf: setAtPointer({ doc, pointer: '/items/3', value: 'new' }),
      branch: setAtPointer({ doc, pointer: '/items/3/name', value: 'new' }),
    }).toEqual({ leaf: doc, branch: doc });
  });

  it('C43: deleting absent nested paths preserves missing and primitive parents', () => {
    const doc = { count: 3 };
    expect({
      missing: setAtPointer({ doc, pointer: '/missing/key', value: null }),
      primitive: setAtPointer({ doc, pointer: '/count/key', value: null }),
    }).toEqual({ missing: doc, primitive: doc });
  });

  it('replaces the whole document at root ("/" or "")', () => {
    expect(setAtPointer({ doc: { a: 1 }, pointer: '/', value: { b: 2 } })).toEqual({ b: 2 });
    expect(setAtPointer({ doc: { a: 1 }, pointer: '', value: { b: 2 } })).toEqual({ b: 2 });
  });
  it('sets a nested key, creating missing intermediate objects', () => {
    expect(setAtPointer({ doc: {}, pointer: '/a/b/c', value: 1 })).toEqual({ a: { b: { c: 1 } } });
  });
  it('does not mutate the original document', () => {
    const original = { a: { b: 1 } };
    const next = setAtPointer({ doc: original, pointer: '/a/b', value: 2 });
    expect(original).toEqual({ a: { b: 1 } });
    expect(next).toEqual({ a: { b: 2 } });
  });
  it('overwrites an existing array index', () => {
    expect(setAtPointer({ doc: { list: [1, 2, 3] }, pointer: '/list/1', value: 99 })).toEqual({ list: [1, 99, 3] });
  });
  it('writes through an array intermediate segment (not just as the final segment)', () => {
    expect(setAtPointer({ doc: { list: [{ name: 'a' }, { name: 'b' }] }, pointer: '/list/1/name', value: 'renamed' })).toEqual({ list: [{ name: 'a' }, { name: 'renamed' }] });
  });
  it('extends an array intermediate segment when the index is past the current end', () => {
    expect(setAtPointer({ doc: { list: [{}] }, pointer: '/list/1/name', value: 'new' })).toEqual({ list: [{}, { name: 'new' }] });
  });
  it('a non-numeric array intermediate segment degrades to a no-op instead of throwing', () => {
    const doc = { list: [1, 2] };
    expect(setAtPointer({ doc, pointer: '/list/bogus/deeper', value: 'x' })).toEqual(doc);
  });
  it('a non-numeric FINAL array segment also degrades to a no-op instead of throwing', () => {
    const doc = { list: [1, 2] };
    expect(setAtPointer({ doc, pointer: '/list/bogus', value: 'x' })).toEqual(doc);
  });
  it('replaces a non-object, non-array intermediate two-or-more levels deep with a fresh object rather than throwing', () => {
    expect(setAtPointer({ doc: { a: 5 }, pointer: '/a/b/c', value: 1 })).toEqual({ a: { b: { c: 1 } } });
  });
  it("an empty-string intermediate reference token (RFC 6901 allows '' as a legal key) degrades to a no-op rather than fabricating a \"\"-keyed object — a documented simplification, not full RFC 6901 write support", () => {
    const doc = {};
    expect(setAtPointer({ doc, pointer: '//x', value: 'val' })).toEqual(doc);
  });
  it('deletes an object key when value is explicitly null (non-root)', () => {
    expect(setAtPointer({ doc: { a: 1, b: 2 }, pointer: '/a', value: null })).toEqual({ b: 2 });
  });
  it('deletes (splices) an array element when value is explicitly null', () => {
    expect(setAtPointer({ doc: { list: [1, 2, 3] }, pointer: '/list/1', value: null })).toEqual({ list: [1, 3] });
  });
  it('replaces the whole model with null at root when value is null', () => {
    expect(setAtPointer({ doc: { a: 1 }, pointer: '/', value: null })).toBeNull();
  });
  it('replaces a non-object intermediate with a fresh object rather than throwing', () => {
    expect(setAtPointer({ doc: { a: 5 }, pointer: '/a/b', value: 1 })).toEqual({ a: { b: 1 } });
  });
  it('degrades to a no-op (never throws) for a pointer missing its leading slash — an agent-authored `updateDataModel` path is untrusted wire data, and this was the exact input that used to crash the whole chat React root before this fix', () => {
    const doc = { a: 1 };
    expect(setAtPointer({ doc, pointer: 'a', value: 2 })).toBe(doc);
  });
});

// Regression (2026-07-29 audit). A JSON Pointer names a property of the document, and a JSON
// document has no inherited properties — but both halves of this module reached the prototype
// chain anyway: `token in record` answers `true` for everything `Object.prototype` contributes,
// and a plain `record[token] = value` assignment fires the inherited `__proto__` accessor-setter
// instead of defining a key.
describe('prototype chain — a pointer addresses the document, never what it inherits', () => {
  it.each(['/constructor', '/toString', '/hasOwnProperty', '/__proto__', '/valueOf'])(
    'reports not-found for %s on a plain object rather than resolving the inherited member',
    (pointer) => {
      expect(getAtPointer({ doc: {}, pointer })).toEqual({ found: false, value: undefined });
    },
  );

  it('reports not-found for an inherited member reached through an intermediate segment', () => {
    expect(getAtPointer({ doc: { user: {} }, pointer: '/user/constructor/name' })).toEqual({ found: false, value: undefined });
  });

  it('still resolves an own property that shadows an inherited name', () => {
    // The key itself is legal RFC 6901 — only the *inherited* member must be unreachable.
    expect(getAtPointer({ doc: { constructor: 'mine' }, pointer: '/constructor' })).toEqual({ found: true, value: 'mine' });
  });

  it('writing /__proto__ defines an own key instead of changing the result\'s prototype', () => {
    const written = setAtPointer({ doc: {}, pointer: '/__proto__', value: { polluted: true } }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    expect(Object.keys(written)).toEqual(['__proto__']);
    expect((written as { polluted?: unknown }).polluted).toBeUndefined();
    // ...and the key it defined is readable back through the same pointer, so read and write agree.
    expect(getAtPointer({ doc: written, pointer: '/__proto__' })).toEqual({ found: true, value: { polluted: true } });
  });

  it('writing through a /__proto__ intermediate segment does the same', () => {
    // NB: `{ __proto__: ... }` written as an object *literal* sets the prototype rather than a
    // key, so the expectation is spelled through the pointer API and Object.keys instead.
    const written = setAtPointer({ doc: {}, pointer: '/__proto__/x', value: 1 }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    expect(Object.keys(written)).toEqual(['__proto__']);
    expect(getAtPointer({ doc: written, pointer: '/__proto__/x' })).toEqual({ found: true, value: 1 });
  });

  it('never reaches the global Object.prototype', () => {
    setAtPointer({ doc: {}, pointer: '/__proto__/globallyPolluted', value: true });
    expect(({} as { globallyPolluted?: unknown }).globallyPolluted).toBeUndefined();
  });

  it('deleting an inherited name is a no-op on a document that never had that key', () => {
    expect(setAtPointer({ doc: { a: 1 }, pointer: '/__proto__', value: null })).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(setAtPointer({ doc: { a: 1 }, pointer: '/__proto__', value: null }))).toBe(Object.prototype);
  });
});

// Characterization pins (code-health wave 3): the edge cases an agent-authored pointer can reach,
// pinned before json-pointer.ts was split into smaller helpers.
describe('getAtPointer — escapes, array-index edge cases and malformed pointers', () => {
  it('decodes ~01 as the literal text ~1 (decode ~1 first, then ~0)', () => {
    expect(getAtPointer({ doc: { 'a~1': 'tilde-one' }, pointer: '/a~01' })).toEqual({ found: true, value: 'tilde-one' });
  });
  it('decodes ~1 into a key that contains a slash', () => {
    expect(getAtPointer({ doc: { '/': 'slash' }, pointer: '/~1' })).toEqual({ found: true, value: 'slash' });
  });
  it('resolves an empty-string key through a trailing slash', () => {
    expect(getAtPointer({ doc: { a: { '': 'empty' } }, pointer: '/a/' })).toEqual({ found: true, value: 'empty' });
  });
  it('resolves an empty-string key on the root via "//"-style pointers', () => {
    expect(getAtPointer({ doc: { '': { '': 2 } }, pointer: '//' })).toEqual({ found: true, value: 2 });
  });
  it.each(['-', '01', '00', '+1', '1e0', ' 1', '1.0', '', 'length', '-1'])('reports not-found for array token %j', (token) => {
    expect(getAtPointer({ doc: { list: ['x', 'y'] }, pointer: `/list/${token}` })).toEqual({ found: false, value: undefined });
  });
  it('resolves index 0', () => {
    expect(getAtPointer({ doc: ['x'], pointer: '/0' })).toEqual({ found: true, value: 'x' });
  });
  it('reports not-found for an index equal to the length', () => {
    expect(getAtPointer({ doc: ['x'], pointer: '/1' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found for an index past Number.MAX_SAFE_INTEGER', () => {
    expect(getAtPointer({ doc: ['x'], pointer: '/9007199254740993' })).toEqual({ found: false, value: undefined });
  });
  it('reports found with undefined for an in-range array hole', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(getAtPointer({ doc: [, 'b'], pointer: '/0' })).toEqual({ found: true, value: undefined });
  });
  it('reports found with undefined for an own key whose value is undefined', () => {
    expect(getAtPointer({ doc: { a: undefined }, pointer: '/a' })).toEqual({ found: true, value: undefined });
  });
  it('reports not-found when the document itself is null', () => {
    expect(getAtPointer({ doc: null, pointer: '/a' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found when descending through a null intermediate', () => {
    expect(getAtPointer({ doc: { a: null }, pointer: '/a/b' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found when descending into a string (no character indexing)', () => {
    expect(getAtPointer({ doc: { s: 'abc' }, pointer: '/s/0' })).toEqual({ found: false, value: undefined });
  });
  it('reports not-found when descending into a function value', () => {
    expect(getAtPointer({ doc: { f: Object.assign(() => 1, { k: 1 }) }, pointer: '/f/k' })).toEqual({ found: false, value: undefined });
  });
  it.each(['/prototype', '/constructor/prototype', '/__proto__/constructor'])('reports not-found for %s on an empty object', (pointer) => {
    expect(getAtPointer({ doc: {}, pointer })).toEqual({ found: false, value: undefined });
  });
  it('resolves an own "prototype" key', () => {
    expect(getAtPointer({ doc: { prototype: 1 }, pointer: '/prototype' })).toEqual({ found: true, value: 1 });
  });
  it('resolves array own-index only, never Array.prototype members', () => {
    expect(getAtPointer({ doc: { list: [] }, pointer: '/list/map' })).toEqual({ found: false, value: undefined });
  });
  it.each(['a', '~1', '#/a', ' /a'])('reports not-found for the malformed pointer %j', (pointer) => {
    expect(getAtPointer({ doc: { a: 1 }, pointer })).toEqual({ found: false, value: undefined });
  });
});

describe('setAtPointer — escapes, array-index edge cases and malformed pointers', () => {
  it('writes a key decoded from ~0 and ~1 escapes', () => {
    expect(setAtPointer({ doc: {}, pointer: '/a~1b/c~0d', value: 1 })).toEqual({ 'a/b': { 'c~d': 1 } });
  });
  it('writes an empty-string final key through a trailing slash', () => {
    expect(setAtPointer({ doc: { a: {} }, pointer: '/a/', value: 1 })).toEqual({ a: { '': 1 } });
  });
  it('an empty-string intermediate token on an array is a no-op that keeps the same array', () => {
    const list = [1];
    const result = setAtPointer({ doc: { list }, pointer: '/list//x', value: 2 }) as { list: unknown };
    expect(result).toEqual({ list: [1] });
    expect(result.list).toBe(list);
  });
  it.each(['-', '01', '+1', '1e0', 'length'])('a final array token %j is a no-op that keeps the same array (no append for "-")', (token) => {
    const list = [1, 2];
    const result = setAtPointer({ doc: { list }, pointer: `/list/${token}`, value: 9 }) as { list: unknown };
    expect(result).toEqual({ list: [1, 2] });
    expect(result.list).toBe(list);
  });
  it.each(['-', '01'])('an intermediate array token %j is a no-op that keeps the same array', (token) => {
    const list = [{ a: 1 }];
    const result = setAtPointer({ doc: { list }, pointer: `/list/${token}/a`, value: 9 }) as { list: unknown };
    expect(result.list).toBe(list);
  });
  it('a malformed final array token with value null is a no-op', () => {
    expect(setAtPointer({ doc: { list: [1, 2] }, pointer: '/list/01', value: null })).toEqual({ list: [1, 2] });
  });
  it('deleting an out-of-range array index returns an unchanged copy', () => {
    const list = [1, 2];
    const result = setAtPointer({ doc: { list }, pointer: '/list/5', value: null }) as { list: unknown[] };
    expect(result.list).toEqual([1, 2]);
    expect(result.list).not.toBe(list);
  });
  it('writing past the end of an array refuses to create holes', () => {
    const result = setAtPointer({ doc: { list: [1] }, pointer: '/list/3', value: 'x' }) as { list: unknown[] };
    expect(result.list.length).toBe(1);
    expect(1 in result.list).toBe(false);
    expect(result.list[3]).toBeUndefined();
  });
  it('refuses an agent-chosen index that would inflate the array length', () => {
    // Without an upper bound on the index, one small message could make the stored array's length huge.
    const result = setAtPointer({ doc: { list: [] }, pointer: '/list/1000000', value: 1 }) as { list: unknown[] };
    expect(result.list.length).toBe(0);
  });
  it('writes through an existing array element, keeping its other keys', () => {
    expect(setAtPointer({ doc: { list: [{ name: 'b', keep: 1 }] }, pointer: '/list/0/name', value: 'c' })).toEqual({ list: [{ name: 'c', keep: 1 }] });
  });
  it('writes through an array-hole intermediate by creating an object', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(setAtPointer({ doc: { list: [, 1] }, pointer: '/list/0/a', value: 2 })).toEqual({ list: [{ a: 2 }, 1] });
  });
  it('writes into a root array document', () => {
    expect(setAtPointer({ doc: [1, 2], pointer: '/0', value: 5 })).toEqual([5, 2]);
  });
  it('creates an object when the document is null', () => {
    expect(setAtPointer({ doc: null, pointer: '/a', value: 1 })).toEqual({ a: 1 });
  });
  it('deleting under a primitive intermediate preserves it', () => {
    expect(setAtPointer({ doc: { a: 5 }, pointer: '/a/b', value: null })).toEqual({ a: 5 });
  });
  it('deleting a key that is absent returns an equal copy, not the same object', () => {
    const doc = { a: 1 };
    const result = setAtPointer({ doc, pointer: '/b', value: null });
    expect(result).toEqual({ a: 1 });
    expect(result).not.toBe(doc);
  });
  it('replaces a function intermediate with a fresh object', () => {
    expect(setAtPointer({ doc: { f: () => 1 }, pointer: '/f/k', value: 1 })).toEqual({ f: { k: 1 } });
  });
  it('writes undefined as an own key (only null deletes)', () => {
    const result = setAtPointer({ doc: { a: 1 }, pointer: '/a', value: undefined }) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(result, 'a')).toBe(true);
    expect(result.a).toBeUndefined();
  });
  it('writes /constructor/prototype/x as own keys without touching Object.prototype', () => {
    const result = setAtPointer({ doc: {}, pointer: '/constructor/prototype/x', value: 1 });
    expect(result).toEqual({ constructor: { prototype: { x: 1 } } });
    expect(({} as { x?: unknown }).x).toBeUndefined();
    expect({}.constructor).toBe(Object);
  });
  it('deletes an own __proto__ key that a previous write defined', () => {
    const withKey = setAtPointer({ doc: {}, pointer: '/__proto__', value: 1 });
    const result = setAtPointer({ doc: withKey, pointer: '/__proto__', value: null }) as object;
    expect(Object.keys(result)).toEqual([]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
  it('keeps the original document when the pointer is malformed even with value null', () => {
    const doc = { a: 1 };
    expect(setAtPointer({ doc, pointer: '~1', value: null })).toBe(doc);
  });
});

describe('joinPointer — base parsing', () => {
  it('throws for a base pointer missing its leading slash', () => {
    expect(() => joinPointer({ base: 'users', tokens: ['0'] })).toThrow(/invalid JSON Pointer \(must start with "\/"\): "users"/);
  });
  it('decodes then re-escapes the base tokens', () => {
    expect(joinPointer({ base: '/a~1b', tokens: [] })).toBe('/a~1b');
  });
  it('joins an empty token list onto root as "/"', () => {
    expect(joinPointer({ base: '', tokens: [] })).toBe('/');
  });
});
