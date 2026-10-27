/** URL extension of RenderService: native Chromium, never a second browser installation.
 * Shares the existing render-window lifetime and two exclusive, memory-only capture sessions.
 */
import { RenderServiceError, withRenderTimeout } from '../render-service.js';
import { isCaptureUrlAllowed, readUrlCaptureRequest, URL_CAPTURE_MAX_BYTES, URL_CAPTURE_TIMEOUT_MS, type UrlCaptureRequest, type UrlCaptureResult } from '../url-capture.js';
import { withRenderWindow } from './render-window.js';
import type { ElectronBrowserWindowFactory, ElectronSessionLike, ElectronWebContentsLike } from './electron-surfaces.js';

// Electron retains partitions for the process lifetime. The leases must therefore span every
// render service/bridge in this process, without a per-site partition registry.
const captureSlots = [false, false];
const captureWaiters = new Set<(required: { slot: number }) => void>();
const CAPTURE_CLEANUP_TIMEOUT_MS = 1_000;

/** Lease a partition in arrival order, charging queued time to the caller's deadline.
 * Timed-out/aborted waiters are removed; a simultaneous handoff returns its lease.
 * @throws RenderServiceError on timeout/abort. @complexity O(1) time/space per waiter.
 */
async function acquireCaptureSlot({ deadline }: { deadline: number }, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<number> {
  if (signal?.aborted) throw new RenderServiceError({ code: 'aborted', message: 'render aborted before starting' });
  const slot = captureSlots.indexOf(false);
  if (slot >= 0) {
    captureSlots[slot] = true;
    return slot;
  }
  let assigned: number | undefined;
  let receive!: (required: { slot: number }) => void;
  const promise = new Promise<number>(resolve => {
    receive = ({ slot }, _options = {}) => { assigned = slot; resolve(slot); };
    captureWaiters.add(receive);
  });
  try {
    return await withRenderTimeout({ promise }, { timeoutMs: Math.max(0, deadline - Date.now()), signal });
  } catch (error) {
    if (assigned !== undefined) returnCaptureSlot({ slot: assigned });
    throw error;
  } finally { captureWaiters.delete(receive); }
}

/** Hand a clean partition straight to the oldest waiter, keeping it exclusive during handoff.
 * @complexity O(1) time/space; the Set preserves insertion order and supports cancellation.
 */
function returnCaptureSlot({ slot }: { slot: number }, _options = {}): void {
  const receive = captureWaiters.values().next().value;
  if (!receive) { captureSlots[slot] = false; return; }
  captureWaiters.delete(receive);
  receive({ slot });
}

/** Clear native credentials, storage and network state before reuse; failures deny capture.
 * @throws RenderServiceError if the host cannot reset a session. @complexity O(1) native calls.
 */
async function resetCaptureSession({ session }: { session: ElectronSessionLike }, _options = {}): Promise<void> {
  if (!session.clearStorageData || !session.clearCache || !session.clearAuthCache || !session.closeAllConnections) {
    throw new RenderServiceError({ code: 'not-implemented', message: 'native capture session cleanup unavailable' });
  }
  try {
    await session.closeAllConnections();
    await session.clearStorageData();
    await session.clearCache();
    await session.clearAuthCache();
  } catch {
    throw new RenderServiceError({ code: 'load-failed', message: 'native capture session cleanup failed' });
  }
}

export interface ElectronUrlCaptureOptions { allowedOrigins?: readonly string[]; signal?: AbortSignal }

/** Capture a validated own-origin page, bounded in time, CSS pixels and encoded PNG bytes.
 * The host factory denies popups, downloads and permissions on the private session.
 * FIFO lease waiting and rendering share one deadline; cleanup has its own bounded wait.
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
  const deadline = Date.now() + URL_CAPTURE_TIMEOUT_MS;
  const slot = await acquireCaptureSlot({ deadline }, { signal });
  let captureSession: ElectronSessionLike | undefined;
  let initialReset: Promise<void> | undefined;
  let blockedRequests = 0;
  const factory: ElectronBrowserWindowFactory = (required, options) => {
    const window = createBrowserWindow(required, { ...options, useContentSize: true,
      webPreferences: { ...options?.webPreferences, sandbox: true, nodeIntegration: false,
        contextIsolation: true, webSecurity: true, backgroundThrottling: false,
        partition: `jini-url-capture-${slot}` },
    });
    captureSession = window.webContents.session;
    return window;
  };
  try {
    if (Date.now() >= deadline) throw new RenderServiceError({ code: 'timeout', message: `render timed out after ${URL_CAPTURE_TIMEOUT_MS}ms` });
    return await withRenderWindow({ createBrowserWindow: factory, url: request.url,
      options: { viewport: request.viewport, timeoutMs: deadline - Date.now(), ...(signal ? { signal } : {}) },
      prepare: async window => {
        initialReset = resetCaptureSession({ session: window.webContents.session });
        await initialReset;
        if (window.isDestroyed()) return;
        // Electron can crash the main process if device emulation targets an unloaded webContents.
        // Bootstrap before the strict request policy; emulation still precedes site navigation.
        await window.loadURL({ url: 'about:blank' });
        if (window.isDestroyed()) return;
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
      const pageHeight = readPageHeight({ request, rawHeight });
      const capturedHeight = Math.min(pageHeight, request.fullPage ? request.maxPageHeightPx : request.viewport.height);
      const png = await capturePixels({ page, request, capturedHeight });
      if (png.byteLength > URL_CAPTURE_MAX_BYTES) throw new RenderServiceError({ code: 'load-failed', message: 'capture exceeds PNG byte limit' });
      return { png, finalUrl, title: page.getTitle().slice(0, 300), status: null, pageHeight, capturedHeight, blockedRequests };
    } });
  } catch (error) {
    if (error instanceof RenderServiceError) throw error;
    throw new RenderServiceError({ code: 'load-failed', message: 'native page capture failed' });
  } finally {
    // A stuck reset keeps its lease but must not hold the caller beyond the cleanup budget.
    // Cleanup must not replace a completed capture or its original error near the render deadline.
    await withRenderTimeout({ promise: releaseCaptureSlot({ slot, session: captureSession, initialReset }) },
      { timeoutMs: CAPTURE_CLEANUP_TIMEOUT_MS }).catch(() => {});
  }
}

/** Return a lease only once its session is reset; the next capture resets again before use.
 * @throws RenderServiceError when the reset fails (the lease is still returned). @complexity O(1).
 */
async function releaseCaptureSlot({ slot, session, initialReset }: {
  slot: number; session: ElectronSessionLike | undefined; initialReset: Promise<void> | undefined;
}, _options = {}): Promise<void> {
  try {
    // Destruction stops navigation first. A timed-out preparation must settle before its
    // cleanup or a new capture can touch the same session.
    await initialReset?.catch(() => {});
    if (session) {
      session.webRequest.onBeforeRequest({ listener: null });
      await resetCaptureSession({ session });
    }
  } finally {
    returnCaptureSlot({ slot });
  }
}

function readPageHeight({ request, rawHeight }: { request: UrlCaptureRequest; rawHeight: unknown }, _options = {}): number {
  return request.fullPage && typeof rawHeight === 'number' && Number.isFinite(rawHeight)
    ? Math.max(1, Math.ceil(rawHeight)) : request.viewport.height;
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
