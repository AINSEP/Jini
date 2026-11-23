/** Owner dispatch: native screenshots use the existing feature port; no real Electron/browser. */
import { expect, test } from 'vitest';
import { createDesktopPageCapture, createPageCaptureForHost, type NativeUrlCapture, type NativeRenderError } from '../desktop-page-capture.js';
import { PageCaptureError, VIEWPORT_PRESETS, type PageCaptureRequest, type PageCapturePort } from '../web-screenshot.js';

/** Stands in for the desktop host's render error; the host injects its own `instanceof` check. */
class FakeRenderError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const isRenderServiceError = (error: unknown): error is NativeRenderError => error instanceof FakeRenderError;

const request: PageCaptureRequest = { url: 'http://127.0.0.1:4200/about', viewport: VIEWPORT_PRESETS.mobile,
  fullPage: true, maxPageHeightPx: 8000, settleMs: 1200, allowedOrigins: ['http://127.0.0.1:4200'] };
const result = { png: Buffer.from('native png'), finalUrl: request.url, title: 'About', status: null, pageHeight: 9000, capturedHeight: 8000, blockedRequests: 2 };

function desktop(capture: NativeUrlCapture) { return createDesktopPageCapture({ capture, isRenderServiceError }); }

/** A Playwright stand-in that fails as the real adapter does when no browser is installed. */
function fakePlaywright() {
  const state = { captures: 0, closes: 0 };
  const port: PageCapturePort = {
    async capture() { state.captures++; throw new PageCaptureError({ kind: 'unavailable', message: 'Chromium is not installed' }); },
    async close() { state.closes++; },
  };
  return { port, state };
}

test('passes viewport/full-page settings and cancellation to the native port, preserves PNG facts', async () => {
  let received: unknown;
  const controller = new AbortController();
  const port = desktop({ async captureUrl(input, options) { received = { input, options }; return { ...result, png: new Uint8Array(result.png) }; } });
  const captured = await port.capture(request, { signal: controller.signal });
  expect(captured).toEqual(result);
  expect(Buffer.isBuffer(captured.png)).toBe(true);
  expect(received).toEqual({ input: { url: request.url, viewport: request.viewport, fullPage: true,
    maxPageHeightPx: 8000, settleMs: 1200 }, options: { signal: controller.signal } });
  await port.close();
});

test('public reference URLs never reach native Electron', async () => {
  let calls = 0;
  const port = desktop({ async captureUrl() { calls++; return result; } });
  await expect(port.capture({ ...request, url: 'https://example.com/', allowedOrigins: [] })).rejects.toMatchObject({ kind: 'refused' });
  expect(calls).toBe(0);
});

test('maps native timeout, cancellation, refusal and failure onto screenshot errors', async () => {
  for (const [code, kind] of [['timeout', 'timeout'], ['aborted', 'timeout'], ['navigation-blocked', 'refused'], ['load-failed', 'failed']] as const) {
    const capture: NativeUrlCapture = { async captureUrl() { throw new FakeRenderError(code, 'native failure'); } };
    await expect(desktop(capture).capture(request)).rejects.toMatchObject({ kind, message: 'native failure' });
  }
});

test('native option guards precede transport and numeric waits override settling without a signal', async () => {
  const received: Array<{ input: Parameters<NativeUrlCapture['captureUrl']>[0]; options: Parameters<NativeUrlCapture['captureUrl']>[1] }> = [];
  const port = desktop({ async captureUrl(input, options) { received.push({ input, options }); return result; } });
  for (const override of [{ dismissCookieBanners: true }, { waitFor: '#ready' }]) {
    await expect(port.capture({ ...request, ...override })).rejects.toMatchObject({ kind: 'failed', message: 'native capture does not support consent clicks or selector waits' });
  }
  await expect(port.capture({ ...request, allowedOrigins: [], dismissCookieBanners: true }))
    .rejects.toMatchObject({ kind: 'refused', message: 'desktop capture requires sitePath on this site' });
  expect(received).toEqual([]);
  await port.capture({ ...request, waitFor: 0, dismissCookieBanners: false });
  await port.capture({ ...request, waitFor: 1.5 });
  expect(received.map(({ input, options }) => [input.settleMs, options])).toEqual([[0, {}], [1500, {}]]);
});

test('native unexpected failures discard transport details while all render codes retain their message', async () => {
  for (const code of ['aborted', 'timeout', 'navigation-blocked', 'load-failed', 'not-implemented'] as const) {
    const capture: NativeUrlCapture = { async captureUrl() { throw new FakeRenderError(code, 'render detail'); } };
    const kind = code === 'aborted' || code === 'timeout' ? 'timeout' : code === 'navigation-blocked' ? 'refused' : 'failed';
    await expect(desktop(capture).capture(request)).rejects.toMatchObject({ kind, message: 'render detail' });
  }
  const capture: NativeUrlCapture = { async captureUrl() { throw new Error('private transport detail'); } };
  await expect(desktop(capture).capture(request)).rejects.toMatchObject({ kind: 'failed', message: 'native capture failed' });
});

test('an absent desktop channel returns the injected Playwright adapter itself', async () => {
  const { port: playwright, state } = fakePlaywright();
  const port = createPageCaptureForHost({ playwright, nativeCapture: null, isRenderServiceError });
  expect(port).toBe(playwright);
  await expect(port.capture(request)).rejects.toMatchObject({ kind: 'unavailable' });
  expect(state.captures).toBe(1);
});

test('the host selects native own-site captures and preserves guarded Playwright for public references and interactions', async () => {
  let nativeCalls = 0;
  const { port: playwright, state } = fakePlaywright();
  const port = createPageCaptureForHost({ playwright, isRenderServiceError,
    nativeCapture: { async captureUrl() { nativeCalls++; return result; } } });
  expect(await port.capture(request)).toEqual(result);
  expect([nativeCalls, state.captures]).toEqual([1, 0]);
  for (const routed of [{ ...request, url: 'https://example.com/', allowedOrigins: [] }, { ...request, dismissCookieBanners: true }, { ...request, waitFor: '#ready' }]) {
    await expect(port.capture(routed)).rejects.toMatchObject({ kind: 'unavailable' });
  }
  expect([nativeCalls, state.captures]).toEqual([1, 3]);
  await port.close();
  expect(state.closes).toBe(1);
});
