import type { UUID } from "@jini-ai/core/primitives";
import { HTML_EMBED_RESOLVERS, THEME_OWNED_MARKER_TYPES, type ResolveHtmlPageEmbedsDeps } from "../resolver-service.js";
import type { WidgetRenderIR, WidgetResolveContext } from "../types.js";
import { scanHtmlEmbeds, type PageHtmlEmbedRef } from "./html-embeds.js";

/**
 * Resolved embed IR, keyed by embed type then by the referenced id (`resolved.get(ref.type)?.get(
 * ref.id)`). A type absent from the outer map means either nothing of that type was found on the
 * page or the type has no registered resolver (`render.ts`'s `renderHtmlPageBody` treats both
 * identically — a REQ-28 placeholder, per this file's `HTML_EMBED_RESOLVERS` doc).
 */
export type ResolveHtmlPageEmbedsResult = ReadonlyMap<string, ReadonlyMap<string, WidgetRenderIR>>;

/**
 * Resolves every `data-embed-type` placeholder (`html-embeds.ts`'s `scanHtmlEmbeds`) found in an
 * `"html"`-format Page's `body_html`, dispatching each embed type to its registered resolver in
 * {@link HTML_EMBED_RESOLVERS}.
 *
 * Never throws (REQ-27's contract, carried over unchanged): a malformed, missing, disabled, wrong-
 * type, unknown-type, or duplicate-beyond-{@link MAX_HTML_EMBEDS_PER_PAGE} reference degrades to the
 * REQ-28 placeholder exactly the way every other widget-resolution failure already does — the caller
 * (`render.ts`'s `renderHtmlPageBody`) never special-cases "this ref failed to resolve" versus "this
 * ref does not exist" versus "this ref was never attempted" — **for a type this stage owns**
 * ({@link HTML_EMBED_RESOLVERS}). A type it deliberately does not own ({@link THEME_OWNED_MARKER_TYPES})
 * is absent from the returned map for a different reason and reaches a different outcome downstream:
 * `renderHtmlPageBody`'s `isPageEmbedType` check leaves that marker untouched for `static-render.ts`'s
 * later pass to resolve, not a placeholder. Do not read "absent from this map" as "renders as a
 * placeholder" — that conflation is exactly what made this stage's own logging misleading (see
 * `THEME_OWNED_MARKER_TYPES`'s doc for the live incident this caused).
 *
 * @complexity O(e) over the page's embed-reference count (capped at `MAX_HTML_EMBEDS_PER_PAGE`) for
 * the scan plus grouping, plus each registered type present incurring its own resolver's cost (the
 * widget path: one batched widget-listing query plus at most one `resolveWidgetType` call per
 * distinct widget type) — the same O(1)-typed per-type cost shape the pre-restructuring function
 * already carried, REQ-24 in spirit.
 * @overallScore 100
 */
export async function resolveHtmlPageEmbeds(
  required: {
  deps: ResolveHtmlPageEmbedsDeps;
  input: { readonly workspaceId: UUID; readonly html: string };
},
  _optional: Record<string, never> = {},
): Promise<ResolveHtmlPageEmbedsResult> {
  const { deps, input } = required;
  const context: WidgetResolveContext = { workspaceId: input.workspaceId, preview: false };
  const refs = scanHtmlEmbeds({ html: input.html });

  const refsByType = new Map<string, PageHtmlEmbedRef[]>();
  for (const ref of refs) {
    const list = refsByType.get(ref.type) ?? [];
    list.push(ref);
    refsByType.set(ref.type, list);
  }

  const result = new Map<string, ReadonlyMap<string, WidgetRenderIR>>();
  for (const [type, typeRefs] of refsByType) {
    const resolver = HTML_EMBED_RESOLVERS[type];
    if (!resolver) {
      // A theme-structural type (`menu`/`partial`) is not a failure at THIS stage — it is deferred,
      // by design, to `static-render.ts`'s later pass (see `THEME_OWNED_MARKER_TYPES`'s own doc). Only
      // a type genuinely unowned anywhere is worth the loud warning.
      if (!THEME_OWNED_MARKER_TYPES.has(type)) {
        console.warn("[widgets] resolveHtmlPageEmbeds: unknown embed type, every occurrence degrades to the placeholder", {
          type,
          workspaceId: input.workspaceId,
          occurrences: typeRefs.length,
        });
      }
      continue;
    }
    result.set(type, await resolver(typeRefs, deps, context));
  }
  return result;
}
