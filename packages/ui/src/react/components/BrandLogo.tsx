// BrandLogo — a resilient brand/site logo with a fallback chain: a
// host-resolved brand-service URL (when a `brandId` + resolver are supplied),
// else an explicit `logoSrc`, else a favicon lookup for `host`, else a
// monogram initial. Each stage that fails to load (`onError`) advances to the
// next, so a broken brand-service image or a dead favicon never renders the
// browser's broken-image glyph.

import { useCallback, useEffect, useMemo, useState } from 'react';

export type LogoStage = 'brand' | 'custom' | 'favicon' | 'letter';

export interface BrandLogoProps {
  /** Opaque id resolved to a logo URL via `resolveBrandLogoUrl`, when supplied. */
  brandId?: string;
  logoSrc?: string | null;
  host?: string;
  name: string;
  faviconSize: number;
  className?: string;
  fallbackClassName?: string;
  /** Builds a logo URL for `brandId`. Omit to skip the brand-service stage entirely. */
  resolveBrandLogoUrl?: (brandId: string) => string;
  /** Builds a favicon URL for `host`. Defaults to Google's public favicon service. */
  resolveFaviconUrl?: (host: string, size: number) => string;
}

// ---------------------------------------------------------------------------
// Pure helpers — no React, directly unit-testable.
// ---------------------------------------------------------------------------

export function buildFaviconUrl(host: string, size: number): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/** The monogram shown when no image source is resolvable. */
export function brandMonogram(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/** The stage to start at, given which sources are available. */
export function firstLogoStage(opts: {
  canUseBrandStage: boolean;
  logoSrc?: string | null | undefined;
  host?: string | undefined;
}): LogoStage {
  if (opts.canUseBrandStage) return 'brand';
  return fallbackLogoStage(opts);
}

/** The first non-brand stage whose source is available. */
function fallbackLogoStage(opts: { logoSrc?: string | null | undefined; host?: string | undefined }): LogoStage {
  if (opts.logoSrc) return 'custom';
  return opts.host ? 'favicon' : 'letter';
}

/** The next stage to try after the current one fails to load. */
export function advanceLogoStage(
  stage: LogoStage,
  opts: { logoSrc?: string | null | undefined; host?: string | undefined },
): LogoStage {
  if (stage === 'brand') return fallbackLogoStage(opts);
  if (stage === 'custom') return 'favicon';
  return 'letter';
}

/** The image `src` for the current stage, or `null` when the letter fallback applies. */
export function resolveLogoSrc(opts: {
  stage: LogoStage;
  brandId?: string | undefined;
  resolveBrandLogoUrl?: ((brandId: string) => string) | undefined;
  logoSrc?: string | null | undefined;
  host?: string | undefined;
  faviconSize: number;
  resolveFaviconUrl: (host: string, size: number) => string;
}): string | null {
  const { stage, brandId, resolveBrandLogoUrl, logoSrc, host, faviconSize, resolveFaviconUrl } = opts;
  if (stage === 'brand' && brandId && resolveBrandLogoUrl) return resolveBrandLogoUrl(brandId);
  if (stage === 'custom' && logoSrc) return logoSrc;
  if (stage === 'favicon' && host) return resolveFaviconUrl(host, faviconSize);
  return null;
}

// ---------------------------------------------------------------------------
// Hooks — the load/fallback state machine, exported for isolated testing.
// ---------------------------------------------------------------------------

export interface UseLogoStageResult {
  stage: LogoStage;
  /** Advance to the next fallback stage (wired to the <img>'s onError). */
  fallback: () => void;
}

/**
 * Holds the current fallback stage. Resets to `first` whenever the resolvable
 * inputs change, and exposes `fallback` to advance one stage on load failure.
 */
export function useLogoStage(params: {
  first: LogoStage;
  logoSrc?: string | null | undefined;
  host?: string | undefined;
  canUseBrandStage: boolean;
}): UseLogoStageResult {
  const { first, logoSrc, host, canUseBrandStage } = params;
  const [stage, setStage] = useState<LogoStage>(first);
  useEffect(() => {
    setStage(first);
  }, [first, canUseBrandStage, logoSrc, host]);
  const fallback = useCallback(() => {
    setStage((current) => advanceLogoStage(current, { logoSrc, host }));
  }, [logoSrc, host]);
  return { stage, fallback };
}

/** Memoized image `src` for a stage; recomputes only when its inputs change. */
export function useResolvedLogoSrc(opts: {
  stage: LogoStage;
  brandId?: string | undefined;
  resolveBrandLogoUrl?: ((brandId: string) => string) | undefined;
  logoSrc?: string | null | undefined;
  host?: string | undefined;
  faviconSize: number;
  resolveFaviconUrl: (host: string, size: number) => string;
}): string | null {
  const { stage, brandId, resolveBrandLogoUrl, logoSrc, host, faviconSize, resolveFaviconUrl } = opts;
  return useMemo(
    () =>
      resolveLogoSrc({ stage, brandId, resolveBrandLogoUrl, logoSrc, host, faviconSize, resolveFaviconUrl }),
    [stage, brandId, resolveBrandLogoUrl, logoSrc, host, faviconSize, resolveFaviconUrl],
  );
}

export interface UseBrandLogoResult {
  /** The resolved image source, or `null` to render the monogram fallback. */
  src: string | null;
  /** Advance to the next fallback stage (wired to the <img>'s onError). */
  fallback: () => void;
}

/**
 * Composes the whole fallback chain — stage derivation, the load/fallback state
 * machine, and src resolution — so {@link BrandLogo} is a dumb render.
 */
export function useBrandLogo(props: BrandLogoProps): UseBrandLogoResult {
  const {
    brandId,
    logoSrc,
    host,
    faviconSize,
    resolveBrandLogoUrl,
    resolveFaviconUrl = buildFaviconUrl,
  } = props;
  const canUseBrandStage = Boolean(brandId && resolveBrandLogoUrl);
  const first = firstLogoStage({ canUseBrandStage, logoSrc, host });
  const { stage, fallback } = useLogoStage({ first, logoSrc, host, canUseBrandStage });
  const src = useResolvedLogoSrc({
    stage,
    brandId,
    resolveBrandLogoUrl,
    logoSrc,
    host,
    faviconSize,
    resolveFaviconUrl,
  });
  return { src, fallback };
}

// ---------------------------------------------------------------------------
// Component — dumb render, all logic delegated above.
// ---------------------------------------------------------------------------

export function BrandLogo(props: BrandLogoProps) {
  const { name, className, fallbackClassName } = props;
  const { src, fallback } = useBrandLogo(props);

  if (!src) {
    return (
      <span className={fallbackClassName} aria-hidden>
        {brandMonogram(name)}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={fallback}
    />
  );
}
