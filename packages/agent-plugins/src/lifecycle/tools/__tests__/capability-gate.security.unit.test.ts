/**
 * @file Security unit tests for the shared capability gate's credential scans: a result or error is
 * released only when its serialized form cannot be shown to omit every token this plugin obtained.
 * Unserializable values fail closed, escaped tokens are still found, and an error is walked through
 * every own property (the JSON-invisible `cause` and `AggregateError.errors` too), Map and Set
 * contents, to any depth within a node bound; an unreadable or oversized error is withheld. Tokens are built at runtime; no credential literal.
 */
import { describe, expect, test } from 'vitest';
import {
  REVOKED_MESSAGE, WITHHELD_ERROR_MESSAGE, WITHHELD_OUTPUT_MESSAGE, checkedStateKey, createIssuedTokenMemories, openCapabilityGate,
} from '../capabilities.js';

const TOKEN = ['tok', 'en', '-', 'y'.repeat(24)].join('');

function gateWith(tokens: readonly string[], optional: { readonly live?: () => boolean } = {}) {
  const issued = createIssuedTokenMemories().forPlugin({ pluginId: 'acme-office' });
  const gate = openCapabilityGate({ isLive: optional.live ?? (() => true), issued });
  for (const token of tokens) gate.noteToken({ token });
  return { gate, issued };
}

describe('release (result gate)', () => {
  test('with no token issued, even an unserializable value is released untouched', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(gateWith([]).gate.release({ value: circular })).toBe(circular);
  });

  test('an unserializable value fails closed once a token was issued', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => gateWith([TOKEN]).gate.release({ value: circular })).toThrow(WITHHELD_OUTPUT_MESSAGE);
  });

  test('a value with no JSON form (undefined) is released, since it cannot carry a token', () => {
    expect(gateWith([TOKEN]).gate.release({ value: undefined })).toBeUndefined();
  });

  test('a token nested in the result is withheld', () => {
    expect(() => gateWith([TOKEN]).gate.release({ value: { rows: [[`Bearer ${TOKEN}`]] } })).toThrow(WITHHELD_OUTPUT_MESSAGE);
  });

  test('a token that JSON escapes is still found in its escaped form', () => {
    const escaped = `${TOKEN}"\\`;
    expect(() => gateWith([escaped]).gate.release({ value: { note: escaped } })).toThrow(WITHHELD_OUTPUT_MESSAGE);
  });

  test('a clean result is released as the same value', () => {
    const value = { rows: [['a']] };
    expect(gateWith([TOKEN]).gate.release({ value })).toBe(value);
  });
});

describe('sanitize (error gate)', () => {
  function chain(depth: number, deepestMessage: string): Error {
    let error = new Error(deepestMessage);
    for (let level = 0; level < depth; level += 1) error = new Error(`level ${level}`, { cause: error });
    return error;
  }

  test('a token in an own field of the error is withheld', () => {
    const error = Object.assign(new Error('failed'), { detail: TOKEN });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token three causes deep is found through the stringified tail of the chain', () => {
    expect(gateWith([TOKEN]).gate.sanitize({ error: chain(3, `upstream said ${TOKEN}`) })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('the replacement error carries no cause', () => {
    const replaced = gateWith([TOKEN]).gate.sanitize({ error: chain(1, TOKEN) }) as Error;
    expect(replaced.cause).toBeUndefined();
  });

  test('a clean cause chain passes through as the same error', () => {
    const error = chain(3, 'upstream said no');
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toBe(error);
  });

  test('a thrown non-error value is scanned as itself', () => {
    expect(gateWith([TOKEN]).gate.sanitize({ error: `raw ${TOKEN}` })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token inside an AggregateError (non-enumerable errors) is withheld', () => {
    const error = new AggregateError([new Error('first'), new Error(`Authorization: Bearer ${TOKEN}`)], 'all failed');
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a clean AggregateError passes through as the same error', () => {
    const error = new AggregateError([new Error('first'), new Error('second')], 'all failed');
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toBe(error);
  });

  test('a token six causes deep is withheld', () => {
    expect(gateWith([TOKEN]).gate.sanitize({ error: chain(6, `upstream said ${TOKEN}`) })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token in an error held by a plain-object cause is withheld', () => {
    const error = new Error('failed', { cause: { response: { inner: new Error(`echo ${TOKEN}`) } } });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token in a non-enumerable own field is withheld', () => {
    const error = Object.defineProperty(new Error('failed'), 'header', { value: `Bearer ${TOKEN}`, enumerable: false });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token held in a Map inside the cause is withheld', () => {
    const error = new Error('failed', { cause: { headers: new Map([['authorization', `Bearer ${TOKEN}`]]) } });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a token held in a Set inside the cause is withheld', () => {
    const error = new Error('failed', { cause: new Set([`Bearer ${TOKEN}`]) });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a cause chain too long to scan fails closed', () => {
    expect(gateWith([TOKEN]).gate.sanitize({ error: chain(300, 'clean all the way down') })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('a cyclic cause chain is scanned once and passes through when clean', () => {
    const error = new Error('loop');
    error.cause = error;
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toBe(error);
  });

  test('a field whose getter throws fails closed', () => {
    const error = Object.defineProperty(new Error('failed'), 'detail', { get() { throw new Error('unreadable'); }, enumerable: false });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toEqual(new Error(WITHHELD_ERROR_MESSAGE));
  });

  test('an error holding a very large array of strings is scanned without throwing', () => {
    const error = Object.assign(new Error('failed'), { lines: Array.from({ length: 300_000 }, () => 'clean') });
    expect(gateWith([TOKEN]).gate.sanitize({ error })).toBe(error);
  });

  test('with no token issued, any error passes through untouched', () => {
    const error = chain(300, 'clean');
    expect(gateWith([]).gate.sanitize({ error })).toBe(error);
  });
});

describe('token memory and revocation', () => {
  test('one memory per plugin: a token noted in one session is withheld by the next, not by another plugin', () => {
    const memories = createIssuedTokenMemories();
    const open = (pluginId: string) => openCapabilityGate({ isLive: () => true, issued: memories.forPlugin({ pluginId }) });
    open('acme-office').noteToken({ token: TOKEN });
    expect(() => open('acme-office').release({ value: TOKEN })).toThrow(WITHHELD_OUTPUT_MESSAGE);
    expect(open('other-plugin').release({ value: TOKEN })).toBe(TOKEN);
  });

  test('an empty token is returned but never remembered', () => {
    const { gate, issued } = gateWith([]);
    expect(gate.noteToken({ token: '' })).toBe('');
    expect(issued.size).toBe(0);
  });

  test('mentionsToken reports a remembered token', () => {
    const { gate } = gateWith([TOKEN]);
    expect([gate.mentionsToken({ value: { a: TOKEN } }), gate.mentionsToken({ value: { a: 'clean' } })]).toEqual([true, false]);
  });

  test('a guarded capability refuses once the plugin is no longer live', async () => {
    let live = true;
    const { gate } = gateWith([], { live: () => live });
    const call = gate.guard(async () => 'called');
    await expect(call()).resolves.toBe('called');
    live = false;
    await expect(call()).rejects.toThrow(REVOKED_MESSAGE);
  });
});

describe('checkedStateKey', () => {
  test('passes a dotted, coloned key of 128 characters', () => {
    const key = `a.b:c-${'d'.repeat(122)}`;
    expect(checkedStateKey({ key })).toBe(key);
  });

  test('refuses a key starting with a separator', () => {
    expect(() => checkedStateKey({ key: '.hidden' })).toThrow('A settings key must be a short name of at most 128 characters.');
  });
});
