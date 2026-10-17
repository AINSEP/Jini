/** Bounded URL-capture contract shared by the native renderer and its private transport. */
import { RenderServiceError } from './render-service.js';

export const URL_CAPTURE_TIMEOUT_MS = 20_000;
export const URL_CAPTURE_MAX_BYTES = 16 * 1024 * 1024;

export interface UrlCaptureRequest {
  url: string;
  viewport: { width: number; height: number; deviceScaleFactor?: number; isMobile?: boolean };
  fullPage: boolean;
  maxPageHeightPx: number;
  settleMs: number;
}
export interface UrlCaptureResult {
  png: Uint8Array;
  finalUrl: string;
  title: string;
  status: number | null;
  pageHeight: number;
  capturedHeight: number;
  blockedRequests: number;
}
export interface UrlCapturePort {
  captureUrl(required: UrlCaptureRequest, options?: { signal?: AbortSignal }): Promise<UrlCaptureResult>;
}

/** Exact HTTP(S) origins only: redirects, subresources and WebSockets use this same decision.
 * @complexity O(n), for the small host-owned origin allowlist.
 */
export function isCaptureUrlAllowed({ url, allowedOrigins }: { url: string; allowedOrigins: readonly string[] }, _options = {}): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && allowedOrigins.includes(parsed.origin);
  } catch { return false; }
}

/** Parse the wire request before allocating a renderer; reject oversized images and waits.
 * @throws RenderServiceError for invalid input. @complexity O(url length).
 */
export function readUrlCaptureRequest({ value }: { value: unknown }, _options = {}): UrlCaptureRequest {
  const request = value as Partial<UrlCaptureRequest> | null;
  const viewport = request?.viewport;
  const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  if (!request || typeof request.url !== 'string' || request.url.length > 2048 || !viewport
    || !integer(viewport.width, 1, 1280) || !integer(viewport.height, 1, 1024)
    || ![undefined, 1, 2].includes(viewport.deviceScaleFactor)
    || ![undefined, true, false].includes(viewport.isMobile)
    || typeof request.fullPage !== 'boolean' || !integer(request.maxPageHeightPx, 1, 8000)
    || !integer(request.settleMs, 0, 5000)) {
    throw new RenderServiceError({ code: 'load-failed', message: 'invalid capture request' });
  }
  return { url: request.url, viewport: { ...viewport }, fullPage: request.fullPage,
    maxPageHeightPx: request.maxPageHeightPx!, settleMs: request.settleMs! };
}
