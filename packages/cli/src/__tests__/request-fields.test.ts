import { win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertKnownFields,
  parseRequestObject,
  requireAbsolutePath,
  requireObject,
  requirePositiveInt,
  requireString,
} from '../request-fields.js';

class Refused extends Error {}
const invalid = () => new Refused('refused');

describe('parseRequestObject', () => {
  it('parses a JSON object', () => {
    expect(parseRequestObject({ text: '{"a":1}' }, { invalid })).toEqual({ a: 1 });
  });

  it('rejects text over maxBytes before parsing', () => {
    expect(() => parseRequestObject({ text: '{"a":"xxxxxxxx"}' }, { maxBytes: 4, invalid })).toThrow(Refused);
  });

  it('rejects null text and malformed JSON', () => {
    expect(() => parseRequestObject({ text: null }, { invalid })).toThrow(Refused);
    expect(() => parseRequestObject({ text: '{nope' }, { invalid })).toThrow(Refused);
  });

  it('rejects arrays, null and primitives', () => {
    for (const text of ['[]', 'null', '3', '"s"', 'true']) {
      expect(() => parseRequestObject({ text }, { invalid })).toThrow(Refused);
    }
  });
});

describe('assertKnownFields', () => {
  it('rejects one unknown key and accepts a subset', () => {
    expect(() => assertKnownFields({ record: { a: 1 }, fields: ['a', 'b'] }, { invalid })).not.toThrow();
    expect(() => assertKnownFields({ record: { a: 1, z: 2 }, fields: ['a', 'b'] }, { invalid })).toThrow(Refused);
  });
});

describe('requireObject', () => {
  it('returns objects and rejects the rest', () => {
    expect(requireObject({ value: { a: 1 } }, { invalid })).toEqual({ a: 1 });
    for (const value of [null, [], 'x', 1, undefined]) expect(() => requireObject({ value }, { invalid })).toThrow(Refused);
  });
});

describe('requireString', () => {
  it('rejects blank and NUL-containing strings', () => {
    expect(requireString({ value: 'ok' }, { invalid })).toBe('ok');
    for (const value of ['', '   ', 'a\0b', 5]) expect(() => requireString({ value }, { invalid })).toThrow(Refused);
  });
});

describe('requireAbsolutePath', () => {
  it('rejects relative paths and ".." on either separator', () => {
    expect(() => requireAbsolutePath({ value: 'rel/dir' }, { invalid })).toThrow(Refused);
    expect(() => requireAbsolutePath({ value: '/a/../b' }, { invalid })).toThrow(Refused);
    expect(() => requireAbsolutePath({ value: '/a\\..\\b' }, { invalid })).toThrow(Refused);
    expect(() => requireAbsolutePath({ value: 'C:\\a\\..\\b' }, { invalid, isAbsolute: win32.isAbsolute })).toThrow(Refused);
  });

  it('accepts a Windows drive root', () => {
    expect(requireAbsolutePath({ value: 'C:\\Users\\me' }, { invalid, isAbsolute: win32.isAbsolute })).toBe('C:\\Users\\me');
  });

  it('accepts a POSIX absolute path', () => {
    expect(requireAbsolutePath({ value: '/srv/data' }, { invalid })).toBe('/srv/data');
  });
});

describe('requirePositiveInt', () => {
  it('rejects 0, 1.5 and unsafe integers', () => {
    expect(requirePositiveInt({ value: 3 }, { invalid })).toBe(3);
    for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 2, '1', -1]) {
      expect(() => requirePositiveInt({ value }, { invalid })).toThrow(Refused);
    }
  });
});
