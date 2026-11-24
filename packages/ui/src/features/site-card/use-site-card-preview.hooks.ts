/**
 * @file A site card's preview image: which URL to show, and the placeholder when there is none.
 *
 * The host's listing snapshot carries only a version token per site (`previewVersions`), never the
 * bytes; the image is fetched by the browser itself from a URL that embeds that version, so a
 * repeated listing poll re-renders the same `src` and costs no request, and a new capture is a new
 * URL. The host's server decides when to capture, and the host builds the address (`urlFor`): this
 * feature never knows the host's routes or workspace layout.
 */
import { useCallback, useState } from "react";

/** The one field of a listed site the preview reads. */
export interface SiteCardPreviewSite {
  name: string;
}

/** The one field of the host's listing snapshot the preview reads. */
export interface SiteCardPreviewSnapshot {
  /** Capture version per site name; absent from an older server, missing for a never-captured site. */
  previewVersions?: Record<string, number>;
}

/** Host-built address of a site's captured preview at one version. */
export type SiteCardPreviewUrl = (args: { name: string; version: number }) => string;

export interface SiteCardPreviewView {
  /** The image to show, or `null` for the placeholder (no capture yet, or an older server). */
  src: string | null;
}

export interface SiteCardPreviewArgs {
  site: SiteCardPreviewSite;
  snapshot: SiteCardPreviewSnapshot;
  /** Injected by the host: the preview address for a site name and capture version. */
  urlFor: SiteCardPreviewUrl;
}

/**
 * Pure: the card preview for `site` from the listing's version tokens.
 * @complexity O(1).
 */
export function resolveSiteCardPreview(
  { site, snapshot, urlFor }: SiteCardPreviewArgs,
  _optional: Record<string, never> = {},
): SiteCardPreviewView {
  const version = snapshot.previewVersions?.[site.name];
  return { src: version === undefined ? null : urlFor({ name: site.name, version }) };
}

/**
 * {@link resolveSiteCardPreview} plus the one piece of state it needs: an image URL that failed to
 * load falls back to the placeholder until a new capture changes the URL, so a broken or deleted
 * file never leaves the browser's broken-image glyph on a card.
 * @complexity O(1) per render.
 */
export function useSiteCardPreview(
  required: SiteCardPreviewArgs,
  _optional: Record<string, never> = {},
): SiteCardPreviewView & { onError: () => void } {
  const view = resolveSiteCardPreview(required);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const onError = useCallback(() => setFailedSrc(view.src), [view.src]);
  return { src: view.src === failedSrc ? null : view.src, onError };
}
