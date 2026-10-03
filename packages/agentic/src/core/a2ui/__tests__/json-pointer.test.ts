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
