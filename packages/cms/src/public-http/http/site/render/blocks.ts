import type { SiteRenderContext } from "../render-context.js";
import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";
import { escapeHtml } from "@jini-ai/core/text";
import { renderPostBody } from "./post-body.js";
import { isObject } from "./value-readers.js";
import type { BodyRenderPorts } from "./body-render-ports.js";

/** What a theme-referenced component renders from. Hosts own the component table; this module only
 *  asks for one by id, so an unknown id can degrade to a comment instead of throwing. */
type BlockComponent = (required: { ctx: SiteRenderContext; props: JsonObject }) => string;

/** The host seams every block render threads through, including the recursive doc-children walk. */
export interface BlockRenderPorts extends BodyRenderPorts {
  componentFor: (required: { id: string }) => BlockComponent | undefined;
  renderWidgetRegion: (required: { ctx: SiteRenderContext; regionKey: string }) => string;
  entryList: (required: { ctx: SiteRenderContext; props: JsonObject }) => string;
}

/**
 * Resolves one `render_block` invocation — the single seam both logic tiers share back into the
 * trusted core. `props.region` selects a theme-declared widget region; otherwise `props.component`
 * selects an entry from the host's component table (`ports.componentFor`). An unknown component id
 * degrades to an HTML comment, never a throw, so one bad reference cannot take the page down.
 *
 * Exported so the Liquid tag and the Handlebars helper are the same code rather than two
 * implementations that must be kept in agreement.
 *
 * @complexity O(1) beyond the resolved component's own rendering.
 * @overallScore 100/100
 */
export function renderBlockSeam({ ctx, props, ports }: { ctx: SiteRenderContext; props: JsonObject; ports: BlockRenderPorts }, _optional = {}): string {
  if (typeof props.region === "string") {
    return ports.renderWidgetRegion({ ctx, regionKey: props.region });
  }
  const id = typeof props.component === "string" ? props.component : "";
  const { component: _component, region: _region, ...rest } = props;
  const component = ports.componentFor({ id });
  if (!component) return `<!-- unknown component: ${escapeHtml({ text: id })} -->`;
  return component({ ctx, props: rest });
}

// ---------------------------------------------------------------------------
// Slots — raw context injection points a template can drop in directly.
// ---------------------------------------------------------------------------

function renderSlot({ name, ctx, ports }: { name: string; ctx: SiteRenderContext; ports: BlockRenderPorts }, _optional = {}): string {
  switch (name) {
    case "title":
      return `<h1 class="slot-title">${escapeHtml({ text: ctx.route === "post" && ctx.post ? ctx.post.title : ctx.siteTitle })}</h1>`;
    case "content":
      return ctx.post ? `<div class="prose">${renderPostBody({ ctx, post: ctx.post, renderers: ports })}</div>` : "";
    case "entry-list":
      return ports.entryList({ ctx, props: {} });
    default:
      return `<!-- unknown slot: ${escapeHtml({ text: name })} -->`;
  }
}

// ---------------------------------------------------------------------------
// Template block tree
// ---------------------------------------------------------------------------

type BlockHandlerInput = { node: JsonObject; ctx: SiteRenderContext; ports: BlockRenderPorts };

function renderComponentBlock({ node, ctx, ports }: BlockHandlerInput, _optional = {}): string {
  const id = typeof node.id === "string" ? node.id : "";
  const component = ports.componentFor({ id });
  if (!component) return `<!-- unknown component: ${escapeHtml({ text: id })} -->`;
  return component({ ctx, props: isObject(node.props) ? node.props : {} });
}

function renderSlotBlock({ node, ctx, ports }: BlockHandlerInput, _optional = {}): string {
  return renderSlot({ name: typeof node.name === "string" ? node.name : "", ctx, ports });
}

/** SPEC-043/ADR-047 W-004: `{"type":"region","key":"footer"}` — a theme-authored reference to a
 *  theme-declared widget region (REQ-13/`ThemeManifest.regions`), resolved server-side ahead of the
 *  block walk (`resolvePageWidgets`, threaded in via `ctx.widgetRegions`). Dispatched by `node.type`
 *  through {@link BLOCK_TYPE_HANDLERS} rather than sequential `if`s, so a region node is never
 *  mistaken for unknown content-doc vocabulary (which would try to walk its `content`, not its
 *  `key`) — the two shapes never share a code path regardless of dispatch order. */
function renderRegionBlock({ node, ctx, ports }: BlockHandlerInput, _optional = {}): string {
  return ports.renderWidgetRegion({ ctx, regionKey: typeof node.key === "string" ? node.key : "" });
}

function renderDocTypeBlock({ node, ctx, ports }: BlockHandlerInput, _optional = {}): string {
  return (Array.isArray(node.content) ? node.content : []).map((child) => renderBlock({ node: child, ctx, ports })).join("");
}

/** One handler per theme-authored block `type` — a lookup instead of a sequential `if`/`if`/`if`
 *  chain, so the number of block kinds stops being what drives {@link renderBlock}'s own complexity.
 *  A `type` with no entry here (including every plain content-doc vocabulary type, e.g. `paragraph`)
 *  falls through to `renderBlock`'s own default: this node tree is content-doc vocabulary, handled by
 *  the injected doc renderer. A `Map`, not an object literal, so an inherited key such as
 *  `"constructor"` is never mistaken for a handler. */
const BLOCK_TYPE_HANDLERS: ReadonlyMap<string, (input: BlockHandlerInput) => string> = new Map([
  ["component", renderComponentBlock],
  ["slot", renderSlotBlock],
  ["region", renderRegionBlock],
  ["doc", renderDocTypeBlock],
]);

export function renderBlock({ node, ctx, ports }: { node: JsonValue; ctx: SiteRenderContext; ports: BlockRenderPorts }, _optional = {}): string {
  if (!isObject(node)) return "";
  const handler = typeof node.type === "string" ? BLOCK_TYPE_HANDLERS.get(node.type) : undefined;
  if (handler) return handler({ node, ctx, ports });
  // Anything else is content-doc vocabulary.
  return ports.renderDocNode({ node }, { inlineResolved: ctx.widgetInlineResolved, mediaTransformVersions: ctx.mediaTransformVersions, mediaAssetMetadata: ctx.mediaAssetMetadata });
}
