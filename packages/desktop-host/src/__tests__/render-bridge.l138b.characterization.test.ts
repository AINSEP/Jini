import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBridgeFromEnv, RENDER_BRIDGE_TOKEN_ENV, RENDER_BRIDGE_URL_ENV } from '../render-bridge.js';
import { RenderServiceError, type RenderServiceErrorCode } from '../render-service.js';
import { URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS, type UrlCaptureRequest } from '../url-capture.js';

const endpoint = 'http://127.0.0.1:49321/capture';
const token = 'a'.repeat(64);
const env = { [RENDER_BRIDGE_URL_ENV]: endpoint, [RENDER_BRIDGE_TOKEN_ENV]: token };
const request: UrlCaptureRequest = {
  url: 'https://site.example/', viewport: { width: 1, height: 1 }, fullPage: false, maxPageHeightPx: 1, settleMs: 0,
};
const result = { png: 'cG5n', finalUrl: request.url, title: 'title', status: null, pageHeight: 1, capturedHeight: 1, blockedRequests: 0 };
const maxWireBytes = Math.ceil(URL_CAPTURE_MAX_BYTES / 3) * 4 + 8192;

function client({ send }: { send: typeof fetch }, _options = {}) {
  return renderBridgeFromEnv({ env }, { fetch: send })!;
}

afterEach(() => vi.restoreAllMocks());

describe('render bridge client characterization', () => {
  it('uses the browser fallback only when both channel variables are absent', () => {
    expect(renderBridgeFromEnv({ env: {} })).toBeNull();
    expect(() => renderBridgeFromEnv({ env: { [RENDER_BRIDGE_TOKEN_ENV]: token } })).toThrow('invalid desktop capture channel');
    expect(() => renderBridgeFromEnv({ env: { [RENDER_BRIDGE_URL_ENV]: endpoint } })).toThrow('invalid desktop capture channel');
  });

  it.each([
    '', 'garbage', 'https://127.0.0.1/capture', 'http://localhost/capture', 'http://127.0.0.1/other',
    'http://user@127.0.0.1/capture', 'http://:password@127.0.0.1/capture',
    `${endpoint}?secret=x`, `${endpoint}#fragment`,
  ])('fails closed for endpoint %s', value => {
    expect(() => renderBridgeFromEnv({ env: { ...env, [RENDER_BRIDGE_URL_ENV]: value } })).toThrow('invalid desktop capture channel');
  });

  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)])('rejects token %s', value => {
    expect(() => renderBridgeFromEnv({ env: { ...env, [RENDER_BRIDGE_TOKEN_ENV]: value } })).toThrow('invalid desktop capture channel');
  });

  it.each([false, true])('sends the bounded request with caller signal present=%s', async hasSignal => {
    const deadline = new AbortController();
    const caller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const send = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(result)));
    const port = client({ send });
    const options = hasSignal ? { signal: caller.signal } : undefined;
    expect(await port.captureUrl(request, options)).toEqual({ ...result, png: Buffer.from('png') });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(URL_CAPTURE_TIMEOUT_MS);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    expect(init!.signal!.aborted).toBe(false);
    const source = hasSignal ? caller : deadline;
    source.abort();
    expect(init!.signal!.aborted).toBe(true);
  });

  it.each<RenderServiceErrorCode>(['timeout', 'aborted', 'load-failed', 'navigation-blocked', 'not-implemented'])(
    'preserves known server error %s', async code => {
      const port = client({ send: async () => new Response(JSON.stringify({ error: code }), { status: 400 }) });
      await expect(port.captureUrl(request)).rejects.toMatchObject({ code, message: 'desktop capture failed' });
    });

  it.each([null, 'unknown', 42, undefined])('normalizes unknown server error %s', async error => {
    const port = client({ send: async () => new Response(JSON.stringify({ error }), { status: 400 }) });
    await expect(port.captureUrl(request)).rejects.toMatchObject({ code: 'load-failed', message: 'desktop capture failed' });
  });

  it.each([
    [() => new Response(null), 'empty desktop capture response'],
    [() => new Response('{'), 'desktop capture channel unavailable'],
    [() => new Response('null'), 'desktop capture channel unavailable'],
    [() => new Response(JSON.stringify({ ...result, png: 1 })), 'invalid desktop capture response'],
    [() => new Response('x'.repeat(maxWireBytes + 1)), 'capture transport size limit exceeded'],
    [() => new Response(JSON.stringify({ ...result, png: 'A'.repeat(maxWireBytes + 1) })), 'capture transport size limit exceeded'],
    [() => new Response(JSON.stringify({ ...result, png: Buffer.alloc(URL_CAPTURE_MAX_BYTES + 1).toString('base64') })), 'capture too large'],
  ] as const)('rejects invalid response %#', async (response, message) => {
    const port = client({ send: async () => response() });
    await expect(port.captureUrl(request)).rejects.toMatchObject({ code: 'load-failed', message });
  });

  it('rejects invalid requests before fetching', async () => {
    const send = vi.fn<typeof fetch>();
    await expect(client({ send }).captureUrl({ ...request, settleMs: 5001 })).rejects.toMatchObject({ code: 'load-failed', message: 'invalid capture request' });
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts PNG output exactly at the byte limit', async () => {
    const png = Buffer.alloc(URL_CAPTURE_MAX_BYTES);
    const send: typeof fetch = async () => new Response(JSON.stringify({ ...result, png: png.toString('base64') }));
    expect(await client({ send }).captureUrl(request)).toEqual({ ...result, png });
  });

  it.each([
    [false, false, 'load-failed'], [true, false, 'aborted'], [false, true, 'timeout'], [true, true, 'timeout'],
  ] as const)('maps network failure with caller abort=%s and timeout=%s', async (abortCaller, abortTimeout, code) => {
    const deadline = new AbortController();
    const caller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const send: typeof fetch = async () => {
      if (abortCaller) caller.abort();
      if (abortTimeout) deadline.abort();
      throw new Error('private network detail');
    };
    await expect(client({ send }).captureUrl(request, { signal: caller.signal })).rejects.toMatchObject({ code, message: 'desktop capture channel unavailable' });
  });

  it('rethrows typed failures even after the deadline expires', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const error = new RenderServiceError({ code: 'navigation-blocked', message: 'blocked' });
    const send: typeof fetch = async () => { deadline.abort(); throw error; };
    await expect(client({ send }).captureUrl(request)).rejects.toBe(error);
  });

  it('accepts malformed base64 and unchecked result metadata (reported, not fixed)', async () => {
    const send: typeof fetch = async () => new Response('{"png":"!!!","title":7}');
    expect(await client({ send }).captureUrl(request)).toEqual({ png: Buffer.alloc(0), title: 7 });
  });
});
