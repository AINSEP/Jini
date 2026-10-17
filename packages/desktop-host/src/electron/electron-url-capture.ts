/** URL extension of RenderService: native Chromium, never a second browser installation.
 * Shares the existing render-window lifetime; each URL capture has a private memory session.
 */
import { randomUUID } from 'node:crypto';
import { RenderServiceError } from '../render-service.js';
import { isCaptureUrlAllowed, readUrlCaptureRequest, URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS, type UrlCaptureRequest, type UrlCaptureResult } from '../url-capture.js';
import { withRenderWindow } from './render-window.js';
import type { ElectronBrowserWindowFactory, ElectronWebContentsLike } from './electron-surfaces.js';

export interface ElectronUrlCaptureOptions { allowedOrigins?: readonly string[]; signal?: AbortSignal }

/** Capture a validated own-origin page, bounded in time, CSS pixels and encoded PNG bytes.
 * The host factory denies popups, downloads and permissions on the private session.
 * @throws RenderServiceError on refusal, timeout or native renderer failure.
 * @complexity O(pixels), capped at 1280×8000 CSS pixels and device scale 2.
 */
export async function captureElectronUrl(
  { createBrowserWindow, request: input }: { createBrowserWindow: ElectronBrowserWindowFactory; request: UrlCaptureRequest },
  { allowedOrigins = [], signal }: ElectronUrlCaptureOptions = {},
): Promise<UrlCaptureResult> {
  const request = readUrlCaptureRequest({ value: input });
  if (!isCaptureUrlAllowed({ url: request.url, allowedOrigins })) {
    throw new RenderServiceError({ code: 'navigation-blocked', message: 'capture URL must stay on the site origin' });
  }
  let blockedRequests = 0;
  const factory: ElectronBrowserWindowFactory = (required, options) => {
    return createBrowserWindow(required, { ...options, useContentSize: true,
      webPreferences: { ...options?.webPreferences, sandbox: true, nodeIntegration: false,
        contextIsolation: true, webSecurity: true, backgroundThrottling: false,
        partition: `capture-${randomUUID()}` },
    });
  };
  try {
    return await withRenderWindow({ createBrowserWindow: factory, url: request.url,
      options: { viewport: request.viewport, timeoutMs: URL_CAPTURE_TIMEOUT_MS, ...(signal ? { signal } : {}) },
      prepare: async window => {
        // Electron can crash the main process if device emulation targets an unloaded webContents.
        // Bootstrap before the strict request policy; emulation still precedes site navigation.
        await window.loadURL({ url: 'about:blank' });
        window.webContents.session.webRequest.onBeforeRequest({ listener: ({ details, callback }) => {
          const cancel = details.method !== 'GET' || !isCaptureUrlAllowed({ url: details.url, allowedOrigins });
          if (cancel) blockedRequests++;
          callback({ cancel });
        } });
        const debug = window.webContents.debugger;
        if (!debug) throw new RenderServiceError({ code: 'not-implemented', message: 'native device emulation unavailable' });
        debug.attach('1.3');
        await debug.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: request.viewport.width, height: request.viewport.height,
          deviceScaleFactor: request.viewport.deviceScaleFactor ?? 1, mobile: request.viewport.isMobile ?? false,
        });
      }, run: async win => {
      const page = win.webContents;
      if (!page.debugger || !page.executeJavaScript || !page.getURL || !page.getTitle) {
        throw new RenderServiceError({ code: 'not-implemented', message: 'host does not support URL capture' });
      }
      // Device emulation is configured before navigation, so responsive JS sees this viewport.
      await settle({ page, request });
      const finalUrl = page.getURL();
      if (!isCaptureUrlAllowed({ url: finalUrl, allowedOrigins })) throw new RenderServiceError({ code: 'navigation-blocked', message: 'capture redirected off site' });
      const rawHeight = await page.executeJavaScript('Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)');
      const pageHeight = request.fullPage && typeof rawHeight === 'number' && Number.isFinite(rawHeight) ? Math.max(1, Math.ceil(rawHeight)) : request.viewport.height;
      const capturedHeight = Math.min(pageHeight, request.fullPage ? request.maxPageHeightPx : request.viewport.height);
      const png = await capturePixels({ page, request, capturedHeight });
      if (png.byteLength > URL_CAPTURE_MAX_BYTES) throw new RenderServiceError({ code: 'load-failed', message: 'capture exceeds PNG byte limit' });
      return { png, finalUrl, title: page.getTitle().slice(0, 300), status: null, pageHeight, capturedHeight, blockedRequests };
    } });
  } catch (error) {
    if (error instanceof RenderServiceError) throw error;
    throw new RenderServiceError({ code: 'load-failed', message: 'native page capture failed' });
  }
}

/** Reveal lazy content with bounded scrolls, then charge the settle delay to the render deadline. */
async function settle({ page, request }: { page: ElectronWebContentsLike; request: UrlCaptureRequest }): Promise<void> {
  if (request.fullPage) await page.executeJavaScript!(`(async () => { const end = Math.min(document.documentElement.scrollHeight, ${request.maxPageHeightPx}); for (let y = 0; y < end; y += window.innerHeight) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 150)); } window.scrollTo({ top: 0, behavior: 'instant' }); })()`);
  await new Promise(resolve => setTimeout(resolve, request.settleMs));
}

/** Native capturePage for a viewport; CDP's native beyond-viewport capture for capped full pages. */
async function capturePixels({ page, request, capturedHeight }: { page: ElectronWebContentsLike; request: UrlCaptureRequest; capturedHeight: number }): Promise<Buffer> {
  if (!request.fullPage) return (await page.capturePage({})).toPNG();
  const result = await page.debugger!.sendCommand('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: request.viewport.width, height: capturedHeight, scale: 1 },
  }) as { data: string };
  return Buffer.from(result.data, 'base64');
}
