/** The bridge releases its single capture slot when the peer disconnects or the request deadline passes. */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { expect, it } from 'vitest';
import { startRenderBridge, RENDER_BRIDGE_TOKEN_ENV, type RenderBridgeTimers } from '../render-bridge.js';
import { URL_CAPTURE_TIMEOUT_MS, type UrlCapturePort } from '../url-capture.js';

const request = { url: 'http://127.0.0.1:4312/', viewport: { width: 1280, height: 800 }, fullPage: false, maxPageHeightPx: 8000, settleMs: 0 };

/** A capture that never finishes on its own: it settles only when its signal aborts. */
function hangingCapture() {
  const aborted: boolean[] = [];
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const capture: UrlCapturePort = { captureUrl(_request, options) {
    entered();
    return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => { aborted.push(true); reject(new Error('aborted')); }, { once: true }));
  } };
  return { capture, started, aborted };
}

function fakeServer() {
  let handler!: (req: IncomingMessage, res: ServerResponse) => void;
  const native = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, callback: () => void) => { callback(); },
    address: () => ({ port: 49321 }), close: () => {}, closeAllConnections: () => {},
  });
  const factory = ((listener: typeof handler) => { handler = listener; return native; }) as unknown as typeof createServer;
  function invoke({ authorization, body }: { authorization: string; body?: string }) {
    const req = Object.assign(new PassThrough(), { method: 'POST', url: '/capture', headers: { authorization } });
    if (body !== undefined) req.end(body);
    let status = 200;
    let resolve!: (value: { status: number; body: string }) => void;
    const response = new Promise<{ status: number; body: string }>(r => { resolve = r; });
    const res = Object.assign(new EventEmitter(), {
      setHeader: () => {}, writeHead: (value: number) => { status = value; return res; },
      end: (text = '') => { resolve({ status, body: text }); },
    });
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    return { req, res, response };
  }
  return { factory, invoke };
}

it('aborts the native capture when the requesting peer disconnects', async () => {
  const fake = fakeServer();
  const hanging = hangingCapture();
  const bridge = await startRenderBridge({ capture: hanging.capture }, { createServer: fake.factory });
  try {
    const call = fake.invoke({ authorization: `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}`, body: JSON.stringify(request) });
    await hanging.started;
    call.res.emit('close');
    expect(hanging.aborted).toEqual([true]);
    expect(await call.response).toEqual({ status: 400, body: JSON.stringify({ error: 'load-failed' }) });
    // The slot is free again: the next request reaches the capture port instead of a 429.
    const next = fake.invoke({ authorization: `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}`, body: JSON.stringify(request) });
    await new Promise(resolve => setImmediate(resolve));
    next.res.emit('close');
    expect((await next.response).status).toBe(400);
    expect(hanging.aborted).toEqual([true, true]);
  } finally { bridge.close(); }
});

it('drops a peer that authenticated but never finished sending, once the capture deadline passes', async () => {
  const fake = fakeServer();
  const scheduled: { callback: () => void; ms: number }[] = [];
  const cleared: unknown[] = [];
  const timers: RenderBridgeTimers = {
    setTimeout: (callback, ms) => { scheduled.push({ callback, ms }); return scheduled.length; },
    clearTimeout: handle => { cleared.push(handle); },
  };
  let captures = 0;
  const bridge = await startRenderBridge({ capture: { async captureUrl() { captures++; throw new Error('unreached'); } } }, { createServer: fake.factory, timers });
  try {
    const stalled = fake.invoke({ authorization: `Bearer ${bridge.env[RENDER_BRIDGE_TOKEN_ENV]}` });
    expect(scheduled.map(entry => entry.ms)).toEqual([URL_CAPTURE_TIMEOUT_MS]);
    scheduled[0]!.callback();
    expect(stalled.req.destroyed).toBe(true);
    expect((await stalled.response).status).toBe(400);
    expect(cleared).toEqual([1]);
    expect(captures).toBe(0);
  } finally { bridge.close(); }
});
