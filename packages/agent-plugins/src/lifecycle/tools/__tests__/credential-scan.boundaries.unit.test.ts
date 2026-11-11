/**
 * @file Boundaries of the credential scans and gates in `capabilities.ts`: a token that only appears
 * JSON-escaped inside a larger string is still found (security), the error-graph node limit is exact
 * (256 objects scanned, the 257th withholds), primitive properties are never mistaken for unreadable
 * objects, the state-key grammar table, and the limiter forwarding its input and result. Closes Stryker
 * run-2 survivors at tools/capabilities.ts:65, 111, 169, 171, 236.
 */
import { describe, expect, test } from 'vitest';
import {
  PLUGIN_STATE_MAX_KEY_LENGTH, REVOKED_MESSAGE, WITHHELD_ERROR_MESSAGE, WITHHELD_OUTPUT_MESSAGE,
  checkedStateKey, guardSharedCapabilities, openCapabilityGate, openCredentialScan,
} from '../capabilities.js';

/** Built at runtime; holds a quote and a backslash so its JSON form differs from its raw form. */
const TOKEN = ['tok', '"q', '\\b-', 'z'.repeat(12)].join('');

function gate(live = true) {
  const g = openCapabilityGate({ isLive: () => live, issued: new Set() });
  g.noteToken({ token: TOKEN });
  return g;
}

describe('JSON-escaped token leak check', () => {
  test('a token embedded in a larger string is withheld from a result (found via its JSON-escaped form)', () => {
    expect(() => gate().release({ value: { message: `Bearer ${TOKEN} end` } })).toThrow(WITHHELD_OUTPUT_MESSAGE);
    expect(gate().mentionsToken({ value: [`x${TOKEN}`] })).toBe(true);
  });

  test('an error whose message holds the token only in JSON-escaped form is withheld', () => {
    const escaped = JSON.stringify({ auth: `x${TOKEN}y` });
    const sanitized = gate().sanitize({ error: new Error(`upstream said ${escaped}`) });
    expect(sanitized).toBeInstanceOf(Error);
    expect((sanitized as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
  });

  test('a value without the token is released unchanged; an empty token is never remembered', () => {
    const value = { message: 'tok "q fine' };
    expect(gate().release({ value })).toBe(value);
    const empty = openCapabilityGate({ isLive: () => true, issued: new Set() });
    expect(empty.noteToken({ token: '' })).toBe('');
    expect(empty.mentionsToken({ value: 'anything' })).toBe(false);
  });
});

describe('error scan', () => {
  const scan = () => { const issued = new Set([TOKEN]); return openCredentialScan({ issued }); };

  test('an error carrying primitive properties (number, boolean, bigint, symbol, undefined) is passed through', () => {
    const error = Object.assign(new Error('plain'), { code: 5, retry: false, big: 1n, sym: Symbol('s'), none: undefined, nil: null });
    expect(scan().sanitize({ error })).toBe(error);
  });

  test('exactly 256 scanned objects pass; the 257th withholds (fails closed)', () => {
    const withObjects = (n: number) => Object.assign(new Error('plain'), { list: Array.from({ length: n }, () => ({})) });
    const atLimit = withObjects(254); // error + array + 254 = 256 objects
    expect(scan().sanitize({ error: atLimit })).toBe(atLimit);
    expect((scan().sanitize({ error: withObjects(255) }) as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
  });

  test('a token in a non-enumerable cause is found', () => {
    const error = new Error('outer', { cause: new Error(`inner ${TOKEN}`) });
    expect((scan().sanitize({ error }) as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
  });
});

describe('checkedStateKey', () => {
  const max = 'k'.repeat(PLUGIN_STATE_MAX_KEY_LENGTH);
  test.each<[unknown, boolean]>([
    ['a', true], ['A9', true], ['a.b_c:d-e', true], [max, true],
    [`${max}k`, false], ['', false], ['.a', false], [':a', false], ['-a', false], [' a', false], ['a\n', false], ['a!', false], ['a/b', false], [7, false], [null, false],
  ])('%j accepted: %s', (key, accepted) => {
    if (accepted) expect(checkedStateKey({ key })).toBe(key);
    else expect(() => checkedStateKey({ key })).toThrow(`A settings key must be a short name of at most ${PLUGIN_STATE_MAX_KEY_LENGTH} characters.`);
  });
});

describe('guardSharedCapabilities', () => {
  test('the limiter forwards its exact input and returns the host result; refuses once revoked', async () => {
    const seen: unknown[] = [];
    const result = { allowed: false, retryAfterSeconds: 3 } as const;
    const host = { http: { fetch: async () => new Response('') }, limiter: { check: async (input: { key: string }) => { seen.push(input); return result; } } };
    const shared = guardSharedCapabilities({ gate: gate(), host });
    const input = { key: 'login' };
    await expect(shared.limiter.check(input)).resolves.toBe(result);
    expect(seen).toEqual([input]);
    expect(seen[0]).toBe(input);
    expect('artifacts' in shared).toBe(false);
    const revoked = guardSharedCapabilities({ gate: gate(false), host });
    await expect(revoked.limiter.check(input)).rejects.toThrow(REVOKED_MESSAGE);
  });
});
