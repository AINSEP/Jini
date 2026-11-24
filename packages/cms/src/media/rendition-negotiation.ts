/**
 * @file Framework-neutral negotiation helpers for the public media rendition route
 * (`GET /m/{assetId}/{transformName}.v{version}/{slug}.{ext}`, ADR-027 §4): the URL's transform-spec
 * parse, the `If-None-Match` comparison, and the `Cache-Control` choice. Pure functions over strings,
 * so any host can answer the same wire without a request object.
 */

const TRANSFORM_SPEC_PATTERN = /^(.+)\.v(\d+)$/;

/** The only `Cache-Control` the rendition routes' 404 (or a gated 200) may carry. Named, and written through a
 *  single host helper, because the 2026-09-05 oracle bug was precisely two
 *  404 call sites drifting apart on this header — a shared constant that two call sites still set
 *  independently would have drifted the same way. */
export const PRIVATE_NO_STORE = "private, no-store";

/** Replacement preserves ids and authored URLs, including their old source-hash query.
 *  Current and retired slugs can also resolve to changed bytes after replacement or name reuse.
 *  These routes always resolve the live source rather than a historical content snapshot, so
 *  even a matching `v` cannot promise immutable bytes. Limit reuse to sixty seconds;
 *  the existing ETag lets an unchanged asset return 304. Never used for a gated outcome. */
export const REVALIDATING_PUBLIC = "public, max-age=60";

/**
 * Parses and validates the `{transformName}.v{version}` path segment against `assetId`,
 * returning either the resolved fields or the one-of-two malformed-URL error messages the route
 * has always distinguished. Isolated from the handler so both validation branches (pattern match,
 * version range) live in one place instead of the caller's own complexity budget.
 *
 * @complexity O(1) — one regex match plus two range/shape checks.
 */
export function resolveRenditionTransformSpec({ assetId, transformSpec }: { assetId: string; transformSpec: string }, _optional = {}): { transformName: string; version: number } | { errorMessage: string } {
  const match = TRANSFORM_SPEC_PATTERN.exec(transformSpec);
  if (!assetId || !match) {
    return { errorMessage: "malformed media rendition URL" };
  }

  const [, transformName, versionText] = match;
  const version = Number(versionText);
  if (!Number.isInteger(version) || version < 1) {
    return { errorMessage: "malformed transform version" };
  }

  return { transformName: transformName as string, version };
}

/** GET validators use weak comparison and accept a list or wildcard, as If-None-Match requires.
 * @complexity O(v) in the number of listed validators. */
export function ifNoneMatchSatisfied({ header, etag }: { header: string | undefined; etag: string }, _optional = {}): boolean {
  return String(header ?? '').split(',').some(value => {
    const candidate = value.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
}

/** The `Cache-Control` for an ALLOWED 200 rendition. @complexity O(1). */
export function renditionCacheControl({ gated }: { gated: boolean }, _optional: Record<string, never> = {}): string {
  // `gated`: a gated asset's ALLOW outcome is per-viewer (it depended on this
  // request's session cookie), so it must never be handed the ungated,
  // shared/CDN-facing headers below — the next, possibly unentitled, visitor to hit a
  // public/shared cache would be served this same cached response.
  //
  // Ids, matching versions and editable/reusable slugs all serve the live source. Header
  // selection adds no reads; access evidence is refreshed within sixty seconds.
  if (gated) return PRIVATE_NO_STORE;
  return REVALIDATING_PUBLIC;
}
