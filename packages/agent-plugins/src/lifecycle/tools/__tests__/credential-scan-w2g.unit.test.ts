import { expect, test } from 'vitest';
import { openCapabilityGate, openCredentialScan, WITHHELD_ERROR_MESSAGE } from '../capabilities.js';

test('credential scanning follows symbol properties and Map keys and fails closed on unreadable getters', () => {
  const token = 'fixture-issued-token';
  const scan = openCredentialScan({ issued: new Set([token]) });
  const hidden = { [Symbol('hidden')]: new Map([[token, 'public']]) };
  const sanitized = scan.sanitize({ error: hidden });
  expect(sanitized).toBeInstanceOf(Error);
  expect((sanitized as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
  expect(Object.hasOwn(sanitized as Error, 'cause')).toBe(false);
  const getter = Object.defineProperty({}, 'detail', { get() { throw new Error('unreadable'); } });
  expect((scan.sanitize({ error: getter }) as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
});

test('a bounded error scan handles cyclic safe objects but withholds graphs beyond its node budget', () => {
  const scan = openCredentialScan({ issued: new Set(['fixture-issued-token']) });
  const cycle: { next?: unknown } = {};
  cycle.next = cycle;
  expect(scan.sanitize({ error: cycle })).toBe(cycle);
  const large = new Set(Array.from({ length: 257 }, () => ({})));
  expect((scan.sanitize({ error: large }) as Error).message).toBe(WITHHELD_ERROR_MESSAGE);
});

test('an empty issued token adds no credential and undefined results remain legal after a real token is issued', () => {
  const issued = new Set<string>();
  const gate = openCapabilityGate({ isLive: () => true, issued });
  expect(gate.noteToken({ token: '' })).toBe('');
  expect([...issued]).toEqual([]);
  gate.noteToken({ token: 'fixture-issued-token' });
  expect(gate.release({ value: undefined })).toBeUndefined();
  expect(gate.release({ value: { public: 'value' } })).toEqual({ public: 'value' });
  gate.end();
});
