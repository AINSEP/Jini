import { describe, expect, it, vi } from 'vitest';
import { createElectronRenderService } from '../electron-render-service.js';
import type { ElectronBrowserWindowFactory } from '../electron-surfaces.js';
import { readUrlCaptureRequest, URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS } from '../../url-capture.js';

const request = { url: 'http://127.0.0.1:4312/', viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true }, fullPage: true, maxPageHeightPx: 8000, settleMs: 0 };

function fixture({ hang = false, png = Buffer.from('png'), finalUrl = request.url } = {}) {
  let policy: any;
  let options: any;
  let destroyed = false;
  const calls: string[] = [];
  const commands: Array<[string, unknown]> = [];
  const wc = {
    session: { webRequest: { onBeforeRequest: (input: any) => { calls.push('onBeforeRequest'); policy = input.listener; } } },
    once: () => {}, on: () => {},
    getURL: () => finalUrl, getTitle: () => 'Page',
    executeJavaScript: async () => 9000,
    capturePage: async () => ({ toPNG: () => png }),
    debugger: { attach: (version: string) => { calls.push(`debugger.attach:${version}`); }, sendCommand: async (method: string, params: unknown) => {
      calls.push(method);
      commands.push([method, params]); return { data: png.toString('base64') };
    } },
  };
  const factory = ((_required: {}, input: unknown) => {
    destroyed = false;
    options = input;
    return { webContents: wc, loadURL: async ({ url }: { url: string }) => {
      calls.push(`loadURL:${url}`);
      if (hang) await new Promise(() => {});
      else await Promise.resolve();
      calls.push(`loaded:${url}`);
    },
      isDestroyed: () => destroyed, destroy: () => { destroyed = true; } };
  }) as unknown as ElectronBrowserWindowFactory;
  const service = createElectronRenderService({ createBrowserWindow: factory });
  return { service, calls, commands, get options() { return options; }, get destroyed() { return destroyed; },
    refused(url: string, method = 'GET') { let result: unknown; policy({ details: { url, method }, callback: (value: unknown) => { result = value; } }); return result; } };
}

describe('native URL capture without a downloaded browser', () => {
  it('loads a blank document before attaching/emulating, then navigates under the strict policy', async () => {
    const f = fixture();
    await f.service.captureUrl(request, { allowedOrigins: ['http://127.0.0.1:4312'] });
    expect(f.calls.slice(0, 6)).toEqual([
      'loadURL:about:blank', 'loaded:about:blank', 'onBeforeRequest',
      'debugger.attach:1.3', 'Emulation.setDeviceMetricsOverride', `loadURL:${request.url}`,
    ]);
    expect(f.refused('about:blank')).toEqual({ cancel: true });
  });

  it('uses an isolated sandboxed window, emulates mobile and caps full-page capture', async () => {
    const f = fixture();
    const result = await f.service.captureUrl(request, { allowedOrigins: ['http://127.0.0.1:4312'] });
    expect(Buffer.from(result.png).toString()).toBe('png');
    expect(result.capturedHeight).toBe(8000);
    expect(result.pageHeight).toBe(9000);
    expect(f.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    expect(f.options.webPreferences.partition).not.toMatch(/^persist:/);
    expect(f.commands[0]).toEqual(['Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }]);
    expect(f.destroyed).toBe(true);
    expect(f.refused('http://127.0.0.1:4312/image')).toEqual({ cancel: false });
    for (const url of ['file:///etc/passwd', 'https://evil.example/', 'http://169.254.169.254/', 'ws://127.0.0.1:4312/']) expect(f.refused(url)).toEqual({ cancel: true });
    expect(f.refused(request.url, 'POST')).toEqual({ cancel: true });
  });

  it('refuses an off-origin target before creating a window', async () => {
    const f = fixture();
    await expect(f.service.captureUrl({ ...request, url: 'https://evil.example' }, { allowedOrigins: ['http://127.0.0.1:4312'] })).rejects.toMatchObject({ code: 'navigation-blocked' });
    expect(f.options).toBeUndefined();
  });

  it('destroys a hung window on abort', async () => {
    const f = fixture({ hang: true });
    const controller = new AbortController();
    const pending = f.service.captureUrl(request, { allowedOrigins: ['http://127.0.0.1:4312'], signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(f.destroyed).toBe(true);
  });

  it('destroys a hung window at the fixed deadline', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ hang: true });
      const pending = f.service.captureUrl(request, { allowedOrigins: ['http://127.0.0.1:4312'] });
      const rejection = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await vi.advanceTimersByTimeAsync(URL_CAPTURE_TIMEOUT_MS);
      await rejection;
      expect(f.destroyed).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('refuses an off-origin final URL and destroys the window', async () => {
    const f = fixture({ finalUrl: 'http://169.254.169.254/' });
    await expect(f.service.captureUrl(request, { allowedOrigins: ['http://127.0.0.1:4312'] })).rejects.toMatchObject({ code: 'navigation-blocked' });
    expect(f.destroyed).toBe(true);
  });

  it('caps PNG output and never shares a session partition across captures', async () => {
    const f = fixture();
    await f.service.captureUrl({ ...request, fullPage: false }, { allowedOrigins: ['http://127.0.0.1:4312'] });
    const first = f.options.webPreferences.partition;
    await f.service.captureUrl({ ...request, fullPage: false }, { allowedOrigins: ['http://127.0.0.1:4312'] });
    expect(f.options.webPreferences.partition).not.toBe(first);
    const large = fixture({ png: Buffer.alloc(URL_CAPTURE_MAX_BYTES + 1) });
    await expect(large.service.captureUrl({ ...request, fullPage: false }, { allowedOrigins: ['http://127.0.0.1:4312'] })).rejects.toMatchObject({ code: 'load-failed' });
    expect(large.destroyed).toBe(true);
  });

  it('rejects invalid size and wait requests', () => {
    for (const patch of [{ maxPageHeightPx: 8001 }, { settleMs: 5001 }, { viewport: { width: 1281, height: 800 } }]) {
      expect(() => readUrlCaptureRequest({ value: { ...request, ...patch } })).toThrow('invalid capture request');
    }
  });
});
