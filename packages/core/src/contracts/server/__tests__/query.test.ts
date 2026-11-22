import { describe, expect, it } from 'vitest';
import { readQuery } from '../query.js';

describe('readQuery (the Express 4 query shapes routes already validate)', () => {
  const query = (search: string) => readQuery({ request: new Request(`http://l/x${search}`) });

  it('gives one value as a string and a repeated key as an array, in order', () => {
    expect(query('?a=1&b=2&b=3')).toEqual({ a: '1', b: ['2', '3'] });
    expect(query('')).toEqual({});
  });

  it('collects `name[]` keys into an array, as Express did', () => {
    expect(query('?capability[]=x&capability[]=y')).toEqual({ capability: ['x', 'y'] });
  });

  // Express 4's extended parser (qs) merges a plain key with its `[]` and `[i]` spellings into one
  // list; a route that accepts a repeated value (frontend-sessions' `capability`) must see every one.
  it('merges mixed plain, `[]` and indexed spellings of one key into one list, as Express did', () => {
    expect(query('?capability=a&capability[]=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[]=a&capability=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[0]=a')).toEqual({ capability: ['a'] });
    expect(query('?capability[1]=b&capability[0]=a')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability[0]=a&capability[0]=b')).toEqual({ capability: ['a', 'b'] });
    expect(query('?capability=a&capability[0]=b')).toEqual({ capability: ['a', 'b'] });
  });

  it('treats an index above 20 or a named key mixed into a list as a non-list, non-string value', () => {
    for (const search of ['?capability[21]=a', '?capability=a&capability[x]=1', '?capability[x]=1&capability[]=a']) {
      const value = query(search).capability;
      expect(value, search).toBeDefined();
      expect(typeof value, search).not.toBe('string');
      expect(Array.isArray(value), search).toBe(false);
    }
  });

  it('gives a bracketed key a non-string value, so a route that requires a string still refuses it', () => {
    const value = query('?contextRef[a]=1').contextRef;
    expect(value).toBeDefined();
    expect(typeof value).not.toBe('string');
    expect(Array.isArray(value)).toBe(false);
  });

  it('never touches the prototype', () => {
    const result = query('?__proto__=x&constructor=y');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toEqual(Object.fromEntries([['__proto__', 'x'], ['constructor', 'y']]));
  });
});

