import { describe, expect, it, vi } from 'vitest';
import { createElectronRenderService } from '../electron-render-service.js';
import type { ElectronBrowserWindowFactory } from '../electron-surfaces.js';
import { readUrlCaptureRequest, URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS } from '../../url-capture.js';

const request = { url: 'http://127.0.0.1:4312/', viewport: { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true }, fullPage: true, maxPageHeightPx: 8000, settleMs: 0 };

function fixture({ hang = false, png = Buffer.from('png'), finalUrl = request.url, clearStorage = async () => {} } = {}, _options = {}) {
  let policy: any;
  let options: any;
  let destroyed = false;
  const calls: string[] = [];
  const commands: Array<[string, unknown]> = [];
  const sessions = new Map<string, { storage: number; cache: number; auth: number; connections: number }>();
  const wc = {
    session: {} as any,
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
    const partition = options.webPreferences.partition;
    if (!sessions.has(partition)) sessions.set(partition, { storage: 0, cache: 0, auth: 0, connections: 0 });
    const counts = sessions.get(partition)!;
    wc.session = {
      clearStorageData: async () => { counts.storage++; await clearStorage(); },
      clearCache: async () => { counts.cache++; },
      clearAuthCache: async () => { counts.auth++; },
      closeAllConnections: async () => { counts.connections++; },
      webRequest: { onBeforeRequest: (input: any) => {
        if (input.listener) { calls.push('onBeforeRequest'); policy = input.listener; }
      } },
    };
    return { webContents: wc, loadURL: async ({ url }: { url: string }) => {
      calls.push(`loadURL:${url}`);
      if (hang) await new Promise(() => {});
      else await Promise.resolve();
      calls.push(`loaded:${url}`);
    },
      isDestroyed: () => destroyed, destroy: () => { destroyed = true; } };
  }) as unknown as ElectronBrowserWindowFactory;
  const service = createElectronRenderService({ createBrowserWindow: factory });
  return { service, calls, commands, sessions, get options() { return options; }, get destroyed() { return destroyed; },
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

  it('reuses at most two isolated partitions and clears storage, caches and connections for every capture', async () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) {
      await f.service.captureUrl({ ...request, fullPage: false }, { allowedOrigins: ['http://127.0.0.1:4312'] });
      expect(f.options.webPreferences.partition).toMatch(/^jini-url-capture-[01]$/);
    }
    expect(f.sessions.size).toBeLessThanOrEqual(2);
    expect([...f.sessions.values()].reduce((sum, session) => sum + session.storage, 0)).toBe(40);
    for (const session of f.sessions.values()) {
      expect(session.cache).toBe(session.storage);
      expect(session.auth).toBe(session.storage);
      expect(session.connections).toBe(session.storage);
    }
  });

  it('caps PNG output and clears the failed capture session', async () => {
    const large = fixture({ png: Buffer.alloc(URL_CAPTURE_MAX_BYTES + 1) });
    await expect(large.service.captureUrl({ ...request, fullPage: false }, { allowedOrigins: ['http://127.0.0.1:4312'] })).rejects.toMatchObject({ code: 'load-failed' });
    expect(large.destroyed).toBe(true);
    expect([...large.sessions.values()][0]).toEqual({ storage: 2, cache: 2, auth: 2, connections: 2 });
  });

  it('keeps concurrent services on separate partitions and bounds capacity without a waiting queue', async () => {
    const a = fixture({ hang: true });
    const b = fixture({ hang: true });
    const c = fixture();
    const first = new AbortController();
    const second = new AbortController();
    const options = { allowedOrigins: ['http://127.0.0.1:4312'] };
    const aResult = expect(a.service.captureUrl(request, { ...options, signal: first.signal })).rejects.toMatchObject({ code: 'aborted' });
    const bResult = expect(b.service.captureUrl(request, { ...options, signal: second.signal })).rejects.toMatchObject({ code: 'aborted' });
    try {
      expect(a.options.webPreferences.partition).not.toBe(b.options.webPreferences.partition);
      await expect(c.service.captureUrl(request, options)).rejects.toMatchObject({ message: 'native capture capacity reached' });
      expect(c.options).toBeUndefined();
    } finally {
      first.abort(); second.abort();
      await Promise.all([aResult, bResult]);
    }
    await c.service.captureUrl(request, options);
    expect([...a.sessions.values()][0]!.storage).toBe(2);
    expect([...b.sessions.values()][0]!.storage).toBe(2);
  });

  it('holds the partition until asynchronous cleanup finishes', async () => {
    let release!: () => void;
    let resets = 0;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    const a = fixture({ clearStorage: async () => { if (++resets === 2) await cleanup; } });
    const b = fixture({ hang: true });
    const c = fixture();
    const controller = new AbortController();
    const options = { allowedOrigins: ['http://127.0.0.1:4312'] };
    const pending = a.service.captureUrl(request, options);
    const aborted = expect(b.service.captureUrl(request, { ...options, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    try {
      await vi.waitFor(() => expect(resets).toBe(2));
      await expect(c.service.captureUrl(request, options)).rejects.toMatchObject({ message: 'native capture capacity reached' });
      release();
      await pending;
      await c.service.captureUrl(request, options);
      expect(c.options.webPreferences.partition).toBe(a.options.webPreferences.partition);
    } finally {
      release(); controller.abort();
      await Promise.all([pending, aborted]);
    }
  });

  it('does not navigate when clearing previous storage fails, and allows a later clean capture', async () => {
    let clears = 0;
    const f = fixture({ clearStorage: async () => { if (++clears === 1) throw new Error('native details'); } });
    const options = { allowedOrigins: ['http://127.0.0.1:4312'] };
    await expect(f.service.captureUrl(request, options)).rejects.toMatchObject({ code: 'load-failed', message: 'native capture session cleanup failed' });
    expect(f.calls).not.toContain(`loadURL:${request.url}`);
    expect(f.destroyed).toBe(true);
    await f.service.captureUrl(request, options);
  });

  it('rejects invalid size and wait requests', () => {
    for (const patch of [{ maxPageHeightPx: 8001 }, { settleMs: 5001 }, { viewport: { width: 1281, height: 800 } }]) {
      expect(() => readUrlCaptureRequest({ value: { ...request, ...patch } })).toThrow('invalid capture request');
    }
  });
});
