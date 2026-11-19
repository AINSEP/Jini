import { markersOfType, substituteMarkers, withInnerContentFinal, type EmbedMarker } from "./markers/marker.js";

/**
 * Guard 3 of the unified-content-marker design (`ADS-memory/reports/design/
 * 2026-08-11-unified-content-marker-and-templates.md`) — bounds BOTH how deep a chain of
 * `"html"`-format `content` embeds may recurse and how many distinct entities may be fetched across
 * the whole recursive resolution, so a self-referencing body (A embeds A) or a mutually-referencing
 * one (A embeds B embeds A) TERMINATES instead of hanging, and a wide, adversarially-branching chain
 * cannot fan out into an unbounded number of DB round trips either. `MAX_HTML_EMBEDS_PER_PAGE` (the
 * existing precedent, `html/html-embeds.ts`) is a per-page COUNT and does not, by itself, bound a
 * CYCLE — a page can legally contain the same single marker that, once resolved, contains another
 * one referencing back, which no per-page count alone stops. Depth AND a total-fetch budget together
 * do: depth alone is sufficient for a SIMPLE cycle (bounded steps regardless of shape), and the
 * shared budget additionally caps the WORST-CASE adversarial branching case (many distinct ids at
 * every level) to a fixed number of fetches instead of depth^branching-factor.
 */
export const MAX_CONTENT_EMBED_DEPTH = 5;

/** Total distinct entities this function will ever fetch across one full recursive resolution — see
 * {@link MAX_CONTENT_EMBED_DEPTH}'s doc for why depth alone does not bound adversarial branching. */
export const MAX_CONTENT_EMBED_FETCHES = 50;

/** A `{"type":"content"}` marker's authored `slug`, or `undefined` when absent/non-string/empty —
 * the marker-scan-side counterpart to `resolver-service.ts`'s `normalizeEmbedSlug`, needed here
 * because `EmbedMarker` (this file's `markersOfType`) projects only `id` as a top-level field; `slug`
 * lives in `marker.config` alongside every other authored key. */
function slugOf(marker: EmbedMarker): string | undefined {
  const slug = marker.config.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

/** A `{"type":"content"}` marker's resolution key for {@link resolveHtmlFormatContentMarkers} — `id`
 * when the marker carries one, else its own `slug` (S3, 2026-09-23 widget-attrs plan: the same
 * id-authoritative-when-present order `resolver-service.ts`'s `findPublishedPostByRef` uses for the
 * later registry-resolver stage). `undefined` for a marker with neither key — nothing here to key a
 * replacement by, same as the pre-existing `id === undefined` skip this generalizes. */
function contentMarkerKey(marker: EmbedMarker): string | undefined {
  return marker.id ?? slugOf(marker);
}

/** One `{"type":"content"}` marker's id-or-slug reference — a discriminated union, not two optional
 * fields, so the id-authoritative-when-present rule (`id` tried first, `slug` consulted only for a
 * ref with none — the identical order `resolver-service.ts`'s `findPublishedPostByRef` uses) is
 * enforced by the TYPE: {@link fetchHtmlFormatBody} branches on `by` and gets a real `string` on
 * either side, no non-null assertion and no way for the two fields to silently drift out of sync. */
export type ContentMarkerRef = { readonly key: string; readonly by: "id"; readonly id: string } | { readonly key: string; readonly by: "slug"; readonly slug: string };

function toContentMarkerRef(marker: EmbedMarker): ContentMarkerRef | undefined {
  if (marker.id !== undefined) return { key: marker.id, by: "id", id: marker.id };
  const slug = slugOf(marker);
  return slug === undefined ? undefined : { key: slug, by: "slug", slug };
}

/** Every DISTINCT `{"type":"content"}` reference in `html`, deduped by {@link ContentMarkerRef.key}
 * — the direct generalization of the pre-existing `[...new Set(markersOfType(...).map(id))]` dedup to
 * also cover a slug-only marker. Preserves that dedup's own guarantee (one fetch per distinct
 * reference, first-occurrence order) for the id-only case unchanged, which is what guard 3's own
 * fetch-count tests pin. */
function distinctContentMarkerRefs({ html }: { html: string }, _optional = {}): ContentMarkerRef[] {
  const seen = new Map<string, ContentMarkerRef>();
  for (const marker of markersOfType({ html: html, type: "content" })) {
    const ref = toContentMarkerRef(marker);
    if (ref !== undefined && !seen.has(ref.key)) seen.set(ref.key, ref);
  }
  return [...seen.values()];
}

export interface ContentMarkerPorts {
  readonly readPublishedHtml: (required: { ref: ContentMarkerRef }) => Promise<string | undefined>;
  readonly renderEmbeds: (required: { html: string }) => Promise<string>;
}

/** Resolves one reference's own html-format body — `id` authoritative when present, `slug`
 * consulted only for a ref with none — mirroring {@link resolveHtmlFormatContentMarkers}'s
 * pre-existing id-only branch. `undefined` means "leave this reference for the final
 * `resolveHtmlPageEmbeds` pass": missing, unpublished (guard 2), or `"doc"`-format — a `"doc"`-format
 * target has nothing here to recurse into, and an unresolved reference degrades to the same REQ-28
 * placeholder that pass already produces for any other miss.
 */
async function fetchHtmlFormatBody({ ports, ref }: { ports: ContentMarkerPorts; ref: ContentMarkerRef }, { pendingHtmlOverride }: { pendingHtmlOverride?: { id: string; slug: string; bodyHtml: string } | undefined } = {}): Promise<string | undefined> {
  // Page HTML is spliced unmodified: only authorized page editors write it and its inline scripts
  // are part of the page (host authorization). Sanitizing here
  // stripped carousel scripts and icons (owner report, 2026-10-12).
  if (pendingHtmlOverride && (ref.by === "id" ? ref.id === pendingHtmlOverride.id : ref.slug === pendingHtmlOverride.slug)) {
    return pendingHtmlOverride.bodyHtml;
  }
  return ports.readPublishedHtml({ ref });
}

/**
 * Recursively resolves every `{"type":"content","id":...}` marker in `html` whose target is an
 * `"html"`-format entity: fetches the entity (visibility-filtered — guard 2), resolves ITS OWN
 * embeds (every type, including further `content` markers, via a nested call to this same function
 * plus `resolveHtmlPageEmbeds`), splices the fully-rendered result into `html` in place of the
 * marker, and repeats until no `"html"`-format `content` markers remain or the depth/budget guard
 * (above) stops it.
 *
 * A `"doc"`-format target is left as an ordinary id-carrying marker for `resolveHtmlPageEmbeds`'s
 * registered `"content"` resolver to handle in the FINAL pass the caller runs afterward — a TipTap
 * document has no markers of its own to recurse into, and rendering it needs `renderDocNode`, which
 * the host renderer has in scope (this module must stay free of that dependency, same as every other
 * I/O-orchestration function in this file).
 *
 * The host's `renderEmbeds` port legitimately needs BOTH `resolveHtmlPageEmbeds` (resolves
 * IDs to data) AND `renderHtmlPageBody` (splices IR into HTML) for the SAME nested string — those two
 * modules must not depend on each other (`render.ts` already depends on `resolver-service.ts`; the
 * reverse would be circular), so the host, which already imports both, orchestrates
 * the resolve-then-splice-then-rescan loop this recursion needs.
 *
 * Uses {@link withInnerContentFinal}, not `withInnerContent`, for the final splice: an ordinary
 * `withInnerContent` call would leave `data-embed-config` intact on the rebuilt element, and the
 * CALLER's later `resolveHtmlPageEmbeds`/`renderHtmlPageBody` pass would then rediscover it as a
 * fresh, unresolved marker and try to resolve it again — `withInnerContentFinal` strips the marker
 * attribute so the already-rendered result is inert to any later scan.
 *
 * `pendingHtmlOverride` (2026-09-09, `bodyHtml` half of the template-preview pending-body fix —
 * {@link resolveContentTypeEmbeds}'s sibling `pendingContentOverride` already does this for a
 * `"doc"`-format body's `bodyJson`, but that override is only checked by the LATER
 * `resolveHtmlPageEmbeds` pass, which this `"html"`-format pass runs strictly before and never
 * reaches for an id this pass already consumed). Checked BEFORE {@link findPublishedPostById} for a
 * matching id — or, for a slug-only ref, a matching `slug` (review of S3, 2026-09-23; never by slug
 * for a ref carrying an id) — same order `pendingContentOverride` uses and for the same reason: an authenticated,
 * `content.read`-authorized caller (the host template-preview route) previewing their own
 * unsaved edit to a row they already fetched by id should see that pending body, whether the row is
 * published or not — this is the one bypass of `findPublishedPostById`'s visibility guard, scoped to
 * exactly the ONE id the caller resolved and authorized, never a caller-supplied id. Only ever
 * consulted at the id being matched — the RECURSIVE call one line below (into a matched entity's OWN
 * nested markers) never passes it along, so a distinct nested entity embedded inside the previewed
 * body still resolves through the normal visibility-gated fetch; the override cannot leak past the
 * one id it was built for. `undefined` (every pre-existing call site) is byte-for-byte unchanged from
 * before this parameter existed.
 *
 * @complexity Bounded by {@link MAX_CONTENT_EMBED_FETCHES} total `findPublishedPostById` calls across
 * the whole call tree (the `budget` object is a single mutable counter threaded through every
 * recursive call), each followed by an O(n) `resolveHtmlPageEmbeds`/`renderHtmlPageBody` pass over
 * that one fetched entity's own body length. Never unbounded, regardless of the input's shape.
 *
 * Exported for direct testing of guard 3's termination property (`__tests__/content-markers.test.ts`)
 * — the testability seam this function's own dependency shape
 * ({@link ContentMarkerPorts}) was narrowed for.
 */
export async function resolveHtmlFormatContentMarkers({ ports, html, depth, budget }: { ports: ContentMarkerPorts; html: string; depth: number; budget: { remaining: number } }, { pendingHtmlOverride }: { pendingHtmlOverride?: { id: string; slug: string; bodyHtml: string } | undefined } = {}): Promise<string> {
  if (depth >= MAX_CONTENT_EMBED_DEPTH || budget.remaining <= 0) return html;

  const refs = distinctContentMarkerRefs({ html });
  if (refs.length === 0) return html;
  const refsToFetch = refs.slice(0, budget.remaining);
  budget.remaining -= refsToFetch.length;

  const replacements = new Map<string, string>();
  await Promise.all(
    refsToFetch.map(async (ref) => {
      const ownBody = await fetchHtmlFormatBody({ ports, ref }, { pendingHtmlOverride });
      if (ownBody === undefined) return;
      // No `pendingHtmlOverride` threaded into this recursive call — see this function's own doc on
      // why the override must never follow into a nested entity's own embeds.
      const nestedHtml = await resolveHtmlFormatContentMarkers({ ports, html: ownBody, depth: depth + 1, budget });
      replacements.set(ref.key, await ports.renderEmbeds({ html: nestedHtml }));
    })
  );
  if (replacements.size === 0) return html;

  return substituteMarkers({ html: html, resolve: (marker) => {
    if (marker.type !== "content") return undefined;
    const key = contentMarkerKey(marker);
    const replacement = key === undefined ? undefined : replacements.get(key);
    return replacement === undefined ? undefined : withInnerContentFinal({ marker: marker, inner: replacement });
  } });
}
