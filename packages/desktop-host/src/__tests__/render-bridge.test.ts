/** Private transport contract, using fake HTTP/fetch and a fake native capture port. */
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { renderBridgeFromEnv, startRenderBridge, RENDER_BRIDGE_URL_ENV, RENDER_BRIDGE_TOKEN_ENV } from '../render-bridge.js';
import { URL_CAPTURE_MAX_BYTES } from '../url-capture.js';

const request = { url: 'http://127.0.0.1:4312/', viewport: { width: 1280, height: 800 }, fullPage: false, maxPageHeightPx: 8000, settleMs: 0 };
const result = { png: Buffer.from('png'), finalUrl: request.url, title: 'Title', status: null, pageHeight: 800, capturedHeight: 800, blockedRequests: 0 };
const env = { [RENDER_BRIDGE_URL_ENV]: 'http://127.0.0.1:49321/capture', [RENDER_BRIDGE_TOKEN_ENV]: 'a'.repeat(64) };

function fakeServer() {
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  let closed = false;
  const native = Object.assign(new EventEmitter(), {
    listen: (_port: number, host: string, callback: () => void) => { expect(host).toBe('127.0.0.1'); callback(); },
    address: () => ({ port: 49321 }),
    close: () => { closed = true; }, closeAllConnections: () => {},
  });
  const factory = ((listener: typeof handler) => { handler = listener; return native; }) as unknown as typeof createServer;
  async function invoke({ authorization, body = JSON.stringify(request), origin }: { authorization?: string; body?: string; origin?: string } = {}) {
    const req = Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', url: '/capture', headers: { authorization, origin } });
    let status = 200;
    let resolve: (value: { status: number; body: string }) => void;
    const response = new Promise<{ status: number; body: string }>(r => { resolve = r; });
    const res = Object.assign(new EventEmitter(), {
      setHeader: () => {}, writeHead: (value: number) => { status = value; return res; },
      end: (body = '') => { resolve({ status, body }); },
    });
    handler!(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    return response;
  }
  return { factory, invoke, get closed() { return closed; } };
}

describe('render bridge', () => {
  it('requires a complete loopback environment contract', () => {
    expect(renderBridgeFromEnv({ env: {} })).toBeNull();
    for (const patch of [{ [RENDER_BRIDGE_URL_ENV]: 'https://evil.example/capture' }, { [RENDER_BRIDGE_TOKEN_ENV]: '' }, { [RENDER_BRIDGE_URL_ENV]: 'http://127.0.0.1:1/capture?token=x' }]) {
      expect(() => renderBridgeFromEnv({ env: { ...env, ...patch } })).toThrow('invalid desktop capture channel');
    }
  });

  it('passes a private bearer capability and reconstructs PNG bytes through fake fetch', async () => {
    const client = renderBridgeFromEnv({ env }, { fetch: (async (url, options) => {
      expect(url).toBe(env[RENDER_BRIDGE_URL_ENV]);
      expect(options?.headers).toEqual({ Authorization: `Bearer ${env[RENDER_BRIDGE_TOKEN_ENV]}`, 'Content-Type': 'application/json' });
      expect(options?.redirect).toBe('error');
      expect(JSON.parse(options?.body as string)).toEqual(request);
      return new Response(JSON.stringify({ ...result, png: result.png.toString('base64') }));
    }) as typeof fetch });
    expect(await client!.captureUrl(request)).toEqual(result);
  });

  it('authenticates before calling native capture and refuses browser-origin requests', async () => {
    const fake = fakeServer();
    let calls = 0;
    const bridge = await startRenderBridge({ capture: { async captureUrl() { calls++; return result; } } }, { createServer: fake.factory });
    const authorization = `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}`;
    try {
      expect((await fake.invoke()).status).toBe(403);
      expect((await fake.invoke({ authorization: 'Bearer wrong' })).status).toBe(403);
      expect((await fake.invoke({ authorization, origin: 'http://site.example' })).status).toBe(403);
      expect(calls).toBe(0);
      expect(JSON.parse((await fake.invoke({ authorization })).body).png).toBe(result.png.toString('base64'));
      expect(calls).toBe(1);
      expect((await fake.invoke({ authorization, body: 'x'.repeat(8193) })).status).toBe(400);
      expect(calls).toBe(1);
    } finally { bridge.close(); }
    expect(fake.closed).toBe(true);
  });

  it('rejects concurrent work and cancels an active native window when closed', async () => {
    const fake = fakeServer();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const bridge = await startRenderBridge({ capture: { captureUrl(_request, options) {
      entered();
      return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } } }, { createServer: fake.factory });
    const authorization = `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}`;
    const pending = fake.invoke({ authorization });
    await started;
    expect((await fake.invoke({ authorization })).status).toBe(429);
    bridge.close();
    expect((await pending).status).toBe(400);
  });

  it('rejects over-cap native PNG output before serialization', async () => {
    const fake = fakeServer();
    const bridge = await startRenderBridge({ capture: { async captureUrl() { return { ...result, png: Buffer.alloc(URL_CAPTURE_MAX_BYTES + 1) }; } } }, { createServer: fake.factory });
    try {
      const response = await fake.invoke({ authorization: `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}` });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: 'load-failed' });
    } finally { bridge.close(); }
  });
});
