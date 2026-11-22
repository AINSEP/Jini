import { describe, expect, it } from 'vitest';
import type { MediaProviderConfigurationMap } from '../../models.js';
import { createHttpMediaProvidersPort, type MediaProvidersTransportPort } from '../http.js';

const catalog = [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }] as const;

function memoryTransport(initial: MediaProviderConfigurationMap) {
  let stored = initial;
  const puts: MediaProviderConfigurationMap[] = [];
  const transport: MediaProvidersTransportPort = {
    async request<T>({ method, body }: { path: string; method: 'GET' | 'PUT'; body?: unknown }): Promise<T> {
      if (method === 'PUT') { stored = body as MediaProviderConfigurationMap; puts.push(stored); }
      return stored as T;
    },
  };
  return { transport, puts };
}

describe('createHttpMediaProvidersPort', () => {
  it('lists one view per catalog provider and keeps only a four-character tail', async () => {
    const { transport } = memoryTransport({ alpha: { apiKeyConfigured: true, apiKeyTail: 'abcdef' }, foreign: { model: 'x' } });
    const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
    await expect(port.list({})).resolves.toEqual([
      { id: 'alpha', label: 'Alpha', configured: true, apiKeyTail: 'cdef' },
      { id: 'beta', label: 'Beta', configured: false },
    ]);
  });

  it('refuses a provider outside the catalog without writing, and keeps foreign providers on a whole save', async () => {
    const { transport, puts } = memoryTransport({ foreign: { model: 'x' } });
    const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
    await expect(port.saveCredential!({ id: 'nope', credential: 'k' })).rejects.toThrow('Unknown media provider "nope"');
    expect(puts).toEqual([]);
    await port.saveChanges!({ providers: { alpha: { apiKey: ' key ' } } });
    expect(puts).toEqual([{ foreign: { model: 'x' }, alpha: { apiKey: 'key' } }]);
  });

  it('answers null when the read fails, so an outage is not read as "no providers"', async () => {
    const transport: MediaProvidersTransportPort = { async request() { throw new Error('offline'); } };
    const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
    await expect(port.list({})).resolves.toBeNull();
  });
});
