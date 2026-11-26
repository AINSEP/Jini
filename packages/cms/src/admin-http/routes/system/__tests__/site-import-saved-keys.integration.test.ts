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
