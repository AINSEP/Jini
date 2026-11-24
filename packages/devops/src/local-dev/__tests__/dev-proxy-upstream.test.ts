import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { installUpstreamCloseHandling, type ProxyEventsPort, type UpstreamRefusal } from '../dev-proxy-upstream.js';

/**
 * In-process contract tests against hand-written fakes of the three objects a proxy hands the
 * handlers (the proxy emitter, the upstream response, the client response). Each test pins one
 * decision the handling makes, without a network.
 */
type FakeClientRes = {
  writableEnded?: boolean;
  headersSent?: boolean;
  destroyed: number;
  written?: { status: number; headers: Record<string, string> };
  body?: string;
  destroy(): void;
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
};

function fakeRes(fields: { writableEnded?: boolean; headersSent?: boolean } = {}): FakeClientRes {
  const res: FakeClientRes = {
    ...fields,
    destroyed: 0,
    destroy() { res.destroyed += 1; },
    writeHead(status, headers) { res.written = { status, headers }; },
    end(body) { res.body = body; },
  };
  return res;
}

const REFUSAL: UpstreamRefusal = { status: 503, headers: { 'content-type': 'text/plain', 'x-host-marker': 'refused' }, body: 'restarting' };

function installedProxy(): EventEmitter {
  const proxy = new EventEmitter();
  // The handling only uses `.on`; a bare EventEmitter is the whole surface it touches.
  installUpstreamCloseHandling({ proxy: proxy as unknown as ProxyEventsPort, refusal: REFUSAL });
  return proxy;
}

function errorWith(code: string | undefined): Error {
  return Object.assign(new Error('proxy failure'), code === undefined ? {} : { code });
}

describe('installUpstreamCloseHandling', () => {
  test('destroys the client response when the upstream closes before the client response ended', () => {
    const proxy = installedProxy();
    const upstream = new EventEmitter();
    const res = fakeRes({ writableEnded: false });
    proxy.emit('proxyRes', upstream, {}, res);
    upstream.emit('close');
    expect(res.destroyed).toBe(1);
  });

  test('leaves an already-ended client response alone when the upstream closes after a normal end', () => {
    const proxy = installedProxy();
    const upstream = new EventEmitter();
    const res = fakeRes({ writableEnded: true });
    proxy.emit('proxyRes', upstream, {}, res);
    upstream.emit('close');
    expect(res.destroyed).toBe(0);
  });

  test('ignores errors on a WebSocket upgrade socket, which has no headersSent', () => {
    const proxy = installedProxy();
    const socket = fakeRes();
    proxy.emit('error', errorWith('ECONNREFUSED'), { headers: { accept: 'text/event-stream' } }, socket);
    expect(socket.destroyed).toBe(0);
    expect(socket.written).toBeUndefined();
  });

  test('ignores errors once the client response already sent its headers', () => {
    const proxy = installedProxy();
    const res = fakeRes({ headersSent: true });
    proxy.emit('error', errorWith('ECONNREFUSED'), { headers: { accept: 'text/event-stream' } }, res);
    expect(res.destroyed).toBe(0);
    expect(res.written).toBeUndefined();
  });

  test('drops an SSE request instead of answering it, whatever the error code', () => {
    const proxy = installedProxy();
    const res = fakeRes({ headersSent: false });
    proxy.emit('error', errorWith('ECONNRESET'), { headers: { accept: 'text/event-stream' } }, res);
    expect(res.destroyed).toBe(1);
    expect(res.written).toBeUndefined();
  });

  test('answers a refused non-SSE request with the host-supplied refusal', () => {
    const proxy = installedProxy();
    const res = fakeRes({ headersSent: false });
    proxy.emit('error', errorWith('ECONNREFUSED'), { headers: {} }, res);
    expect(res.destroyed).toBe(0);
    expect(res.written).toEqual({ status: 503, headers: REFUSAL.headers });
    expect(res.body).toBe('restarting');
  });

  test('leaves any other non-SSE proxy error to the proxy\'s own handler', () => {
    const proxy = installedProxy();
    const res = fakeRes({ headersSent: false });
    proxy.emit('error', errorWith('ECONNRESET'), { headers: { accept: 'application/json' } }, res);
    proxy.emit('error', errorWith(undefined), { headers: { accept: 'application/json' } }, res);
    expect(res.destroyed).toBe(0);
    expect(res.written).toBeUndefined();
  });
});
