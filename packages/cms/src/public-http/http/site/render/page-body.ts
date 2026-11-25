import type { WidgetRenderIR } from "../../../../widgets/index.js";
import type { ResolveHtmlPageEmbedsResult, PluginExportRender } from "../../../../widgets/html/index.js";
import type { PublicPostRecord as PostRecord } from "../../../../posts/post.js";
import { substituteHtmlEmbeds, type PageHtmlEmbedRef, type EmbedOccurrence } from "../../../../widgets/html/html-embeds.js";
import { isPageEmbedType } from "../../../../widgets/page-embed-types.js";
import { readMediaAssetMetadata, readMediaTransformVersions } from "./widgets/post-content.js";
import { projectPostBody } from "../../../../media/cover-image.js";
import type { JsonValue } from "@jini-ai/core/primitives";

/** REQ-28-shaped default for an embed reference this render never resolved (never attempted, beyond
 * `MAX_HTML_EMBEDS_PER_PAGE`, or a genuine resolution failure) — see `html-embeds.ts`'s
 * `substituteHtmlEmbeds` doc for why no caller needs to distinguish those cases. */
const HTML_EMBED_PLACEHOLDER_IR: WidgetRenderIR = { componentId: "widget-placeholder", props: {} };

/**
 * Substitutes every embed marker THIS STAGE OWNS in an `"html"`-format Page's `bodyHtml` with its
 * resolved markup (SPEC-047 Slice 2, generalized 2026-08-07). Pure — `resolved` is the already-
 * batch-loaded, type-then-id-keyed result of `resolver-service.ts`'s `resolveHtmlPageEmbeds`,
 * computed by the caller (a route handler) ahead of `renderSite`, the same "resolved data in, HTML
 * out" discipline this file's own header states for every other widget-shaped render path here.
 *
 * Within an owned type, `resolved` being `undefined` (no pre-existing caller of `renderSite` passes
 * `pageHtmlEmbeds`), that type having no entry in `resolved`, or a ref having neither a usable `id`
 * NOR `slug` (missing or invalid keys) all degrade identically: widgets contribute nothing; other
 * owned types use the public-safe REQ-28 marker —
 * this function never distinguishes "unresolved" from "unresolvable" from "never attempted", never a
 * crash and never literal, unresolved marker markup reaching a visitor.
 *
 * **Lookup key, 2026-08-31:** `ref.id ?? ref.slug` — `resolveHtmlPageEmbeds`'s per-type resolvers key
 * their returned map by whichever of the two the AUTHORED marker actually carried (never by an id a
 * slug resolved to internally, which this function has no way to know), so the lookup here must use
 * the same key. `ref.id` still wins when both are present, since a slug-only ref never reaches this
 * fallback in the first place ({@link PageHtmlEmbedRef}'s own doc). A type whose resolver never
 * consults `slug` (every type but `widget` today) simply never populates a slug-keyed entry, so this
 * widened lookup is a no-op for them — `undefined ?? null` still misses, same placeholder as before.
 *
 * A marker of an UNOWNED type is a different case and gets the opposite treatment: untouched. Since
 * the 2026-08-10 marker unification every consumer shares one permissive parser, so this stage now
 * sees a theme's `partial` and `menu` markers, which `static-render.ts` resolves AFTER this runs
 * (`pages.ts`'s `renderViaTemplate` calls this, then `renderStaticPage`). Treating those as
 * unknown-and-therefore-placeholder replaced the nav, the docs sidebar menu, and the footer of every
 * post rendered through a theme template with an empty widget placeholder — a page that still looked
 * plausible, which is what made it worth encoding the rule rather than remembering it. See
 * `isPageEmbedType`'s own doc for why ownership is asked of the resolver registry and not inferred
 * from whether resolution produced anything.
 *
 * `options.postAuthor` is supplied by static post routes. Only that entity's content header gets
 * its byline, selected through the theme's author injector; an authored marker/token elsewhere
 * suppresses the automatic credit. The third options object preserves the existing two-argument API.
 *
 * @complexity O(n) time/output space over `html`'s length (author scan plus substitution); O(1) additional work per marker (an
 * ownership check plus two map lookups plus `renderWidgetIr`'s own O(1) dispatch).
 * @overallScore 100
 *
 * Exported for `pages.ts`'s post-template render path (post-template-picker feature, 2026-08-10) —
 * a chosen `blog-post.html` template's `{"type":"post"}` slot substitutes through this exact same
 * function, not a second implementation; the only difference from an `"html"`-format Page is WHERE
 * the html/resolved pair comes from (a theme's `pages/*.html` plus a real-id substitution, not
 * `post.bodyHtml`).
 */
export function renderHtmlPageBody(
  { html, resolved, renderWidgetIr, postAuthorForHeader }: { html: string; resolved: ResolveHtmlPageEmbedsResult | undefined; renderWidgetIr: (required: { ir: WidgetRenderIR }) => string; postAuthorForHeader: (required: { html: string; post: Pick<PostRecord, "id" | "slug" | "author" | "showAuthor"> }) => string }, options: { postAuthor?: Pick<PostRecord, "id" | "slug" | "author" | "showAuthor">; postPresentation?: PostRecord } = {},
): string {
  const postAuthor = options.postAuthor;
  const byline = postAuthor ? postAuthorForHeader({ html, post: postAuthor }) : "";
  return substituteHtmlEmbeds({ html: html, resolve: (ref, occurrence) =>
    resolvePageBodyEmbed({ ref, occurrence, resolved, byline, renderWidgetIr }, options) });
}

type PageBodyRenderOptions = Parameters<typeof renderHtmlPageBody>[1];

/** {@link renderHtmlPageBody}'s per-marker resolution (see that function's doc for the full
 *  contract): `undefined` leaves the marker as authored, `""` drops it, anything else replaces it.
 *  @complexity O(1) per marker plus {@link renderWidgetIr}'s own work. */
function resolvePageBodyEmbed(
  { ref, occurrence, resolved, byline, renderWidgetIr }: {
    ref: PageHtmlEmbedRef;
    occurrence: EmbedOccurrence;
    resolved: ResolveHtmlPageEmbedsResult | undefined;
    byline: string;
    renderWidgetIr: (required: { ir: WidgetRenderIR }) => string;
  },
  { postAuthor, postPresentation }: NonNullable<PageBodyRenderOptions> = {},
): string | PluginExportRender | undefined {
  if (!isPageEmbedType({ type: ref.type })) return undefined;
  // D4 guard (2026-09-23): a "content"/"post" marker naming neither an id nor a slug has no
  // current entity to resolve against at all — e.g. the static theme's own `index.html`, whose
  // `{"type":"content","header":false}` marker names no id because D2's `finishStaticTierDocument`
  // runs this stage over assembled HTML, not a per-entity render. Leave it exactly as authored
  // (return `undefined`, `substituteMarkers`' own "leave as written" contract) instead of
  // degrading to the REQ-28 placeholder, which is the right answer only when an id/slug WAS
  // named but failed to resolve.
  if (isPostEntityRef(ref) && ref.id === null && ref.slug === null) return undefined;
  const resolvedIr = lookupPageEmbedIr({ ref, resolved });
  if (ref.type === "plugin") return pluginExportRender({ ir: resolvedIr });
  // Deleted/missing widget ids must not leave raw markers or placeholder markup on the public site.
  if (ref.type === "widget" && resolvedIr === undefined) return "";
  const formIr = withHtmlFormMode(resolvedIr ?? HTML_EMBED_PLACEHOLDER_IR, ref);
  const authorIr = withCurrentPostByline(formIr, { ref, postAuthor, byline });
  const presented = withPresentedPostBody(authorIr, { ref, post: postPresentation });
  return renderWidgetIr({ ir: withOccurrenceMediaAttributes({ ir: withOccurrenceHeader(presented, ref), ref, occurrence }) });
}

/** Keep canonical stamps with validated plugin HTML; missing IR retains the authored fallback. */
function pluginExportRender({ ir }: { ir: WidgetRenderIR | undefined }, _options = {}): PluginExportRender | undefined {
  return ir?.componentId === "plugin-export" ? ir.props as unknown as PluginExportRender : undefined;
}

/** A `"content"` or `"post"` marker — the two types that name a post entity. */
function isPostEntityRef(ref: PageHtmlEmbedRef): boolean {
  return ref.type === "content" || ref.type === "post";
}

/** Whether `ref` names `entity`: by id when the marker carries one, by slug otherwise. */
function refNamesEntity(ref: PageHtmlEmbedRef, entity: { id: string; slug: string }): boolean {
  return ref.id !== null ? ref.id === entity.id : ref.slug === entity.slug;
}

/** The resolved IR for `ref`, keyed the way the resolvers key it: placement key, then id, then slug
 *  (see {@link renderHtmlPageBody}'s "Lookup key" note). */
function lookupPageEmbedIr({ ref, resolved }: { ref: PageHtmlEmbedRef; resolved: ResolveHtmlPageEmbedsResult | undefined }, _optional = {}): WidgetRenderIR | undefined {
  const lookupKey = ref.placementKey ?? ref.id ?? ref.slug;
  return lookupKey !== null ? resolved?.get(ref.type)?.get(lookupKey) : undefined;
}

/** A contact form embedded with `"mode":"html"` renders as an HTML-mode form; anything else is
 *  returned unchanged. */
function withHtmlFormMode(ir: WidgetRenderIR, ref: PageHtmlEmbedRef): WidgetRenderIR {
  return ir.componentId === "contact-form" && ref.mode === "html"
    ? { ...ir, props: { ...ir.props, mode: "html" } } : ir;
}

/** Puts `byline` on the post-content header of the CURRENT post's `"content"` marker only. */
function withCurrentPostByline(
  ir: WidgetRenderIR,
  { ref, postAuthor, byline }: { ref: PageHtmlEmbedRef; postAuthor: NonNullable<PageBodyRenderOptions>["postAuthor"]; byline: string },
): WidgetRenderIR {
  // Attach only to the current entity, never to another post explicitly embedded in its template.
  if (ref.type !== "content" || ir.componentId !== "post-content" || !postAuthor || !refNamesEntity(ref, postAuthor)) return ir;
  return { ...ir, props: { ...ir.props, postAuthorByline: byline } };
}

/** Projects the presented post's body (cover-image handling) into a `"content"`/`"post"` marker that
 *  names that same post; every other marker is returned unchanged. @complexity O(body size). */
function withPresentedPostBody(ir: WidgetRenderIR, { ref, post }: { ref: PageHtmlEmbedRef; post: PostRecord | undefined }): WidgetRenderIR {
  if (!post || !isPostEntityRef(ref) || ir.componentId !== "post-content" || !refNamesEntity(ref, post)) return ir;
  const metadata = readMediaAssetMetadata({ value: ir.props.mediaAssetMetadata });
  return { ...ir, props: { ...ir.props, bodyJson: projectPostBody({ post: { ...post, bodyJson: ir.props.bodyJson },
    mediaLookup: ({ ref: mediaRef }) => metadata.get(mediaRef) ?? null,
    hasPublicTransform: readMediaTransformVersions({ value: ir.props.mediaTransformVersions }).has("public"),
  }) as JsonValue } };
}

/**
 * Carries one `"media"` marker occurrence's forwarded attributes (T4's {@link EmbedOccurrence}, D2/D3
 * of the 2026-09-16 embed-attributes plan) onto the `"media-image"` IR `renderWidgetMediaImage` reads
 * — the render-side half of "attributes on the marker element reach the rendered output." Scoped to
 * `ref.type === "media"` producing a `"media-image"` IR: every other type's `occurrence` is the shared
 * `DEFAULT_OCCURRENCE` (`html-embeds.ts`), so this is a no-op for them, and a `"media"` ref that missed
 * resolution carries the `"widget-placeholder"` IR instead, which this also leaves untouched (nothing
 * to attach attributes to).
 *
 * Returns a NEW IR object rather than mutating `ir.props` in place — the SAME `WidgetRenderIR` for one
 * asset id can be read for MULTIPLE marker occurrences on one page (`resolved`'s map is keyed by
 * asset id, not by occurrence), so mutating the shared object would let one occurrence's attributes
 * leak onto another's — the identical race {@link withOccurrenceHeader}'s own doc describes for
 * `"content"` markers' `header` option, fixed here the same way, one call earlier in the pipeline.
 *
 * `markerAttributes`/`controls` are plain-object/primitive `JsonValue`s, not the live
 * {@link MarkerAttribute} objects, because `WidgetRenderIR.props` is a `JsonObject` — normalized back
 * out by {@link normalizeMediaDimensions} on the read side.
 *
 * @complexity O(k) in the occurrence's own attribute count (one array copy).
 */
function withOccurrenceMediaAttributes({ ir, ref, occurrence }: { ir: WidgetRenderIR; ref: PageHtmlEmbedRef; occurrence: EmbedOccurrence }, _optional = {}): WidgetRenderIR {
  if (ref.type !== "media" || ir.componentId !== "media-image") return ir;
  return {
    ...ir,
    props: {
      ...ir.props,
      markerAttributes: occurrence.elementAttributes.map((attr) => ({ name: attr.name, value: attr.value })),
      controls: occurrence.controls,
    },
  };
}

/**
 * Bug fix (2026-09-05, adversarial verification of an externally-reported, never-run finding): a
 * `"content"` marker's `header` option is authored PER OCCURRENCE (`html-embeds.ts`'s own doc on
 * {@link PageHtmlEmbedRef.header}), but `resolver-service.ts`'s `resolveContentTypeEmbeds` stores
 * only ONE `"post-content"` IR per `ref.id` in a `Map` — when the SAME id is embedded twice on one
 * page with different `header` values, both `Map.set` calls race (`Promise.all`) and whichever ref
 * wins decides `props.header` for BOTH occurrences at substitution time, silently dropping the
 * loser's own opt-in/opt-out.
 *
 * Fixed here rather than in `resolver-service.ts` because substitution time is the one place that
 * genuinely knows which specific marker occurrence is being rendered: `substituteHtmlEmbeds` already
 * rebuilds a full, correct, per-occurrence {@link PageHtmlEmbedRef} (header included) for every
 * marker via its own `toEmbedRef`, so `ref.header` here is always right for THIS occurrence — this
 * override simply stops discarding it in favor of the resolve-time Map's collapsed, racy value.
 * Scoped to `ref.type === "content"` producing a `"post-content"` IR — `PageHtmlEmbedRef.header`'s
 * own doc is explicit that `header` is "Not read by widget/media/the legacy post type", and this fix
 * must not widen that contract: the legacy `"post"` type's `"post-content"` IR keeps always showing
 * the header exactly as before, even if a `"post"` marker happens to carry a `header` key.
 */
function withOccurrenceHeader(ir: WidgetRenderIR, ref: PageHtmlEmbedRef): WidgetRenderIR {
  if (ref.type !== "content" || ir.componentId !== "post-content") return ir;
  return { ...ir, props: { ...ir.props, header: ref.header } };
}
