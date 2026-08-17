// Load real typefaces so brand-kit typography specimens render for real:
// append any Google Fonts stylesheets the kit declares, and (when a host
// supplies `resolveProjectAssetUrl`) inject self-hosted `@font-face` rules
// from the project's own font-manifest asset. Both are best-effort and torn
// down on change. Not tied to any one feature domain — feature-local hooks
// live inside their own `features/<domain>/react/hooks/` instead.
import { useEffect, useMemo } from 'react';
import { FETCH_TIMEOUT_MS, fetchWithTimeout } from '@jini-ai/platform/fetch-with-timeout';

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
  /**
   * Builds the URL for a project asset path (e.g. `fonts/manifest.json`).
   * Omit to skip the self-hosted-font-manifest stage entirely — this hook
   * never hardcodes a font-service URL of its own.
   */
  resolveProjectAssetUrl?: (projectId: string, path: string) => string;
}

export function useBrandFonts(
  projectId: string | undefined,
  fonts: { googleFontsUrl?: string }[],
  options: UseBrandFontsOptions = {},
): void {
  const { resolveProjectAssetUrl } = options;

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
  }, [googleUrls]);

  useEffect(() => {
    if (!projectId || !resolveProjectAssetUrl) return;
    let cancelled = false;
    let styleEl: HTMLStyleElement | null = null;
    void (async () => {
      try {
        const resp = await fetchWithTimeout(
          resolveProjectAssetUrl(projectId, 'fonts/manifest.json'),
          { cache: 'no-store' },
          { timeoutMs: FETCH_TIMEOUT_MS.QUICK },
        );
        if (!resp.ok) return;
        const data = (await resp.json()) as BrandFontManifest;
        const files = Array.isArray(data?.files) ? data.files : [];
        if (cancelled || files.length === 0) return;
        const css = files
          .map((f) => {
            const url = resolveProjectAssetUrl(projectId, `fonts/${f.file}`);
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
  }, [projectId, resolveProjectAssetUrl]);
}
