import type { WidgetRenderIR } from "../../../../../widgets/index.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";
import type { renderImageTag, renderVideoTag } from "../../../../../widgets/media-tags.js";
import type { resolveEmbedHtmlAttributes, formatHtmlAttributes, omitKey } from "../../../../../widgets/media-attributes.js";
import type { isPlausibleMediaRefId, plausibleMediaRefId } from "../../../../../widgets/markers/index.js";
import type { mediaPublicPath, mediaUrlKey } from "../../../../../media/site/public-path.js";
import type { PlaceholderClasses } from "../media-placeholder.js";

/** The class names the doc renderer emits, bound by the host to whatever its stylesheet targets
 *  (Jini hard-codes none). Each name is escaped on emission. */
export interface DocRenderClasses {
  readonly mediaPlaceholder: PlaceholderClasses;
  /** The "content too deeply nested" box emitted past `MAX_RENDER_DEPTH`. */
  readonly contentPlaceholder: PlaceholderClasses;
  readonly youtubeEmbed: string;
  readonly postMention: string;
  /** The wrapper a `widgetEmbed` carrying its own `cssClass`/`htmlAttributes` renders in. */
  readonly widgetEmbed: string;
}

/** Everything host- or sibling-domain-specific the doc node handlers need, injected so this
 *  entry's closure stays inside its own isolation domain (media URL policy and tag rendering live
 *  in the `media`/`widgets` domains; the URL allowlists are host policy). Bound once by the host's
 *  composition (the host's content-html composition). */
export interface DocNodeHost {
  readonly media: {
    readonly renderImageTag: typeof renderImageTag;
    readonly renderVideoTag: typeof renderVideoTag;
    readonly mediaPublicPath: typeof mediaPublicPath;
    readonly mediaUrlKey: typeof mediaUrlKey;
    readonly isPlausibleMediaRefId: typeof isPlausibleMediaRefId;
    readonly plausibleMediaRefId: typeof plausibleMediaRefId;
  };
  readonly attributes: {
    readonly resolveEmbedHtmlAttributes: typeof resolveEmbedHtmlAttributes;
    readonly formatHtmlAttributes: typeof formatHtmlAttributes;
    readonly omitKey: typeof omitKey;
  };
  /** Host URL policy: the allowlists that decide which image `src` / YouTube URL a doc node may
   *  publish. Each returns `null` for anything it rejects. */
  readonly safeUrl: {
    readonly safeImageSrc: (required: { value: JsonValue | undefined }, optional?: Record<string, never>) => string | null;
    readonly extractYoutubeVideoId: (required: { value: JsonValue | undefined }, optional?: Record<string, never>) => string | null;
  };
  readonly classes: DocRenderClasses;
}

/** Threaded-through render state every {@link renderDocNode} case handler needs — bundled into one
 *  object so each extracted handler (see {@link DOC_NODE_HANDLERS}) takes one params object instead
 *  of the same three maps plus `depth` repeated at every call site, the way the old single-`switch`
 *  body used to spell them out inline for every case. */
export interface DocNodeRenderDeps {
  readonly inlineResolved: ReadonlyMap<string, WidgetRenderIR>;
  readonly mediaTransformVersions: ReadonlyMap<string, number>;
  readonly mediaAssetMetadata: ReadonlyMap<string, MediaAssetRenderMeta>;
  readonly depth: number;
  /** The widget renderer a `widgetEmbed` node renders through. Injected (bound once, in
   *  `render/content-html.ts`) because the widget renderer itself renders docs: an import in both
   *  directions would be a cycle, so the doc renderer never imports it. */
  readonly renderWidget: (ir: WidgetRenderIR) => string;
  /** The host collaborators (media rendering/URL policy, URL allowlists, class names). */
  readonly host: DocNodeHost;
}

/** One handler per doc-node `type`, dispatched by {@link renderDocNode} through
 *  {@link DOC_NODE_HANDLERS} — see that table's own doc for why this file moved off a single large
 *  `switch`. */
export type DocNodeHandlerRequired = { node: JsonObject; content: JsonValue[] | undefined; deps: DocNodeRenderDeps };
export type DocNodeHandler = (required: DocNodeHandlerRequired, optional?: Record<string, never>) => string;

/** `renderDocNode`'s optional second argument — every field defaults to empty / `0`; see that
 *  function's own doc for what each one resolves. */
export interface DocRenderOptions {
  inlineResolved?: ReadonlyMap<string, WidgetRenderIR>;
  mediaTransformVersions?: ReadonlyMap<string, number>;
  mediaAssetMetadata?: ReadonlyMap<string, MediaAssetRenderMeta>;
  /** Ancestor count above this node — the doc root is `0`. Every pre-existing caller (this file's
   *  `entryContent`, `liquid-worker.ts`'s `buildLiquidData`, every direct test call) keeps working
   *  unchanged via this default; only {@link renderNodes}'s own recursive calls ever pass a non-zero
   *  value. See {@link MAX_RENDER_DEPTH}'s own doc for why this exists and how the number was
   *  chosen. */
  depth?: number;
}

/** The doc-rendering functions the widget renderers call back into: a `post-content` widget renders
 *  its body and its title node, and a legacy `src` gallery image renders as an `image` node. Passed
 *  to those widgets as a required field (built once, in `render/content-html.ts`) for the same reason
 *  as {@link DocNodeRenderDeps.renderWidget}: the doc renderer renders widgets, so a widget file that
 *  imported it back would close a cycle. Both members are the real functions with the widget
 *  renderer already bound. */
export interface WidgetDocRendering {
  renderDocNode: (required: { node: JsonValue }, optional?: DocRenderOptions) => string;
  renderNodes: (required: { nodes: JsonValue[] | undefined; inlineResolved: ReadonlyMap<string, WidgetRenderIR>; mediaTransformVersions: ReadonlyMap<string, number>; mediaAssetMetadata: ReadonlyMap<string, MediaAssetRenderMeta>; depth: number }) => string;
}
