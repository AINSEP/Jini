import { describe, expect, it } from 'vitest';
import { captureElectronUrl } from '../electron-url-capture.js';
import { createFakeBrowserWindowFactory } from '../testing.js';
import type { ElectronBrowserWindowFactory } from '../electron-surfaces.js';
import { URL_CAPTURE_MAX_BYTES, type UrlCaptureRequest } from '../../url-capture.js';

const request: UrlCaptureRequest = {
  url: 'https://site.example/page', viewport: { width: 375, height: 812 },
  fullPage: true, maxPageHeightPx: 2000, settleMs: 0,
};
const allowedOrigins = ['https://site.example'];

function fixture(_required: Record<string, never>, options: {
  rawHeight?: unknown;
  finalUrl?: string;
  png?: Buffer;
  missing?: 'debugger' | 'executeJavaScript' | 'getURL' | 'getTitle';
  nativeError?: Error;
} = {}) {
  const fake = createFakeBrowserWindowFactory({}, { pngResult: options.png ?? Buffer.from('png') });
  const commands: Array<[string, unknown]> = [];
  const scripts: string[] = [];
  const factory: ElectronBrowserWindowFactory = (required, nativeOptions) => {
    const win = fake.factory(required, nativeOptions);
    const page = win.webContents;
    Object.assign(page.session, {
      clearStorageData: async () => {}, clearCache: async () => {},
      clearAuthCache: async () => {}, closeAllConnections: async () => {},
    });
    page.getURL = () => options.finalUrl ?? request.url;
    page.getTitle = () => 't'.repeat(301);
    page.executeJavaScript = async expression => {
      scripts.push(expression);
      if (options.nativeError) throw options.nativeError;
      return options.rawHeight;
    };
    page.debugger = {
      attach() {},
      sendCommand: async (method, params) => {
        commands.push([method, params]);
        return { data: (options.png ?? Buffer.from('png')).toString('base64') };
      },
    };
    if (options.missing) delete page[options.missing];
    return win;
  };
  return { factory, windows: fake.windows, commands, scripts };
}

describe('URL capture height and refusal behavior before extraction', () => {
  it.each([
    [undefined, 812, 812], ['9000', 812, 812], [NaN, 812, 812], [Infinity, 812, 812],
    [-Infinity, 812, 812], [-3, 1, 1], [0, 1, 1], [1024.2, 1025, 1025], [9000, 9000, 2000],
  ])('preserves full-page height selection for %s', async (rawHeight, pageHeight, capturedHeight) => {
    const f = fixture({}, { rawHeight });
    const result = await captureElectronUrl({ createBrowserWindow: f.factory, request }, { allowedOrigins });
    expect(result).toEqual({ png: Buffer.from('png'), finalUrl: request.url, title: 't'.repeat(300),
      status: null, pageHeight, capturedHeight, blockedRequests: 0 });
    expect(f.commands.at(-1)).toEqual(['Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 375, height: capturedHeight, scale: 1 },
    }]);
    expect(f.windows[0]!.isDestroyed()).toBe(true);
  });

  it('uses viewport capture regardless of a taller document and skips lazy scrolling', async () => {
    const f = fixture({}, { rawHeight: 9000 });
    const result = await captureElectronUrl({ createBrowserWindow: f.factory, request: { ...request, fullPage: false } }, { allowedOrigins });
    expect(result.pageHeight).toBe(812);
    expect(result.capturedHeight).toBe(812);
    expect(Buffer.from(result.png).toString()).toBe('png');
    expect(f.scripts).toEqual(['Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)']);
    expect(f.commands).toEqual([['Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }]]);
  });

  it.each(['debugger', 'executeJavaScript', 'getURL', 'getTitle'] as const)('refuses missing native %s capability and destroys the window', async missing => {
    const f = fixture({}, { missing });
    await expect(captureElectronUrl({ createBrowserWindow: f.factory, request }, { allowedOrigins })).rejects.toMatchObject({
      code: 'not-implemented', message: missing === 'debugger' ? 'native device emulation unavailable' : 'host does not support URL capture',
    });
    expect(f.windows[0]!.isDestroyed()).toBe(true);
  });

  it('rejects a redirect before reading page height', async () => {
    const f = fixture({}, { finalUrl: 'https://other.example/' });
    await expect(captureElectronUrl({ createBrowserWindow: f.factory, request }, { allowedOrigins })).rejects.toMatchObject({
      code: 'navigation-blocked', message: 'capture redirected off site',
    });
    expect(f.scripts).toHaveLength(1);
    expect(f.commands.map(([method]) => method)).toEqual(['Emulation.setDeviceMetricsOverride']);
  });

  it('normalizes native errors and enforces the PNG byte limit', async () => {
    const failed = fixture({}, { nativeError: new Error('native detail') });
    await expect(captureElectronUrl({ createBrowserWindow: failed.factory, request }, { allowedOrigins }))
      .rejects.toMatchObject({ code: 'load-failed', message: 'native page capture failed' });
    const large = fixture({}, { png: Buffer.alloc(URL_CAPTURE_MAX_BYTES + 1) });
    await expect(captureElectronUrl({ createBrowserWindow: large.factory, request }, { allowedOrigins }))
      .rejects.toMatchObject({ code: 'load-failed', message: 'capture exceeds PNG byte limit' });
    expect(large.windows[0]!.isDestroyed()).toBe(true);
  });
});
