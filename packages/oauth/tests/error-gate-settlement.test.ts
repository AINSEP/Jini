import { expect, it, vi } from 'vitest';
import { createFileClientRegistrationCache } from '../src/file-registration-cache.js';

it('returns the registration write error and runs the queued mutation once', async () => {
  const failure = new Error('registration write refused');
  let reject!: (error: unknown) => void;
  let content: string | null = null;
  const writeAtomic = vi.fn().mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }))
    .mockImplementation(async ({ content: next }: { content: string }) => { content = next; });
  const cache = createFileClientRegistrationCache({ filePath: '/clients.json',
    fileIO: { read: async () => content, writeAtomic } });
  const client = { clientId: 'client', clientSecret: null, tokenEndpointAuthMethod: 'none' as const,
    registrationClientUri: null, clientIdIssuedAt: null, clientSecretExpiresAt: null };
  const first = cache.set({ key: 'failed', client });
  const rejected = expect(first).rejects.toBe(failure);
  const second = cache.set({ key: 'saved', client });
  await vi.waitFor(() => expect(writeAtomic).toHaveBeenCalledTimes(1));
  reject(failure);
  await rejected;
  await expect(second).resolves.toBeUndefined();
  expect(writeAtomic).toHaveBeenCalledTimes(2);
  expect(await cache.get({ key: 'failed' })).toBeNull();
  expect(await cache.get({ key: 'saved' })).toEqual(client);
});
