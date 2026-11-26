/**
 * @file Write-time normalisation of slug-only widget markers.
 *
 * `{"type":"widget","slug":"contact-form"}` is a valid, render-resolvable marker, but
 * `extractHtmlEntryRefs` is pure and cannot turn a slug into the `UUID` an `entry_refs` row needs,
 * so a page that embeds a widget ONLY by slug used to be invisible to where-used and safe-delete.
 * The fix is to give the marker its id when the HTML is SAVED: a host's page/content write calls
 * {@link normalizeWidgetSlugMarkers} before persisting and before re-extracting `entry_refs`, so the
 * stored marker carries `id` (authoritative) next to the author's `slug`, and the pure extractor
 * indexes it like any other id-carrying marker.
 */
import type { UUID } from "@jini-ai/core/primitives";
import type { EntryRepoPort } from "../entries/index.js";
import { embedMarkerTarget, scanEmbedMarkers, substituteMarkers, withAddedId, type EmbedMarker } from "./markers/marker.js";
import { WIDGET_CONTENT_TYPE } from "./types.js";

/** The one repo capability this needs: the same slug lookup render-time resolution uses. */
export type WidgetSlugLookupPort = Pick<EntryRepoPort, "findBySlug">;

export interface NormalizeWidgetSlugMarkersRequired {
  readonly deps: { readonly entryRepo: WidgetSlugLookupPort };
  readonly input: { readonly workspaceId: UUID; readonly html: string };
}

/** The slug of a widget marker that has no usable `id`, else `undefined`. Uses the shared target
 *  precedence so "has an id" means exactly what the scanner and resolver mean by it. @complexity O(1). */
function slugOnlyWidgetSlug(marker: EmbedMarker): string | undefined {
  if (marker.type.toLowerCase() !== WIDGET_CONTENT_TYPE) return undefined;
  const target = embedMarkerTarget({ type: marker.type, config: marker.config });
  return target?.key === "slug" ? target.value : undefined;
}

/**
 * Returns `html` with every slug-only widget marker rewritten to also carry the widget's `id`
 * (via `withAddedId`, which keeps the marker's tag, other attributes, other config keys and inner
 * content). One `findBySlug` per distinct slug, run concurrently.
 *
 * A slug with no matching widget leaves its marker exactly as authored and does not throw: the
 * author's text is never lost, and render still degrades it to the usual placeholder. Markers that
 * already carry an id, and every non-widget marker, are untouched. HTML with no slug-only widget
 * marker is returned unchanged (same string), so a caller's "identical HTML" short-circuit still holds.
 *
 * @complexity O(n) over `html` for the scan and splice, plus one lookup per distinct slug.
 */
export async function normalizeWidgetSlugMarkers(
  required: NormalizeWidgetSlugMarkersRequired,
  _optional: Record<string, never> = {},
): Promise<string> {
  const { deps, input } = required;
  const { markers } = scanEmbedMarkers({ html: input.html });
  const slugs = new Set(markers.map(slugOnlyWidgetSlug).filter((slug): slug is string => slug !== undefined));
  if (slugs.size === 0) return input.html;

  const idBySlug = new Map<string, UUID>();
  await Promise.all(
    Array.from(slugs).map(async (slug) => {
      const entry = await deps.entryRepo.findBySlug({ workspaceId: input.workspaceId, type: WIDGET_CONTENT_TYPE, slug });
      if (entry) idBySlug.set(slug, entry.id);
    }),
  );
  if (idBySlug.size === 0) return input.html;

  return substituteMarkers({
    html: input.html,
    resolve: (marker) => {
      const slug = slugOnlyWidgetSlug(marker);
      const id = slug === undefined ? undefined : idBySlug.get(slug);
      return id === undefined ? undefined : withAddedId({ marker, id });
    },
  });
}
