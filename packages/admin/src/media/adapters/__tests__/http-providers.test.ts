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

it('preserves other providers and saved fields when setting and removing a credential', async () => {
  const { transport, puts } = memoryTransport({
    alpha: { baseUrl: 'https://media.test/v1', model: 'illustration' },
    beta: { model: 'photo' }, foreign: { model: 'untouched' },
  });
  const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
  await port.saveCredential!({ id: 'alpha', credential: 'test-key-7462' });
  expect(puts).toEqual([{
    alpha: { baseUrl: 'https://media.test/v1', model: 'illustration', apiKey: 'test-key-7462' },
    beta: { model: 'photo' }, foreign: { model: 'untouched' },
  }]);
  await port.removeCredential!({ id: 'alpha' });
  expect(puts[1]).toEqual({ beta: { model: 'photo' }, foreign: { model: 'untouched' } });
  await expect(port.list({})).resolves.toEqual([
    { id: 'alpha', label: 'Alpha', configured: false },
    { id: 'beta', label: 'Beta', configured: false, model: 'photo' },
  ]);
});

it('clears blank settings while retaining a stored credential and drops empty unconfigured entries', async () => {
  const { transport, puts } = memoryTransport({
    alpha: { baseUrl: 'https://old.test', model: 'old', apiKeyConfigured: true, apiKeyTail: '1234' },
    beta: { model: 'obsolete' },
  });
  const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
  await expect(port.saveSettings!({ id: 'alpha', baseUrl: ' ', model: '  ' })).resolves.toEqual({
    id: 'alpha', label: 'Alpha', configured: true, apiKeyTail: '1234',
  });
  await expect(port.saveSettings!({ id: 'beta', baseUrl: 'https://new.test', model: 'new-model' })).resolves.toEqual({
    id: 'beta', label: 'Beta', configured: false, baseUrl: 'https://new.test', model: 'new-model',
  });
  await port.saveSettings!({ id: 'beta', baseUrl: '', model: '' });
  expect(puts[2]).toEqual({ alpha: { apiKeyConfigured: true, apiKeyTail: '1234' } });
});

it('normalizes submitted settings and never sends the displayed key tail as a credential', async () => {
  const { transport, puts } = memoryTransport({ beta: { model: 'remove' }, foreign: { model: 'retain' } });
  const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog }, { pinnedProviderIds: ['alpha'] });
  await port.saveChanges!({ providers: {
    alpha: { baseUrl: ' https://new.test ', model: ' model-9 ', apiKey: '   ', apiKeyConfigured: true, apiKeyTail: '1349' },
    beta: { apiKeyTail: '7788' },
  } });
  expect(port.pinnedProviderIds).toEqual(['alpha']);
  expect(puts).toEqual([{
    alpha: { baseUrl: 'https://new.test', model: 'model-9', apiKeyConfigured: true },
    beta: {}, foreign: { model: 'retain' },
  }]);
});

it('propagates an aborted provider read instead of treating it as an outage', async () => {
  const controller = new AbortController();
  const reason = new Error('provider tab closed');
  controller.abort(reason);
  const transport: MediaProvidersTransportPort = {
    async request({ path, method }, options) {
      expect([path, method]).toEqual(['/p', 'GET']);
      expect(options).toEqual({ signal: controller.signal });
      throw reason;
    },
  };
  const port = createHttpMediaProvidersPort({ transport, path: '/p', catalog });
  await expect(port.list({}, { signal: controller.signal })).rejects.toBe(reason);
});

it('keeps a queued provider write runnable after a failed write and passes cancellation only when supplied', async () => {
  const writes: MediaProviderConfigurationMap[] = [];
  let state: MediaProviderConfigurationMap = { beta: { model: 'keep' } };
  const failure = new Error('storage failed for first write');
  const signal = new AbortController().signal;
  const requests: Array<[string, AbortSignal | undefined]> = [];
  const transport: MediaProvidersTransportPort = {
    async request<T>({ path, method, body }: Parameters<MediaProvidersTransportPort['request']>[0], options?: Parameters<MediaProvidersTransportPort['request']>[1]): Promise<T> {
      if (path !== '/providers/test') throw new Error('Unexpected provider path ' + path);
      requests.push([method, options?.signal]);
      if (method === 'PUT') {
        writes.push(body as MediaProviderConfigurationMap);
        if (writes.length === 1) throw failure;
        state = writes[1]!;
      }
      return state as T;
    },
  };
  const api = createHttpMediaProvidersPort({ transport, path: '/providers/test', catalog });
  const rejected = api.saveSettings!({ id: 'alpha', baseUrl: 'https://lost.test', model: '' });
  const accepted = api.saveSettings!({ id: 'alpha', baseUrl: 'https://saved.test', model: 'm-7' }, { signal });
  await expect(rejected).rejects.toBe(failure);
  await expect(accepted).resolves.toEqual({ id: 'alpha', label: 'Alpha', configured: false, baseUrl: 'https://saved.test', model: 'm-7' });
  expect(writes).toEqual([
    { alpha: { baseUrl: 'https://lost.test' }, beta: { model: 'keep' } },
    { alpha: { baseUrl: 'https://saved.test', model: 'm-7' }, beta: { model: 'keep' } },
  ]);
  expect(requests).toEqual([['GET', undefined], ['PUT', undefined], ['GET', signal], ['PUT', signal]]);
});
