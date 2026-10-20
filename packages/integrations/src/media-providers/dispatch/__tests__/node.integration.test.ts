import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { HttpClientPort } from '@jini-ai/core/primitives';
import type { createNodeGuardedHttpPorts } from '@jini-ai/platform/http/guarded';
import { createNodeMediaHttpClient } from '../node.js';
import { fetchMediaOutbound } from '../outbound.js';

type NativeRequest = NonNullable<ConstructorParameters<typeof import('@jini-ai/platform/http/guarded').FetchHttpTransportAdapter>[1]>['request'];
let nativeRequest: NativeRequest;

// Replace only the native request effect. Real peer validation, transport connection options,
// decoded-body buffering, zlib, deadlines and the Response adapter run without listening sockets.
vi.mock('@jini-ai/platform/http/guarded', async importOriginal => {
  const original = await importOriginal<typeof import('@jini-ai/platform/http/guarded')>();
  return { ...original, createNodeGuardedHttpPorts: ((required) => ({
    ...original.createNodeGuardedHttpPorts(required),
    transport: new original.FetchHttpTransportAdapter({}, { request: nativeRequest! }),
  })) satisfies typeof createNodeGuardedHttpPorts };
});

function fixture({ status = 200, bytes = Buffer.from([0xff, 0, 0x80, 0x42]), headers = {}, stall = false }: {
  status?: number; bytes?: Buffer; headers?: IncomingMessage['headers']; stall?: boolean;
} = {}) {
  const sent: Parameters<NonNullable<NativeRequest>>[0][] = [];
  let response: PassThrough;
  let started!: () => void;
  const bodyStarted = new Promise<void>(resolve => { started = resolve; });
  let destroyed = false;
  nativeRequest = input => {
    sent.push(input);
    const request = new EventEmitter() as ClientRequest;
    request.destroy = error => {
      destroyed = true;
      response?.destroy();
      if (error) request.emit('error', error);
      return request;
    };
    request.write = vi.fn(() => true);
    request.end = (() => {
      const signal = input.options.signal;
      const abort = () => request.destroy(Object.assign(new Error('native request aborted'), { name: 'AbortError' }));
      signal?.addEventListener('abort', abort, { once: true });
      queueMicrotask(() => {
        response = new PassThrough();
        const incoming = response as PassThrough & IncomingMessage;
        incoming.statusCode = status;
        incoming.headers = headers;
        response.once('close', () => signal?.removeEventListener('abort', abort));
        input.onResponse(incoming);
        response.write(bytes);
        started();
        if (!stall) response.end();
      });
      return request;
    }) as ClientRequest['end'];
    return request;
  };
  return { sent, bodyStarted, destroyed: () => destroyed };
}

const url = 'https://pinned.example:8443/asset?size=7';

describe('media outbound through the native transport request seam', () => {
  it('dials the vetted IP once, preserving authority, TLS SNI, path and binary bytes', async () => {
    const state = fixture();
    const resolve = vi.fn().mockResolvedValueOnce(['93.184.216.34']).mockResolvedValue(['10.0.0.5']);
    const httpClient = createNodeMediaHttpClient({}, { dns: { resolve } });
    const response = await fetchMediaOutbound({ url, timeoutMs: 1000 }, { httpClient });
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0xff, 0, 0x80, 0x42]));
    expect(resolve.mock.calls).toEqual([[{ hostname: 'pinned.example' }]]);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ secure: true, options: {
      host: '93.184.216.34', port: 8443, servername: 'pinned.example', path: '/asset?size=7',
      headers: { host: 'pinned.example:8443' }, timeout: 1000,
    } });
  });

  it('refuses a redirect before a second connection even with private-network opt-in', async () => {
    const state = fixture({ status: 302, bytes: Buffer.alloc(0), headers: { location: 'http://127.0.0.1/secret' } });
    const httpClient = createNodeMediaHttpClient({}, { allowPrivateNetwork: true, dns: { resolve: async () => ['127.0.0.1'] } });
    await expect(fetchMediaOutbound({ url, timeoutMs: 1000 }, { httpClient, init: { redirect: 'follow' } }))
      .rejects.toThrow(/redirect/);
    expect(state.sent).toHaveLength(1);
  });

  it('cancels an in-flight body read through the native request signal', async () => {
    const state = fixture({ stall: true });
    const caller = new AbortController();
    const httpClient = createNodeMediaHttpClient({}, { dns: { resolve: async () => ['93.184.216.34'] } });
    const pending = fetchMediaOutbound({ url, timeoutMs: 1000 }, { httpClient, init: { signal: caller.signal } });
    const reason = new Error('caller stopped');
    const rejected = expect(pending).rejects.toBe(reason);
    await state.bodyStarted;
    caller.abort(reason);
    await rejected;
    expect(state.sent[0]?.options.signal?.aborted).toBe(true);
    expect(state.destroyed()).toBe(true);
  });

  it('enforces the whole-operation deadline during DNS before any native request', async () => {
    const state = fixture();
    const resolve = vi.fn(() => new Promise<readonly string[]>(() => {}));
    const httpClient = createNodeMediaHttpClient({}, { dns: { resolve } });
    await expect(fetchMediaOutbound({ url, timeoutMs: 25 }, { httpClient }))
      .rejects.toMatchObject({ name: 'FetchTimeoutError', url, timeoutMs: 25 });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(state.sent).toHaveLength(0);
  });

  it('enforces the deadline through an unfinished decoded body', async () => {
    const state = fixture({ stall: true });
    const httpClient = createNodeMediaHttpClient({}, { dns: { resolve: async () => ['93.184.216.34'] } });
    await expect(fetchMediaOutbound({ url, timeoutMs: 25 }, { httpClient }))
      .rejects.toMatchObject({ name: 'FetchTimeoutError', url, timeoutMs: 25 });
    expect(state.destroyed()).toBe(true);
  });

  it.each([false, true])('refuses bytes exceeding a stricter caller cap (gzip: %s)', async compressed => {
    const state = fixture({ bytes: compressed ? gzipSync('12345') : Buffer.from('12345'),
      headers: compressed ? { 'content-encoding': 'gzip' } : {} });
    const nodeClient = createNodeMediaHttpClient({}, { dns: { resolve: async () => ['93.184.216.34'] } });
    const httpClient: HttpClientPort = { send: ({ request }, options) =>
      nodeClient.send({ request: { ...request, maxResponseBytes: 4 } }, options) };
    await expect(fetchMediaOutbound({ url, timeoutMs: 1000 }, { httpClient })).rejects.toThrow('truncated');
    expect(state.destroyed()).toBe(true);
  });
});
