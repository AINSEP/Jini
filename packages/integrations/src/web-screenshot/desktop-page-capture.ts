/** Map Jini's native render capability onto the existing screenshot port. The site/theme opener,
 * serialization, JPEG tiles and saved files remain owned by the screenshot feature.
 */
import type { PageCapture, PageCapturePort, PageCaptureRequest } from '@jini-ai/core/contracts/site/web-screenshot';
import { PageCaptureError } from './web-screenshot.js';

/** The slice of the desktop host's URL capture port this adapter drives (`UrlCapturePort` satisfies it). */
export interface NativeUrlCapture {
  captureUrl(
    required: Pick<PageCaptureRequest, 'url' | 'viewport' | 'fullPage' | 'maxPageHeightPx' | 'settleMs'>,
    options?: { signal?: AbortSignal },
  ): Promise<Omit<PageCapture, 'png'> & { png: Uint8Array }>;
}

/** The slice of the desktop host's render error this adapter reads. */
export interface NativeRenderError { code: string; message: string }

/** Recognises the desktop host's render error (the host binds it to `instanceof RenderServiceError`). */
export type IsNativeRenderError = (error: unknown) => error is NativeRenderError;

/** A native window is owned per request; closing this port has no shared browser to terminate.
 * @throws PageCaptureError for every expected native/transport failure.
 * @complexity O(pixels), bounded by Jini's capture contract.
 */
export function createDesktopPageCapture(
  { capture, isRenderServiceError }: { capture: NativeUrlCapture; isRenderServiceError: IsNativeRenderError },
  _options = {},
): PageCapturePort {
  return {
    async capture(request, { signal } = {}) {
      // Desktop's native channel is deliberately own-site only, including the ephemeral theme
      // render origin supplied by openOwnSite. A public-reference URL retains the clear refusal.
      if (!request.allowedOrigins.includes(new URL(request.url).origin)) {
        throw new PageCaptureError({ kind: 'refused', message: 'desktop capture requires sitePath on this site' });
      }
      if (request.dismissCookieBanners || typeof request.waitFor === 'string') {
        throw new PageCaptureError({ kind: 'failed', message: 'native capture does not support consent clicks or selector waits' });
      }
      try {
        const result = await capture.captureUrl({ url: request.url, viewport: request.viewport,
          fullPage: request.fullPage, maxPageHeightPx: request.maxPageHeightPx,
          settleMs: typeof request.waitFor === 'number' ? request.waitFor * 1000 : request.settleMs,
        }, signal ? { signal } : {});
        return { ...result, png: Buffer.from(result.png) };
      } catch (error) {
        throw nativeCaptureError({ error, isRenderServiceError });
      }
    },
    async close() {},
  };
}

function nativeCaptureError({ error, isRenderServiceError }: { error: unknown; isRenderServiceError: IsNativeRenderError }, _options = {}): PageCaptureError {
  if (!isRenderServiceError(error)) {
    return new PageCaptureError({ kind: 'failed', message: 'native capture failed' });
  }
  if (error.code === 'timeout' || error.code === 'aborted') {
    return new PageCaptureError({ kind: 'timeout', message: error.message });
  }
  const kind = error.code === 'navigation-blocked' ? 'refused' : 'failed';
  return new PageCaptureError({ kind, message: error.message });
}

// The host injects its Playwright adapter, its resolved native channel (or `null`) and its render-error check.
/** Both compiled serve and source-mode desktop use this same composition decision. No channel
 * means the existing Playwright adapter (and its unavailable-browser error) is unchanged.
 * @complexity O(1).
 */
export function createPageCaptureForHost(
  { playwright, nativeCapture, isRenderServiceError }: {
    playwright: PageCapturePort; nativeCapture: NativeUrlCapture | null; isRenderServiceError: IsNativeRenderError;
  },
  _optional = {},
): PageCapturePort {
  if (!nativeCapture) return playwright;
  const desktop = createDesktopPageCapture({ capture: nativeCapture, isRenderServiceError });
  return {
    capture(request, optional) {
      // Public references retain the guarded public browser. Explicit consent/selector interaction
      // also keeps its existing implementation; the native capability never broadens its policy.
      if (request.allowedOrigins.length === 0 || request.dismissCookieBanners || typeof request.waitFor === 'string') {
        return playwright.capture(request, optional);
      }
      return desktop.capture(request, optional);
    },
    async close() { await Promise.all([desktop.close(), playwright.close()]); },
  };
}
