import type { HttpClientPort, HttpRequest, HttpResponse } from '@jini-ai/core/primitives';
import { expect, test, vi } from 'vitest';
import { createSourceControlProviderKit, createSourceControlFetchAdapter } from '../source-control/kit.js';
import { createExportFetchAdapter } from '../static-export/fetch-adapter.js';

test('source-control kit passes object arguments and forces manual redirects', async () => {
  const response = new Response('ok');
  const fetchPort = vi.fn().mockResolvedValue(response);
  const kit = createSourceControlProviderKit({
    httpClient: { send: async () => ({ status: 200, headers: {}, bodyText: '' }) },
    fetch: fetchPort,
    describeTransportError: () => ({ refusal: undefined, logDetail: '' }),
  });
  expect(await kit.fetch({ url: 'https://example.test/api', init: { redirect: 'follow' } })).toBe(response);
  expect(fetchPort).toHaveBeenCalledWith({ url: 'https://example.test/api' }, { init: { redirect: 'manual' } });
});

test('native adapters preserve URL, init, response identity and transport failure', async () => {
  for (const createAdapter of [createSourceControlFetchAdapter, createExportFetchAdapter]) {
    const response = new Response('native');
    const nativeFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const port = createAdapter({ fetch: nativeFetch });
    const init = { redirect: 'manual' as const, headers: { 'x-example': '1' } };
    expect(await port({ url: 'https://example.test' }, { init })).toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith('https://example.test', init);
    const failure = new Error('transport refused');
    nativeFetch.mockRejectedValueOnce(failure);
    await expect(port({ url: 'https://example.test' })).rejects.toBe(failure);
  }
});

// PARITY: the provider kit forwards the selected guarded client unchanged.
test('source-control kit retains the kernel HTTP client, request bytes and transport outcomes', async () => {
  const response: HttpResponse = { status: 200, headers: {}, bodyText: 'ok', bodyBytes: new Uint8Array([0, 255]) };
  const send = vi.fn<HttpClientPort['send']>().mockResolvedValue(response);
  const httpClient: HttpClientPort = { send };
  const kit = createSourceControlProviderKit({
    httpClient,
    fetch: async () => new Response('unused'),
    describeTransportError: () => ({ refusal: undefined, logDetail: '' }),
  });
  const request: HttpRequest = {
    method: 'POST', url: 'https://example.test/api', headers: {},
    body: '{"signed":"bytes"}', timeoutMs: 5_000, maxResponseBytes: 32,
  };
  expect(kit.httpClient).toBe(httpClient);
  expect(await kit.httpClient.send({ request }, { redirect: 'manual' })).toBe(response);
  expect(send).toHaveBeenCalledWith({ request }, { redirect: 'manual' });
  expect(send.mock.calls[0]?.[0].request).toBe(request);
  const failure = new Error('guard refused');
  send.mockRejectedValueOnce(failure);
  await expect(kit.httpClient.send({ request })).rejects.toBe(failure);
});
