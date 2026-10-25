/**
 * @file One table per identifier grammar and per list cap in `capability-declarations.ts`, driven
 * through the public parser so each case also proves which declaration path names the refusal.
 * Every table has: shortest valid, longest valid, max+1, empty, leading junk, trailing junk ("x\n",
 * "x!"), and the case/character-class boundary. Closes Stryker run-2's 30 survivors (25 Regex).
 */
import { describe, expect, test } from 'vitest';
import { parseAdminSurfaceCapabilityDeclarations } from '../capability-declarations.js';

const parse = (entry: Record<string, unknown>) => parseAdminSurfaceCapabilityDeclarations({ entry, at: 's' });
const ok = (value: unknown) => typeof value !== 'string';
const x = (n: number, c = 'a') => c.repeat(n);

describe('connection id', () => {
  test.each<[unknown, boolean]>([
    ['a', true], ['A', true], ['0', true], ['a._-Z9', true], [x(64), true],
    [x(65), false], ['', false], ['.a', false], ['_a', false], ['-a', false], [' a', false], ['a\n', false], ['a!', false], ['a b', false],
    [123, false], [null, false],
  ])('%j -> accepted: %s', (id, accepted) => {
    const result = parse({ connections: [{ id }] });
    if (accepted) expect(result).toEqual({ connections: [{ id, startParams: [], callbackFields: [] }] });
    else expect(result).toBe('s.connections[0].id must be a short connection id');
  });
});

describe('start parameter names', () => {
  test.each<[string, boolean]>([
    ['a', true], ['_', true], ['.', true], ['-', true], ['A9_.-', true], [x(64), true],
    [x(65), false], ['', false], [' a', false], ['a\n', false], ['a!', false], ['a/b', false],
  ])('%j -> accepted: %s', (name, accepted) => {
    const result = parse({ connections: [{ id: 'c', startParams: ['first', name] }] });
    if (accepted) expect(result).toEqual({ connections: [{ id: 'c', startParams: ['first', name], callbackFields: [] }] });
    else expect(result).toBe(`s.connections[0].startParams[1] must be a unique name matching ${/^[A-Za-z0-9_.-]{1,64}$/.source}`);
  });
});

describe('callback field names', () => {
  test.each<[string, boolean]>([
    ['a', true], ['Z', true], ['ab', true], ['a9_.-', true], [x(64), true],
    [x(65), false], ['', false], ['9a', false], ['_a', false], ['.a', false], [' a', false], ['a\n', false], ['a!', false], ['a b', false],
  ])('%j -> accepted: %s', (name, accepted) => {
    const result = parse({ connections: [{ id: 'c', callbackFields: ['code', name] }] });
    if (accepted) expect(result).toEqual({ connections: [{ id: 'c', startParams: [], callbackFields: ['code', name] }] });
    else expect(result).toBe(`s.connections[0].callbackFields[1] must be a unique name matching ${/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.source}`);
  });
});

describe('public config names', () => {
  test.each<[string, boolean]>([
    ['A', true], ['A9_', true], ['SITE_URL', true], [x(64, 'A'), true],
    [x(65, 'A'), false], ['', false], ['a', false], ['Site', false], ['9A', false], ['_A', false], [' A', false], ['A\n', false], ['A!', false], ['A-B', false],
  ])('%j -> accepted: %s', (name, accepted) => {
    const result = parse({ publicConfig: ['FIRST', name] });
    if (accepted) expect(result).toEqual({ publicConfig: ['FIRST', name] });
    else expect(result).toBe(`s.publicConfig[1] must be a unique name matching ${/^[A-Z][A-Z0-9_]{0,63}$/.source}`);
  });

  test.each(['API_TOKEN', 'CLIENT_SECRET', 'DB_PASSWORD', 'PASSWD', 'PRIVATE_KEY', 'CREDENTIALS', 'COOKIE_NAME', 'SESSION_ID', 'SIGNING_KEY'])('%s is refused as a secret name', (name) => {
    expect(parse({ publicConfig: ['SITE_URL', name] })).toBe('s.publicConfig[1] names a secret; public config may only hold values that are safe to show');
  });
});

describe('delivery adapter ids', () => {
  test.each<[string, boolean]>([
    ['a', true], ['ab', true], ['a1', true], ['a-b', true], ['a-bc', true], ['ab-c-de', true], [x(64), true], [`${x(31)}-${x(32)}`, true],
    [x(65), false], [`${x(32)}-${x(32)}`, false], ['', false], ['-a', false], ['a-', false], ['a--b', false], ['A', false], ['a_b', false],
    [' a', false], ['a\n', false], ['a!', false],
  ])('%j -> accepted: %s', (id, accepted) => {
    const result = parse({ deliveryAdapters: ['first', id] });
    if (accepted) expect(result).toEqual({ deliveryAdapters: ['first', id] });
    else expect(result).toBe(`s.deliveryAdapters[1] must be a unique name matching ${/^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.source}`);
  });
});

describe('forms', () => {
  test('only the one read operation "list" is admitted', () => {
    expect(parse({ forms: ['list'] })).toEqual({ forms: ['list'] });
    expect(parse({ forms: [] })).toEqual({ forms: [] });
  });

  test.each(['lists', 'xlist', 'List', 'list\n', ''])('%j is refused', (op) => {
    expect(parse({ forms: [op] })).toBe('s.forms[0] must be a unique name matching ^list$');
  });

  test('more than one entry is refused by the cap', () => {
    expect(parse({ forms: ['list', 'list'] })).toBe('s.forms must be an array of at most 1');
  });
});

describe('list caps and shapes (limit and limit+1)', () => {
  const names = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i));
  test.each<[string, string, number, (i: number) => unknown]>([
    ['connections', 's.connections must be an array of at most 4', 4, (i) => ({ id: `c${i}` })],
    ['publicConfig', 's.publicConfig must be an array of at most 16', 16, (i) => `N${i}`],
    ['deliveryAdapters', 's.deliveryAdapters must be an array of at most 8', 8, (i) => `a${i}`],
  ])('%s: exactly the cap passes, cap+1 is refused', (key, message, cap, make) => {
    expect(ok(parse({ [key]: names(cap, make as (i: number) => string) }))).toBe(true);
    expect(parse({ [key]: names(cap + 1, make as (i: number) => string) })).toBe(message);
  });

  test('startParams and callbackFields: 8 pass, 9 are refused', () => {
    expect(ok(parse({ connections: [{ id: 'c', startParams: names(8, (i) => `p${i}`), callbackFields: names(8, (i) => `f${i}`) }] }))).toBe(true);
    expect(parse({ connections: [{ id: 'c', startParams: names(9, (i) => `p${i}`) }] })).toBe('s.connections[0].startParams must be an array of at most 8');
    expect(parse({ connections: [{ id: 'c', callbackFields: names(9, (i) => `f${i}`) }] })).toBe('s.connections[0].callbackFields must be an array of at most 8');
  });

  test.each([[{}], ['list'], [null]])('a non-array list %j is refused', (value) => {
    expect(parse({ deliveryAdapters: value })).toBe('s.deliveryAdapters must be an array of at most 8');
    expect(parse({ connections: value })).toBe('s.connections must be an array of at most 4');
  });

  test('a connection that is an array, null or a string is not an object', () => {
    for (const entry of [['c'], null, 'c']) expect(parse({ connections: [{ id: 'ok' }, entry] })).toBe('s.connections[1] must be an object');
  });

  test('duplicates: a repeated name and a repeated connection id are refused; distinct ones pass', () => {
    expect(parse({ publicConfig: ['A', 'B', 'A'] })).toBe(`s.publicConfig[2] must be a unique name matching ${/^[A-Z][A-Z0-9_]{0,63}$/.source}`);
    expect(parse({ connections: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] })).toBe("s.connections[2].id 'a' is declared twice");
    expect(parse({ connections: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })).toEqual({ connections: ['a', 'b', 'c'].map((id) => ({ id, startParams: [], callbackFields: [] })) });
  });

  test('a non-string name in a list is refused at its index', () => {
    expect(parse({ deliveryAdapters: ['a', 7] })).toBe(`s.deliveryAdapters[1] must be a unique name matching ${/^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.source}`);
  });

  test('undeclared lists add no keys; the first refusal in declaration order wins', () => {
    expect(parse({})).toEqual({});
    expect(parse({ connections: 'x', publicConfig: 'x' })).toBe('s.connections must be an array of at most 4');
  });
});
