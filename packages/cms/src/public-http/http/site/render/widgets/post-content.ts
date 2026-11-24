import type { JsonValue, JsonObject } from "@jini-ai/core/primitives";
import type { WidgetDocRendering } from "../doc/doc-render-contract.js";
import { isObject, str } from "../value-readers.js";
import { EMPTY_INLINE_RESOLVED, EMPTY_MEDIA_TRANSFORM_VERSIONS, EMPTY_MEDIA_ASSET_METADATA } from "../doc/doc-nodes.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { WidgetRenderIR } from "../../../../../widgets/index.js";
import { escapeHtml } from "@jini-ai/core/text";
import { renderWidgetPlaceholder } from "./placeholder.js";
import { styleForAlign } from "../../../../../html/text-layout.js";
import type { WidgetPostContentClasses, WidgetPostContentHost } from "./widget-render-contract.js";

/**
 * Renders a resolved `data-embed-type="post"` embed (post-template-picker feature, 2026-08-10) —
 * `resolver-service.ts`'s `resolvePostTypeEmbeds` returns the post's RAW data (title/bodyJson/
 * updatedAt), not rendered HTML, because that resolver lives in `widgets/` and must not depend on
 * this file (see that resolver's own doc). This is the one place that gap closes: `renderDocNode` is
 * already in scope here, so the actual TipTap-to-HTML render happens at this dispatch step, the same
 * "resolve raw, render here" split `renderWidgetMediaImage` uses for media embeds just above.
 *
 * Renders the body with the empty inline-widget/media-transform/media-asset defaults (this file's
 * own `EMPTY_*` constants) — a `widgetEmbed` or ref-image node nested inside a template-embedded
 * post's own body degrades to its normal unresolved-reference placeholder rather than resolving
 * recursively. Disclosed scope limit, not an oversight: no other embed resolver in this codebase
 * resolves nested references either (see `resolveMediaTypeEmbeds`'s own disclosed mime-type gap).
 */
/**
 * Reads `bodyJson`'s leading `title` node (post-title-in-document feature, 2026-08-11 — see the
 * `"title"` case in {@link renderDocNode} for the rest of this feature's server-side half) — present
 * on any post/page saved after the admin editor started synthesizing one (`withTitleNode`, `apps/
 * admin/src/features/posts/rules.ts`), absent on every row saved before that.
 *
 * Returns the node's own inline content, rendered through the SAME `renderNodes` every other doc node
 * uses (marks/escaping included, not a second implementation), plus its `textAlign` attr — or `null`
 * when `bodyJson` doesn't start with a `title` node, which is {@link renderWidgetPostContent}'s
 * back-compat signal to fall back to `props.title` exactly as it did before this feature existed.
 *
 * @complexity O(t) in the title node's own inline content length — no recursion beyond it, and no
 * work at all over the rest of `bodyJson`.
 */
function extractTitleNode(
  { bodyJson, renderNodes }: { bodyJson: JsonValue; renderNodes: WidgetDocRendering["renderNodes"] }, _optional = {}
): { html: string; align: string | null } | null {
  if (!isObject(bodyJson)) return null;
  const content = Array.isArray(bodyJson.content) ? bodyJson.content : undefined;
  const first = content?.[0];
  if (!isObject(first) || first.type !== "title") return null;
  const align = isObject(first.attrs) && typeof first.attrs.textAlign === "string" ? first.attrs.textAlign : null;
  const innerContent = Array.isArray(first.content) ? first.content : undefined;
  return {
    // `0`: this is its own independent render entry point (the title node's inline content, read
    // directly off `bodyJson` rather than reached via `renderDocNode`'s own recursive walk), same as
    // every other top-level caller relying on `renderDocNode`'s own `depth = 0` default.
    html: renderNodes({ nodes: innerContent, inlineResolved: EMPTY_INLINE_RESOLVED, mediaTransformVersions: EMPTY_MEDIA_TRANSFORM_VERSIONS, mediaAssetMetadata: EMPTY_MEDIA_ASSET_METADATA, depth: 0 }),
    align,
  };
}

/**
 * Reconstructs the `mediaTransformVersions` map `renderDocNode`'s `image` case needs, from the
 * plain-JSON form `resolver-service.ts` stashes into `WidgetRenderIR.props` (`widgets/` must not
 * import this file — see that module's own layering note — so it can't build a real `Map` and hand
 * it across the boundary; a `Record<string, number>` is the JSON-safe equivalent). Same
 * defaults-to-empty, never-throws shape every other optional map on this render path already
 * follows: a malformed or absent value degrades to {@link EMPTY_MEDIA_TRANSFORM_VERSIONS}, which
 * `renderDocNode`'s `image` case already treats as "nothing resolvable, placeholder".
 */
export function readMediaTransformVersions({ value }: { value: JsonValue | undefined }, _optional = {}): ReadonlyMap<string, number> {
  if (!isObject(value)) return EMPTY_MEDIA_TRANSFORM_VERSIONS;
  const entries = Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return new Map(entries);
}

/** One raw per-asset JSON value -> {@link MediaAssetRenderMeta}, or `null` when `raw` isn't even an
 *  object — pulled out of {@link readMediaAssetMetadata}'s old for-loop body so the three field-level
 *  ternaries are counted once, at nesting depth 0, instead of once each inside the loop's own nesting.
 *  Same "malformed entry skipped, missing field degrades to `null`" contract as before. */
function parseMediaAssetMeta(raw: JsonValue): MediaAssetRenderMeta | null {
  if (!isObject(raw)) return null;
  return {
    width: typeof raw.width === "number" ? raw.width : null,
    height: typeof raw.height === "number" ? raw.height : null,
    cssClass: typeof raw.cssClass === "string" ? raw.cssClass : null,
    htmlAttributes: typeof raw.htmlAttributes === "string" ? raw.htmlAttributes : null,
    // Reconstructed from `raw` (2026-09-11) the same way as every other field above — this file's
    // own `resolver-service.ts` (`resolvePostContentMediaContext`) now stashes a real sniffed type
    // into this JSON shape too, closing the gap `MediaAssetRenderMeta.contentType`'s own doc used to
    // disclose. A missing/non-string value (an older-shaped payload, or a genuinely unsniffed asset)
    // degrades to `null`, same "not set" convention every other field here already follows.
    contentType: typeof raw.contentType === "string" ? raw.contentType : null,
    // Readable-slugs S3: same reconstruction, same "missing/wrong-typed degrades to null" rule.
    slug: typeof raw.slug === "string" ? raw.slug : null,
    ...(typeof raw.sha256 === "string" ? { sha256: raw.sha256 } : {}),
  };
}

/** Same reconstruction as {@link readMediaTransformVersions}, for `mediaAssetMetadata` — see that
 *  function's own doc for why this crosses the `widgets/`-to-`render.ts` boundary as plain JSON
 *  rather than a real `Map`. A malformed per-asset entry (not an object) is skipped, not thrown;
 *  missing `width`/`height`/`cssClass`/`htmlAttributes` fields degrade to `null` ("not set"), matching
 *  {@link MediaAssetRenderMeta}'s own "`null` means not set, not zero" contract. */
export function readMediaAssetMetadata({ value }: { value: JsonValue | undefined }, _optional = {}): ReadonlyMap<string, MediaAssetRenderMeta> {
  if (!isObject(value)) return EMPTY_MEDIA_ASSET_METADATA;
  const entries: [string, MediaAssetRenderMeta][] = [];
  for (const [assetId, raw] of Object.entries(value)) {
    const meta = parseMediaAssetMeta(raw);
    if (meta) entries.push([assetId, meta]);
  }
  return new Map(entries);
}

/** Rebuilds the `placementId -> WidgetRenderIR` map `renderDocNode`'s `widgetEmbed` case needs from
 *  the plain JSON `resolver-service.ts`'s `resolvePostContentWidgetContext` stashes into
 *  `props.inlineWidgets` (2026-09-22 — before it, every inline widget in a template-rendered post was
 *  the placeholder). A malformed entry is skipped, so its node degrades to the placeholder. */
function readInlineWidgets({ value }: { value: JsonValue | undefined }, _optional = {}): ReadonlyMap<string, WidgetRenderIR> {
  if (!isObject(value)) return EMPTY_INLINE_RESOLVED;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, JsonObject] => isObject(entry[1]) && typeof entry[1].componentId === "string" && isObject(entry[1].props)
  );
  return new Map(entries.map(([id, ir]) => [id, ir as unknown as WidgetRenderIR]));
}

/**
 * Owner-reported bug (2026-08-12): a ref-based image dropped into a post's body rendered as a
 * labelled placeholder box showing the filename — everywhere this function's output reaches (the
 * editor's own "Preview" tab, which renders through the host's admin template-preview route ->
 * `renderViaTemplate` -> this same "post-content" IR, AND the published public page) — even though
 * the asset, its `"public"` transform registration, and the `/m/` rendition route were all
 * confirmed live and working. Root cause: this function called `renderDocNode(bodyJson)` with only
 * ONE argument, so `mediaTransformVersions`/`mediaAssetMetadata` silently defaulted to EMPTY MAPS
 * (`renderDocNode`'s own optional-params default) — every ref-based image's `mediaTransformVersions
 * .get(transformName)` was unconditionally `undefined`, so the `image` case ALWAYS took its
 * degrade-to-placeholder branch, regardless of whether the referenced asset/transform actually
 * existed. This is the ONE call site `renderWidgetIr`'s `"post-content"` case reaches
 * (`resolveHtmlPageEmbeds` never calls `renderDocNode` directly — see this file's header on why
 * `widgets/` can't import this module), so nothing here was ever going to resolve a real image
 * without this fix, for ANY post, on ANY render path that goes through a static-theme template
 * (which is unconditionally true for every `kind: "post"` row on a theme that declares templates —
 * `isEligibleForTemplateBranch`'s own doc).
 *
 * Fix: `resolver-service.ts`'s three `"post-content"` IR builders (`resolvePostTypeEmbeds`,
 * `resolveContentTypeEmbeds`'s two branches) now resolve the SAME `mediaTransformVersions`/
 * `mediaAssetMetadata` data `routes/site/pages.ts`'s generic (non-template) render path already
 * resolves for `renderSite` — reusing the identical `getLatestTransformDefinition`/
 * `mediaRepo.findById` primitives `resolveMediaTypeEmbeds` (the sibling `"media"` embed resolver)
 * already calls — and stash it into `props` as plain JSON (`readMediaTransformVersions`/
 * `readMediaAssetMetadata` above reconstruct the `Map`s this function needs from that JSON).
 */
/**
 * The `.post-detail-header` block (`<h1>` + optional date and author byline), or `""` when the caller opted
 * out via `header: false` (2026-09-04 — a "content" marker's own `header:false`, threaded here from
 * `resolver-service.ts`'s `resolveContentTypeEmbeds`). Split out of {@link renderWidgetPostContent}
 * so the opt-out's own branch lives at nesting depth 0 in a small function, rather than stacking a
 * third ternary into a function that already carries two (the title-node back-compat fork, the
 * date-label presence check) — see this repo's complexity ceiling.
 *
 * The byline sits inside the date's `.post-meta` line, as its next item (2026-10-10). After it, as
 * a sibling, it took the theme's body-text size and font under a small monospace date on every theme
 * without its own byline rules; inside, it inherits whatever the theme gives that line (themes lay
 * `.post-meta` out as a row of meta items: `display: flex; gap`).
 *
 * @complexity O(1) — string concatenation only, no loop or recursion.
 */
function renderPostDetailHeader(
  required: { showHeader: boolean; titleHtml: string; dateLabel: string; dateIso: string; bylineHtml: string; classes: WidgetPostContentClasses },
  _optional: Record<string, never> = {},
): string {
  const { showHeader, titleHtml, dateLabel, dateIso, bylineHtml, classes } = required;
  if (!showHeader) return "";
  const time = dateLabel ? `<time datetime="${escapeHtml({ text: dateIso })}">${escapeHtml({ text: dateLabel })}</time>` : "";
  // `bylineHtml` is required (L082b): its one caller always passes `str(props.postAuthorByline)`,
  // which is `""` when there is no byline, so the former optional's `?? ""` default never ran.
  const byline = bylineHtml.replace("<span", time ? '<span data-post-author-separator=""' : "<span");
  const meta = time + byline;
  return `<div class="${classes.header}">` + titleHtml + (meta ? `<div class="${classes.meta}">${meta}</div>` : "") + `</div>`;
}

export function renderWidgetPostContent({ props, docRendering, host }: { props: JsonObject; docRendering: WidgetDocRendering; host: WidgetPostContentHost }, _optional = {}): string {
  const { title, bodyJson } = props;
  if (typeof title !== "string" || bodyJson === undefined) return renderWidgetPlaceholder();
  // `header` (2026-09-04): `false` only when a "content" marker explicitly opted out
  // (`resolver-service.ts`'s `resolveContentTypeEmbeds` threads `ref.header` through unchanged) —
  // absent, `true`, or any other value keeps emitting the header, matching the field's own
  // default-true contract on `PageHtmlEmbedRef.header` so every pre-existing template (no `header`
  // key at all) renders byte-identical to before this field existed.
  const showHeader = props.header !== false;
  // The go-live time when the post has one (`postDisplayDateIso`, owner decision 2026-10-05) — a
  // scheduled post's Preview shows the day it will go live, not the day it was last saved.
  const dateIso = host.postDisplayDateIso({
    publishAt: typeof props.publishAt === "string" ? props.publishAt : null,
    updatedAt: typeof props.updatedAt === "string" ? props.updatedAt : "",
  });
  // Bug D: the label is the calendar day in the site's zone (`props.timeZone`, set by the resolver
  // from `core.site.timezone`), not the server's UTC; `datetime` keeps the stored instant.
  const timeZone = typeof props.timeZone === "string" ? { timeZone: props.timeZone } : {};
  const dateLabel = dateIso ? host.formatDateLabel({ iso: dateIso }, timeZone) : "";
  // Back-compat fork (post-title-in-document feature, 2026-08-11): a migrated body's OWN title node
  // drives the `<h1>` (text AND alignment) so centering it in the editor actually centers it here;
  // a pre-migration body (no title node yet — every row saved before this feature landed) falls back
  // to the plain `props.title` string exactly as this rendered before the feature existed. Exactly
  // one `<h1>` either way — never two, never zero.
  const titleNode = extractTitleNode({ bodyJson: bodyJson as JsonValue, renderNodes: docRendering.renderNodes });
  const titleHtml =
    titleNode !== null ? `<h1${styleForAlign({ align: titleNode.align })}>${titleNode.html}</h1>` : `<h1>${escapeHtml({ text: title })}</h1>`;
  const mediaTransformVersions = readMediaTransformVersions({ value: props.mediaTransformVersions as JsonValue | undefined });
  const mediaAssetMetadata = readMediaAssetMetadata({ value: props.mediaAssetMetadata as JsonValue | undefined });
  const inlineWidgets = readInlineWidgets({ value: props.inlineWidgets as JsonValue | undefined });
  return (
    renderPostDetailHeader({ showHeader, titleHtml, dateLabel, dateIso, bylineHtml: str({ value: props.postAuthorByline }), classes: host.classes }) +
    `<div class="${host.classes.body}">${docRendering.renderDocNode({ node: bodyJson }, { inlineResolved: inlineWidgets, mediaTransformVersions, mediaAssetMetadata })}</div>`
  );
}
