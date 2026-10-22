import { it, expect } from 'vitest';
import { createHttpMediaApi } from '../adapters/http.js';
import type { MediaTransportPort } from '../adapters/http.js';
import { createMemoryMediaApi } from '../adapters/memory.js';
it('uses the injected transport, encoded ids and separate body/options objects', async () => {
  const memory = createMemoryMediaApi({});
  const asset = await memory.upload({
    filename: 'a.png',
    contentType: 'image/png',
    dataBase64: 'bytes',
  });
  const calls: unknown[] = [];
  const transport: MediaTransportPort = {
    async request<T>(
      required: Parameters<MediaTransportPort['request']>[0],
      optional: Parameters<MediaTransportPort['request']>[1],
    ) {
      calls.push([required, optional]);
      return (required.method === 'GET' ? { media: [asset] } : { media: asset }) as T;
    },
    url: ({ path }) => `/api${path}`,
  };
  const api = createHttpMediaApi({ transport, basePath: '/workspaces/example/media' });
  const abort = new AbortController();
  expect(await api.list({ filter: 'videos' }, { signal: abort.signal })).toEqual([]);
  await api.update({ id: 'a/b', patch: { title: 'renamed' } }, { signal: abort.signal });
  expect(calls[1]).toEqual([
    { path: '/workspaces/example/media/a%2Fb', method: 'PATCH', body: { title: 'renamed' } },
    { signal: abort.signal },
  ]);
  expect(api.originalUrl({ id: 'a/b' })).toBe('/api/workspaces/example/media/a%2Fb/original');
  expect(api.replace).toBeUndefined();
  expect(api.replaceSupported).toBe(false);
  abort.abort();
  await expect(api.list({}, { signal: abort.signal })).rejects.toThrow();
  expect(calls).toHaveLength(2);
});
