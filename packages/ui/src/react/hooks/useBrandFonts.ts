// Load real typefaces so brand-kit typography specimens render for real:
// append any Google Fonts stylesheets the kit declares, and (when a host
// supplies `resolveProjectAssetUrl`) inject self-hosted `@font-face` rules
// from the project's own font-manifest asset. Both are best-effort and torn
// down on change. Not tied to any one feature domain — feature-local hooks
// live inside their own `features/<domain>/react/hooks/` instead.
import { useEffect, useMemo } from 'react';
import { requestWithTimeout } from '../../utils/browser-request.js';

export interface BrandFontManifestFile {
  family: string;
  weight: string;
  style: string;
  file: string;
  format: string;
}

export interface BrandFontManifest {
  files?: BrandFontManifestFile[];
}

export interface UseBrandFontsOptions {
  projectId?: string;
  /**
   * Builds the URL for a project asset path (e.g. `fonts/manifest.json`).
   * Omit to skip the self-hosted-font-manifest stage entirely — this hook
   * never hardcodes a font-service URL of its own.
   */
  resolveProjectAssetUrl?: (requiredArgs: { projectId: string; path: string }) => string;
  manifest?: BrandFontManifestPort;
  /** Native fetch port used by the default manifest loader. */
  fetch?: typeof globalThis.fetch;
  document?: Document;
}

export interface BrandFontManifestPort {
  load(requiredArgs: { url: string }): Promise<Pick<Response, 'ok' | 'json'>>;
}

export function useBrandFonts(
  { fonts }: { fonts: { googleFontsUrl?: string }[] },
  options: UseBrandFontsOptions = {},
): void {
  const { projectId, resolveProjectAssetUrl, fetch, manifest: suppliedManifest } = options;
  const manifest = useMemo<BrandFontManifestPort>(() => suppliedManifest ?? {
    load: ({ url }) => requestWithTimeout({ url, timeoutMs: 15_000 }, { ...(fetch === undefined ? {} : { fetch }), init: { cache: 'no-store' } }),
  }, [suppliedManifest, fetch]);
  const document = options.document ?? globalThis.document;

  const googleUrls = useMemo(() => {
    const urls = fonts
      .map((f) => f.googleFontsUrl)
      .filter((u): u is string => Boolean(u && /^https:\/\/fonts\.googleapis\.com\//i.test(u)));
    return Array.from(new Set(urls));
  }, [fonts]);

  useEffect(() => {
    const links = googleUrls.map((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    return () => {
      for (const link of links) link.remove();
    };
  }, [googleUrls, document]);

  useEffect(() => {
    if (!projectId || !resolveProjectAssetUrl) return;
    let cancelled = false;
    let styleEl: HTMLStyleElement | null = null;
    void (async () => {
      try {
        const resp = await manifest.load({ url: resolveProjectAssetUrl({ projectId, path: 'fonts/manifest.json' }) });
        if (!resp.ok) return;
        const data = (await resp.json()) as BrandFontManifest;
        const files = Array.isArray(data?.files) ? data.files : [];
        if (cancelled || files.length === 0) return;
        const css = files
          .map((f) => {
            const url = resolveProjectAssetUrl({ projectId, path: `fonts/${f.file}` });
            return [
              '@font-face {',
              `  font-family: '${f.family.replace(/'/g, '')}';`,
              `  src: url('${url}') format('${f.format}');`,
              `  font-weight: ${f.weight};`,
              `  font-style: ${f.style};`,
              '  font-display: swap;',
              '}',
            ].join('\n');
          })
          .join('\n');
        styleEl = document.createElement('style');
        styleEl.dataset.brandFonts = projectId;
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
      } catch {
        // A missing/malformed manifest is expected for some systems.
      }
    })();
    return () => {
      cancelled = true;
      if (styleEl) styleEl.remove();
    };
  }, [projectId, resolveProjectAssetUrl, manifest, document]);
}
