import { expect, it } from 'vitest';
import { completeSiteImportOwner } from '../site-imports.js';

it('completes authorized owner setup using the existing abort signal after parsing', async () => {
  const order: string[] = [];
  const signal = new AbortController().signal;
  const result = await completeSiteImportOwner({
    body: () => { order.push('body'); return { adminPassword: 'password', savedKeysPassword: 'saved' }; },
    backend: () => { order.push('backend'); return { completeOwner: async (input, options) => { order.push('complete'); expect(input).toEqual({ principalId: 'owner', importId: 'import', adminPassword: 'password', savedKeysPassword: 'saved' }); expect(options?.signal).toBe(signal); return {} as Awaited<ReturnType<NonNullable<ReturnType<Parameters<typeof completeSiteImportOwner>[0]['backend']>>['completeOwner']>>; } }; },
    principalId: () => { order.push('principal'); return 'owner'; }, importId: () => 'import',
    signal: () => { order.push('signal'); return signal; }, refusal: ({ message }) => new Error(message),
  });
  expect(result).toEqual({});
  expect(order).toEqual(['body', 'backend', 'principal', 'signal', 'complete']);
});

it('rejects unknown owner form fields before resolving bindings or identity', async () => {
  const reads: string[] = [];
  await expect(completeSiteImportOwner({
    body: () => ({ adminPassword: 'fixture', principalId: 'not-from-session' }),
    backend: () => { reads.push('backend'); return undefined; },
    principalId: () => { reads.push('principal'); return 'owner'; },
    importId: () => 'import',
    signal: () => new AbortController().signal,
    refusal: ({ code, message }) => new Error(`${code}: ${message}`),
  })).rejects.toThrow('INVALID_INPUT: Only the new owner password and optional saved keys password are accepted.');
  expect(reads).toEqual([]);
});

it('fails closed if the owner backend disappears before a valid submission is handled', async () => {
  await expect(completeSiteImportOwner({
    body: () => ({ adminPassword: 'fixture' }), backend: () => undefined,
    principalId: () => 'owner', importId: () => 'import', signal: () => new AbortController().signal,
    refusal: ({ message }) => new Error(message),
  })).rejects.toThrow('site import owner setup has no import backend');
});
