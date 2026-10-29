import { useEffect, useRef, useState } from 'react';
import { interpolate } from '@jini-ai/ui/i18n';
import type { AdminSeoPort } from '../../ports.js';
import { shareImageWarning } from '../../rules.js';
import type { MediaRefFieldController, SeoTranslator } from '../../models.js';

/** Probe original file size through the host port; decoded dimensions come from the existing preview.
 * Unknown size is not zero. URL-keyed state and cancellation prevent a prior choice's response
 * or image event from warning against the current selection. The probe has a 10-second bound.
 * External HEAD responses need CORS, so only same-origin files are probed; decoded previews
 * still report external loading failures and known dimensions. HTTP copy is translated at render.
 * @param required Controlled reference, source preview URL and injected SEO API.
 * @returns Non-blocking warning and the preview's native load/error handlers.
 * @complexity O(1) state and one HEAD per selection; no image bytes are downloaded by the probe.
 */
export function useShareImageWarning({ value, previewUrl, api }: {
  value: string; previewUrl: string | null; api: AdminSeoPort;
}, { t = key => key }: { t?: SeoTranslator | undefined } = {}): Pick<MediaRefFieldController, 'warning' | 'onPreviewLoad' | 'onPreviewError'> & { naturalWidth?: number | undefined; naturalHeight?: number | undefined } {
  const currentUrl = useRef(previewUrl);
  currentUrl.current = previewUrl;
  const [decoded, setDecoded] = useState<{ url: string; width?: number; height?: number; failed?: boolean } | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  useEffect(() => {
    const inspect = api.inspectShareImage;
    if (!previewUrl || !inspect || !isBrowserSameOrigin({ url: previewUrl })) return undefined;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => {
      active = false;
      controller.abort();
      setInspection({ url: previewUrl, error: { key: 'The share image check timed out after 10 seconds.' } });
    }, 10_000);
    inspect.call(api, { url: previewUrl }, { signal: controller.signal }).then(({ status, byteSize }) => {
      if (active) setInspection(inspectionFromResponse({ url: previewUrl, status, byteSize }));
    }).catch((error: unknown) => {
      if (!active) return;
      const detail = error instanceof Error ? error.message : String(error);
      setInspection({ url: previewUrl, error: { key: 'The share image could not be checked: {detail}', vars: { detail } } });
    }).finally(() => { clearTimeout(timeout); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [previewUrl, api]);
  const source = stateForUrl({ state: decoded, url: previewUrl });
  const checked = stateForUrl({ state: inspection, url: previewUrl });
  return {
    naturalWidth: source.width, naturalHeight: source.height,
    warning: shareImageWarning({ value, previewUrl, width: source.width, height: source.height, previewFailed: source.failed, byteSize: checked.byteSize,
      error: translatedInspectionError({ error: checked.error }, { t }) }, { t }),
    onPreviewLoad: ({ currentTarget }) => {
      const url = currentPreviewSrc({ image: currentTarget, currentUrl: currentUrl.current });
      if (url) setDecoded({ url, width: currentTarget.naturalWidth, height: currentTarget.naturalHeight });
    },
    onPreviewError: ({ currentTarget }) => {
      const url = currentPreviewSrc({ image: currentTarget, currentUrl: currentUrl.current });
      if (url) setDecoded({ url, failed: true });
    },
  };
}

/** URL-keyed state for the current preview only; a prior choice's state reads as nothing known. */
function stateForUrl<S extends { url: string }>({ state, url }: { state: S | null; url: string | null }, _optional: Record<string, never> = {}): Partial<S> {
  return state?.url === url ? state : {};
}

type InspectionError = { key: string; vars?: Record<string, string | number> };
type Inspection = { url: string; byteSize?: number | null; error?: InspectionError };

/** Whether `url` resolves to the browser's own origin; `false` outside a browser or for an unparseable URL. */
function isBrowserSameOrigin({ url }: { url: string }, _optional: Record<string, never> = {}): boolean {
  // Browser origin, rather than the public site's alias: a cross-origin HEAD cannot establish
  // that an otherwise loadable external image is missing when the server omits CORS headers.
  const location = globalThis.location;
  if (!location) return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** A HEAD response as inspection state: 404/410 is a missing file, any other non-2xx an unchecked
 * one, and a 2xx carries the reported byte size. */
function inspectionFromResponse({ url, status, byteSize }: { url: string; status: number; byteSize: number | null }, _optional: Record<string, never> = {}): Inspection {
  if (status === 404 || status === 410) return { url, error: { key: 'The share image is missing (HTTP {status}).', vars: { status } } };
  if (status < 200 || status >= 300) return { url, error: { key: 'The share image could not be checked (HTTP {status}).', vars: { status } } };
  return { url, byteSize };
}

/** The inspection error's copy, translated at render so a language switch re-renders it. */
function translatedInspectionError({ error }: { error: InspectionError | undefined }, { t }: { t: SeoTranslator }): string | undefined {
  return error ? interpolate({ template: t(error.key, error.vars), vars: error.vars ?? {} }) : undefined;
}

/** The preview image's `src` when it is still the current selection's; `null` for a stale event. */
function currentPreviewSrc({ image, currentUrl }: { image: HTMLImageElement; currentUrl: string | null }, _optional: Record<string, never> = {}): string | null {
  const url = image.getAttribute('src');
  return url && url === currentUrl ? url : null;
}
