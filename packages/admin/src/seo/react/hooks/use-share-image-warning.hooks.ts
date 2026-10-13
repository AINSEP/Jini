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
}, { t = key => key }: { t?: SeoTranslator | undefined } = {}): Pick<MediaRefFieldController, 'warning' | 'onPreviewLoad' | 'onPreviewError'> {
  const currentUrl = useRef(previewUrl);
  currentUrl.current = previewUrl;
  const [decoded, setDecoded] = useState<{ url: string; width?: number; height?: number; failed?: boolean } | null>(null);
  const [inspection, setInspection] = useState<{ url: string; byteSize?: number | null; error?: { key: string; vars?: Record<string, string | number> } } | null>(null);
  useEffect(() => {
    const inspect = api.inspectShareImage;
    if (!previewUrl || !inspect) return;
    // Browser origin, rather than the public site's alias: a cross-origin HEAD cannot establish
    // that an otherwise loadable external image is missing when the server omits CORS headers.
    const location = globalThis.location;
    if (!location) return;
    try {
      if (new URL(previewUrl, location.href).origin !== location.origin) return;
    } catch {
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => {
      active = false;
      controller.abort();
      setInspection({ url: previewUrl, error: { key: 'The share image check timed out after 10 seconds.' } });
    }, 10_000);
    inspect.call(api, { url: previewUrl }, { signal: controller.signal }).then(({ status, byteSize }) => {
      if (!active) return;
      if (status === 404 || status === 410) {
        setInspection({ url: previewUrl, error: { key: 'The share image is missing (HTTP {status}).', vars: { status } } });
      } else if (status < 200 || status >= 300) {
        setInspection({ url: previewUrl, error: { key: 'The share image could not be checked (HTTP {status}).', vars: { status } } });
      } else {
        setInspection({ url: previewUrl, byteSize });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      const detail = error instanceof Error ? error.message : String(error);
      setInspection({ url: previewUrl, error: { key: 'The share image could not be checked: {detail}', vars: { detail } } });
    }).finally(() => { clearTimeout(timeout); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [previewUrl, api]);
  const source = decoded?.url === previewUrl ? decoded : null;
  const checked = inspection?.url === previewUrl ? inspection : null;
  const error = checked?.error;
  return {
    warning: shareImageWarning({ value, previewUrl, width: source?.width, height: source?.height, previewFailed: source?.failed, byteSize: checked?.byteSize,
      error: error ? interpolate({ template: t(error.key, error.vars), vars: error.vars ?? {} }) : undefined }, { t }),
    onPreviewLoad: ({ currentTarget }) => {
      const url = currentTarget.getAttribute('src');
      if (url && url === currentUrl.current) setDecoded({ url, width: currentTarget.naturalWidth, height: currentTarget.naturalHeight });
    },
    onPreviewError: ({ currentTarget }) => {
      const url = currentTarget.getAttribute('src');
      if (url && url === currentUrl.current) setDecoded({ url, failed: true });
    },
  };
}
