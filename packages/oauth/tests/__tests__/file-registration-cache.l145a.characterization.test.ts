import { describe, expect, it } from 'vitest';
import { createFileClientRegistrationCache, type RegistrationCacheFilePort } from '../../src/file-registration-cache.js';
import type { RegisteredOAuthClient } from '../../src/ports.js';

const client: RegisteredOAuthClient = { clientId: 'client', clientSecret: 'secret', tokenEndpointAuthMethod: 'client_secret_basic',
  registrationClientUri: 'https://auth.example/registration', clientIdIssuedAt: 123, clientSecretExpiresAt: 456 };
function cacheFixture(_required: Record<string, never>, { content = null }: { content?: string | null } = {}) {
  let stored = content;
  const fileIO: RegistrationCacheFilePort = {
    async read({ filePath }) { expect(filePath).toBe('/cache/clients.json'); return stored; },
    async writeAtomic({ filePath, content: next }) { expect(filePath).toBe('/cache/clients.json'); stored = next; },
  };
  return { cache: createFileClientRegistrationCache({ filePath: '/cache/clients.json', fileIO }), fileIO };
}

describe('registration file validation characterization', () => {
  it('accepts nullable fields, all authentication methods and nonempty whitespace IDs without normalizing values', async () => {
    for (const tokenEndpointAuthMethod of ['none', 'client_secret_post', 'client_secret_basic'] as const) {
      const value: RegisteredOAuthClient = { clientId: ' ', clientSecret: null, tokenEndpointAuthMethod,
        registrationClientUri: null, clientIdIssuedAt: null, clientSecretExpiresAt: null };
      const { cache } = cacheFixture({}, { content: JSON.stringify([['key', value]]) });
      expect(await cache.get({ key: 'key' })).toEqual(value);
    }
    const { cache } = cacheFixture({}, { content: JSON.stringify([['key', client]]) });
    expect(await cache.get({ key: 'key' })).toEqual(client);
  });

  it.each([{}, null, [null], [['key']], [['key', client, 'extra']], [[1, client]], [['key', null]], [['key', 'client']]].map(rows => ({ rows })))
    ('rejects malformed document and row shapes: $rows', async ({ rows }) => {
      const { cache } = cacheFixture({}, { content: JSON.stringify(rows) });
      await expect(cache.get({ key: 'key' })).rejects.toThrow('invalid registration cache');
    });

  it.each([
    { clientId: '' }, { clientId: 42 }, { clientId: undefined },
    { clientSecret: false }, { clientSecret: undefined },
    { tokenEndpointAuthMethod: 'unsupported' }, { tokenEndpointAuthMethod: undefined },
    { registrationClientUri: 42 }, { registrationClientUri: undefined },
    { clientIdIssuedAt: '123' }, { clientIdIssuedAt: undefined },
    { clientSecretExpiresAt: '456' }, { clientSecretExpiresAt: undefined },
  ])('rejects invalid client fields: %j', async patch => {
    const { cache } = cacheFixture({}, { content: JSON.stringify([['key', { ...client, ...patch }]]) });
    await expect(cache.get({ key: 'key' })).rejects.toThrow('invalid registration cache');
  });

  it.each(['clientIdIssuedAt', 'clientSecretExpiresAt'])('rejects nonfinite parsed numbers in %s', async key => {
    const content = JSON.stringify([['key', { ...client, [key]: 'INFINITY' }]]).replace('"INFINITY"', '1e400');
    const { cache } = cacheFixture({}, { content });
    await expect(cache.get({ key: 'key' })).rejects.toThrow('invalid registration cache');
  });

  it('accepts an array authentication method through string coercion (reported, not fixed)', async () => {
    const value = { ...client, tokenEndpointAuthMethod: ['none'] };
    const { cache } = cacheFixture({}, { content: JSON.stringify([['key', value]]) });
    expect(await cache.get({ key: 'key' })).toEqual(value);
  });

  it('uses the last duplicate key and preserves extra client fields', async () => {
    const last = { ...client, clientId: 'last', extra: 'preserved' };
    const { cache } = cacheFixture({}, { content: JSON.stringify([['key', client], ['key', last]]) });
    expect(await cache.get({ key: 'key' })).toEqual(last);
  });

  it('snapshots writes, detaches reads and removes a persisted key', async () => {
    const { cache, fileIO } = cacheFixture({});
    expect(await cache.get({ key: 'key' })).toBeNull();
    const value = { ...client };
    const write = cache.set({ key: 'key', client: value });
    value.clientId = 'changed';
    await write;
    expect(JSON.parse((await fileIO.read({ filePath: '/cache/clients.json' }))!)).toEqual([['key', client]]);
    const read = await cache.get({ key: 'key' });
    expect(read).toEqual(client);
    Object.assign(read!, { clientId: 'changed again' });
    expect(await cache.get({ key: 'key' })).toEqual(client);
    await cache.delete({ key: 'key' });
    expect(await cache.get({ key: 'key' })).toBeNull();
    expect(await fileIO.read({ filePath: '/cache/clients.json' })).toBe('[]');
  });
});
