import type { WidgetRenderIR } from "../../../../../widgets/index.js";
import type { MediaAssetRenderMeta } from "@jini-ai/core/contracts/site/cms-media";
import type { JsonValue, JsonObject } from "@jini-ai/core/primitives";
import type { DocNodeRenderDeps, DocNodeHandlerRequired, DocNodeHandler, DocRenderOptions } from "./doc-render-contract.js";
import { toSlug } from "../../../../../html/site/slug.js";
import { dedupeHeadingIds, alignStyleAttr, headingAnchorId, tableSpanAttrs, tableCellAlignAttr } from "../../../../../html/text-layout.js";
import { isObject, str } from "../value-readers.js";
import { escapeHtml } from "@jini-ai/core/text";
import { toAllowedHref } from "../../../../../navigation/href.js";
import { renderMarks } from "../../../../../html/document-marks.js";
import { safeLanguageClass } from "../../../../../html/style-values.js";
import { MAX_SLUG_LENGTH, SLUG_FORMAT_PATTERN } from "../../../../../posts/slug.js";
import { WIDGET_PLACEHOLDER_IR } from "../widgets/placeholder.js";
import { renderDocImage, renderDocMedia, renderDocYoutube } from "./nodes-media.js";

/** No-widgets default for every `renderDocNode`/`renderNodes` caller that doesn't pass one. */
export const EMPTY_INLINE_RESOLVED: ReadonlyMap<string, WidgetRenderIR> = new Map();

/**
 * No-transforms default for every `renderDocNode`/`renderNodes` caller that doesn't pass one —
 * mirrors {@link EMPTY_INLINE_RESOLVED}'s exact "missing means degrade safely" convention. Keyed
 * by transform NAME (not `assetId`): a registered transform's latest version is a property of
 * `(workspaceId, transformName)` alone (`transform-registry.ts`), so one small map resolved once
 * per render covers every image node in the document regardless of how many distinct assets it
 * references — this is why media resolution needs nothing like `widgetInlineResolved`'s
 * per-placement batch join.
 */
export const EMPTY_MEDIA_TRANSFORM_VERSIONS: ReadonlyMap<string, number> = new Map();

/** No-overrides default for every `renderDocNode`/`renderNodes` caller that doesn't pass one —
 * same "optional, defaults to empty, degrades to no attribute" convention as
 * {@link EMPTY_MEDIA_TRANSFORM_VERSIONS} immediately above. */
export const EMPTY_MEDIA_ASSET_METADATA: ReadonlyMap<string, MediaAssetRenderMeta> = new Map();

/**
 * Render-time recursion bound (worklist #5, request-cost audit TM-2026-08-12-A) — same
 * "defensive bound, not a real document's expected shape" reasoning {@link tableSpanAttrs}'s own
 * doc already states for `colspan`/`rowspan`: `bodyJson` is written by a direct API call, an import,
 * a migration, or a plugin with table access exactly as easily as by the editor, and an unbounded
 * nesting chain is a cheap way to crash every concurrent visitor's request, not just the one that
 * asked for this page.
 *
 * Chosen empirically, not guessed. A binary search against a real `bulletList > listItem` chain (the
 * shape genuine repeated list-indentation produces, not an artificial doc) found the actual crash
 * boundary twice, from two different angles: calling `renderDocNode` directly, depth 500 renders in
 * ~2ms and depth 501 throws `RangeError: Maximum call stack size exceeded`; through a full real HTTP
 * request (more call stack already in use — Express, the route handler's own `await` chain,
 * `renderSite`), the boundary sits at depth 561/562, HIGHER than the isolated-call number, not lower
 * — plausibly because each `await` resumption in the request path runs as a fresh, shallower
 * continuation rather than accumulating stack the way nested synchronous calls do, though this isn't
 * independently confirmed. Both numbers are Node/V8/platform-specific and this repo's own commit
 * history is proof they move (`request-cost-traversal.measurement.test.ts`'s own runs varied depth
 * 500-vs-1000 across invocations before the binary search narrowed it down): a bound picked by
 * splitting the difference between two measurements taken on one laptop is not a bound, it is a
 * coin flip on whichever platform actually deploys this. `200` is roughly 40% of the LOWER (more
 * conservative) of the two measured boundaries — over 2.5x headroom below the worst observed crash
 * point — while still being far deeper than any plausible human-authored document: a nested list 200
 * `bulletList`/`listItem` pairs deep has no legitimate editorial reason to exist (ordinary nesting
 * rarely exceeds single digits).
 *
 * A node-count (breadth) bound was considered and deliberately deferred, not forgotten — see this
 * file's own commit history for the full reasoning: unlike depth, breadth doesn't crash (100,000
 * sibling paragraphs measured ~250-650ms, slow but survives), and the natural mitigation shape is a
 * different, more invasive design question (where to truncate a document that's too WIDE, and what a
 * partially-rendered page communicates to a reader, versus depth's clean "stop recursing, show a
 * placeholder for the over-deep branch, everything else renders exactly as authored").
 */
export const MAX_RENDER_DEPTH = 200;

/** Emitted in place of any node whose ancestor chain exceeds {@link MAX_RENDER_DEPTH} — same
 *  labelled-placeholder convention {@link mediaPlaceholder} uses for a missing/unsafe asset, applied
 *  here for a structural reason instead. The document itself is never modified, only truncated at
 *  render time: everything above the bound still renders exactly as authored, and only the
 *  over-deep branch degrades. */
function depthLimitPlaceholder({ classes }: { classes: DocNodeRenderDeps["host"]["classes"] }, _optional = {}): string {
  return `<div class="${escapeHtml({ text: classes.contentPlaceholder.box })}"><span class="${escapeHtml({ text: classes.contentPlaceholder.label })}">Content too deeply nested to render</span></div>`;
}

export function renderNodes(
  { nodes, inlineResolved, mediaTransformVersions, mediaAssetMetadata, depth, renderWidget, host }: { nodes: JsonValue[] | undefined; inlineResolved: ReadonlyMap<string, WidgetRenderIR>; mediaTransformVersions: ReadonlyMap<string, number>; mediaAssetMetadata: ReadonlyMap<string, MediaAssetRenderMeta>; depth: number; renderWidget: DocNodeRenderDeps["renderWidget"]; host: DocNodeRenderDeps["host"] }, _optional = {}
): string {
  return (nodes ?? [])
    .map((node) => renderDocNodeWith({ node, renderWidget, host }, { inlineResolved, mediaTransformVersions, mediaAssetMetadata, depth }))
    .join("");
}

/** Renders `content` one level deeper than the current node — every handler's own recursion entry
 *  point, replacing the `renderNodes(content, inlineResolved, mediaTransformVersions,
 *  mediaAssetMetadata, depth + 1)` call every case used to spell out individually. */
function renderChildNodes({ content, deps }: { content: JsonValue[] | undefined; deps: DocNodeRenderDeps }, _optional = {}): string {
  return renderNodes({ nodes: content, inlineResolved: deps.inlineResolved, mediaTransformVersions: deps.mediaTransformVersions, mediaAssetMetadata: deps.mediaAssetMetadata, depth: deps.depth + 1, renderWidget: deps.renderWidget, host: deps.host });
}

function renderDocDocNode({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  // Dedupe at the doc boundary — see `dedupeHeadingIds` for why this is a pass over the finished
  // string rather than state threaded through the recursion.
  return dedupeHeadingIds({ html: renderChildNodes({ content, deps }) });
}

function renderDocParagraph({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<p${alignStyleAttr({ node })}>${renderChildNodes({ content, deps })}</p>`;
}

function renderDocHeading({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const level = isObject(node.attrs) && typeof node.attrs.level === "number" ? node.attrs.level : 2;
  const h = Math.min(Math.max(level, 1), 6);
  // Additive: an `id` changes nothing visually, and every heading rendered before this existed
  // simply had no anchor to link to. Emitted as the FIRST attribute, which `dedupeHeadingIds`
  // relies on. Omitted entirely when the text slugifies to nothing.
  const anchor = headingAnchorId({ node, toSlug });
  const idAttr = anchor === "" ? "" : ` id="${escapeHtml({ text: anchor })}"`;
  return `<h${h}${idAttr}${alignStyleAttr({ node })}>${renderChildNodes({ content, deps })}</h${h}>`;
}

/**
 * Post-title-in-document feature (2026-08-11) — a dedicated first `doc` node an author can
 * center/style per post (the host editor's post-title extension). Renders empty in every
 * GENERIC doc walk: `entryContent`, `renderSlot("title")`, and `buildTemplateRenderData`'s
 * `post.content` already each print `post.title`/`ctx.post.title` (kept in sync with this
 * node — see `withTitleNode`/`titleNodeText`, the host editor's post rules) as
 * their OWN separate heading; letting this node ALSO emit its text here would duplicate the
 * title on every one of those render paths. `renderWidgetPostContent` is the one caller that
 * needs this node directly (for its alignment) and reads it via its own `extractTitleNode`,
 * bypassing this generic walk entirely for that one field.
 */
function renderDocTitle(): string {
  return "";
}

function renderDocText({ node }: DocNodeHandlerRequired, _optional = {}): string {
  return renderMarks({ text: typeof node.text === "string" ? node.text : "", marks: Array.isArray(node.marks) ? node.marks : undefined, toAllowedHref });
}

function renderDocBulletList({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<ul>${renderChildNodes({ content, deps })}</ul>`;
}
function renderDocOrderedList({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<ol>${renderChildNodes({ content, deps })}</ol>`;
}
function renderDocListItem({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<li>${renderChildNodes({ content, deps })}</li>`;
}

// Task list (`@tiptap/extension-list`'s `./task-list`/`./task-item` subpaths, 2026-08-11) — DOM
// shape confirmed against each installed extension's own `renderHTML`, not assumed:
// `<ul data-type="taskList">` wrapping `<li data-type="taskItem"><label><input
// type="checkbox">...</label><div>CONTENT</div></li>` (the `<label>`/`<span>` pair is the
// extension's own click-target styling hook, not something this renderer invents). `disabled`
// added here (the editor's own DOM has no such attribute — its checkbox is live, backed by a
// ProseMirror node-view click handler) because there is no equivalent handler on the public
// site: an unwired, clickable-looking checkbox would visually toggle on click and then silently
// do nothing, which is worse than a checkbox that's honestly inert. The editor's default
// `nested: false` (confirmed against the installed dist) means `content` here is a single
// paragraph, not a nested list — sub-tasks are out of scope until that option is turned on.
function renderDocTaskList({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<ul data-type="taskList">${renderChildNodes({ content, deps })}</ul>`;
}
function renderDocTaskItem({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const checked = attrs.checked === true;
  return `<li data-type="taskItem"><label><input type="checkbox"${checked ? " checked" : ""} disabled/><span></span></label><div>${renderChildNodes({ content, deps })}</div></li>`;
}

// Table (`@tiptap/extension-table`, 2026-08-11) — four node types confirmed against the
// installed dist: `table` (content `"tableRow+"`), `tableRow` (`<tr>`), `tableCell` (`<td>`),
// `tableHeader` (`<th>`). No `<colgroup>`/column-resize markup: the editor mounts `Table` with
// `resizable: false` (the extension's own default), so there is no column-width state to
// reproduce here — `.post-detail-body table` (styles.css) sizes columns with plain
// `table-layout: auto`, same as an ordinary unstyled HTML table. Disclosed scope limit, not an
// oversight: widening this to resizable columns would need `colwidth` threaded through both the
// editor config and this renderer's own `<colgroup>` emission, and nothing in this task asked
// for resizable tables specifically.
function renderDocTable({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<table>${renderChildNodes({ content, deps })}</table>`;
}
function renderDocTableRow({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<tr>${renderChildNodes({ content, deps })}</tr>`;
}
function renderDocTableCell({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const attrs = isObject(node.attrs) ? node.attrs : {};
  return `<td${tableSpanAttrs({ attrs })}${tableCellAlignAttr({ node })}>${renderChildNodes({ content, deps })}</td>`;
}
function renderDocTableHeader({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  const attrs = isObject(node.attrs) ? node.attrs : {};
  return `<th${tableSpanAttrs({ attrs })}${tableCellAlignAttr({ node })}>${renderChildNodes({ content, deps })}</th>`;
}

function renderDocBlockquote({ content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  return `<blockquote>${renderChildNodes({ content, deps })}</blockquote>`;
}

function renderDocCodeBlock({ node, content, deps }: DocNodeHandlerRequired, _optional = {}): string {
  // `attrs.language` (`@tiptap/extension-code-block-lowlight`, 2026-08-11) — see
  // `safeLanguageClass`'s own doc for why this stays a class token with no server-side
  // highlighting: the editor gets real in-browser highlighting (lowlight), this renderer stays
  // dependency-free, and a theme can opt into a client-side highlighter later without any change
  // here. Omitted entirely (bare `<code>`, exactly the prior behavior) when absent or unsafe.
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const language = safeLanguageClass({ value: attrs.language });
  const classAttr = language ? ` class="language-${escapeHtml({ text: language })}"` : "";
  return `<pre><code${classAttr}>${renderChildNodes({ content, deps })}</code></pre>`;
}

function renderDocHorizontalRule(): string {
  return "<hr/>";
}

// Leaf/atom node, `@tiptap/extension-hard-break` (Shift-Enter / Mod-Enter) — bundled by
// StarterKit v3.27, no toolbar button needed to reach it. Its own `renderHTML` emits a bare
// `["br", ...attrs]` with no content hole (verified against the installed dist), same
// childless-leaf shape `horizontalRule` above already renders self-closed. Before this case
// existed, an unrecognized `hardBreak` fell through to `default`'s `renderNodes(content, ...)`
// — since a leaf node's `content` is always `undefined`, that resolved to `""`: the line break
// silently vanished on the public site with no error and no visible difference in the editor.
function renderDocHardBreak(): string {
  return "<br/>";
}

function renderDocMention({ node, deps }: DocNodeHandlerRequired, _optional = {}): string {
  // Mention (`@tiptap/extension-mention`, toolbar-polish pass 2026-08-11) — the toolbar's
  // "Mention a post" picker (`PostEditor.tsx`) inserts `{ id: <mentioned post's slug>, label:
  // <its title> }` (see `rules.ts`'s own comment, which already documents this case's contract
  // before this case existed). Before this case existed, the node fell through to `default`'s
  // `renderNodes(content, ...)`: `mention` is an atom/leaf node (`atom: true`, no content hole
  // — confirmed against the installed `@tiptap/extension-mention` dist), so `content` is always
  // `undefined` and that resolved to `""` — the whole mention silently vanished on the public
  // site with no error, same shape as the historical `textAlign`/`underline`/`strike`/
  // `hardBreak` bugs this file's own header warns about.
  //
  // `id` is re-validated against the SAME `SLUG_FORMAT_PATTERN`/`MAX_SLUG_LENGTH` the post
  // feature itself enforces at write time (the host post feature) before it is trusted
  // into an `href` — defense-in-depth against `bodyJson` written some OTHER way (a direct API
  // call, pasted content), the same reasoning `safeCssColor`/`safeCssFontFamily`/
  // `safeCssLength` already state for their own allowlists above. Anything that fails
  // validation, or has no `label`, renders nothing rather than a dead or malformed link — never
  // a raw, unescaped attribute dump.
  //
  // Link text is `"@" + label`, matching the editor's own default `renderText`
  // (`${suggestion?.char ?? '@'}${node.attrs.label ?? node.attrs.id}`) so the public page shows
  // the identical text an author saw while writing, not a divergent public-only presentation.
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const id = typeof attrs.id === "string" ? attrs.id : "";
  const label = typeof attrs.label === "string" ? attrs.label : "";
  if (id.length === 0 || id.length > MAX_SLUG_LENGTH || !SLUG_FORMAT_PATTERN.test(id) || label.length === 0) {
    return "";
  }
  return `<a class="${escapeHtml({ text: deps.host.classes.postMention })}" href="/${escapeHtml({ text: id })}">@${escapeHtml({ text: label })}</a>`;
}

/**
 * Renders a `widgetEmbed` node — REQ-18/REQ-21 (see inline comment below) — through the resolved
 * widget IR, optionally wrapped in a `<div class="widget-embed …">` carrying the node's own
 * `attrs.cssClass`/`attrs.htmlAttributes` (D5, 2026-09-23 embed-attributes-everywhere plan), the
 * SAME two per-node style fields {@link renderDocMedia} already supports. A bare node (neither
 * field set, the common case today) renders BYTE-IDENTICAL to before this task — no wrapper at
 * all — so every existing page keeps its exact output.
 *
 * `htmlAttributes` reuses the exact shared allowlist boundary ({@link resolveEmbedHtmlAttributes}) —
 * no extra restriction beyond it (S1, 2026-09-23 widget-attrs plan removed the old data-/aria- prefix
 * -only narrowing this wrapper used to apply on top: the base allowlist itself now covers `style`/`id`/
 * `class`/etc., so a second, narrower filter here would only take away what the owner asked to keep
 * for widget styling/animation). A rejected token (an `on*` handler, an unsafe URL/style value, a
 * disallowed name) is dropped ON ITS OWN — every other token in the same string still lands — except
 * `malformed` syntax, which still empties the whole map (see `html-attributes.ts`'s own header).
 * `htmlAttributes`' own `class` token, if present, is appended after `cssClass` rather than emitted
 * as a second `class` attribute — the same fold {@link renderImageTag}/{@link renderVideoTag} apply
 * via {@link foldHtmlAttributesClass}, just built from `cssClass` directly here since a widget node
 * has no separate marker-class source to layer under it.
 *
 * @complexity O(n) in `attrs.htmlAttributes`'s length (one allowlist parse), O(k) in its resulting
 * attribute count for the class fold and formatting.
 */
function renderDocWidgetEmbed({ node, deps }: DocNodeHandlerRequired, _optional = {}): string {
  // REQ-18/REQ-21: a block-level atom node carrying a single widget-instance reference,
  // resolved server-side (by `resolvePageWidgets`, threaded in via `inlineResolved`) before this
  // content ever reaches a theme — the theme (declarative tier here, Liquid tier via
  // `liquid-worker.ts`'s `buildLiquidData` pre-computing `post.content`) never resolves a
  // `widgetEmbed` reference itself.
  const attrs = isObject(node.attrs) ? node.attrs : {};
  const placementId = typeof attrs.placementId === "string" ? attrs.placementId : undefined;
  const ir = placementId ? deps.inlineResolved.get(placementId) : undefined;
  const widgetHtml = deps.renderWidget(ir ?? WIDGET_PLACEHOLDER_IR);
  const { attributes, classes } = deps.host;

  // Each field counts only when it is a NON-EMPTY string (`str` maps any other type to "").
  const nodeCssClass = str({ value: attrs.cssClass }) || null;
  const nodeHtmlAttributes = str({ value: attrs.htmlAttributes }) || null;
  if (!nodeCssClass && !nodeHtmlAttributes) return widgetHtml;

  const parsedAttributes = attributes.resolveEmbedHtmlAttributes({ raw: nodeHtmlAttributes });
  const classAttr = mergeWidgetClassAttr({ baseClass: classes.widgetEmbed, nodeCssClass, attributesClass: parsedAttributes.class });
  const restAttributes = attributes.formatHtmlAttributes({ attributes: attributes.omitKey({ attributes: parsedAttributes, key: "class" }) });
  return `<div${classAttr}${restAttributes}>${widgetHtml}</div>`;
}

/**
 * Builds the widget wrapper's `class` attribute from the fixed `widget-embed` base plus the node's
 * own `cssClass` and, appended last, any `class` token inside its parsed `htmlAttributes` — the
 * SAME ordering {@link foldHtmlAttributesClass} applies for media (base/asset value first,
 * `htmlAttributes`' own `class` layered on top last). Always non-empty (the `widget-embed` base is
 * unconditional), unlike {@link mergeMediaClassAttr}, which returns `""` when there is nothing at
 * all to add.
 *
 * @param baseClass - the host-bound base class (`DocRenderClasses.widgetEmbed`), always first.
 * @param nodeCssClass - `attrs.cssClass`, already checked non-empty by the caller, or `null`.
 * @param attributesClass - `resolveEmbedHtmlAttributes(...).class`, already allowlist-validated,
 *   value-untouched — `undefined` when `htmlAttributes` carried no `class` token.
 * @complexity O(1).
 */
function mergeWidgetClassAttr({ baseClass, nodeCssClass, attributesClass }: { baseClass: string; nodeCssClass: string | null; attributesClass: string | undefined }, _optional = {}): string {
  const parts = [baseClass, nodeCssClass, attributesClass].filter((part): part is string => Boolean(part));
  return ` class="${escapeHtml({ text: parts.join(" ") })}"`;
}

/** {@link renderDocNode}'s own `content` extraction, pulled out so the ternary is counted once here
 *  instead of against the dispatcher's own already-tight budget (four optional params already cost
 *  one point each under this repo's complexity gate). */
function docNodeContent(node: JsonObject): JsonValue[] | undefined {
  return Array.isArray(node.content) ? node.content : undefined;
}

/** {@link renderDocNode}'s own handler lookup, pulled out for the same reason as
 *  {@link docNodeContent} just above. */
function resolveDocNodeHandler(node: JsonObject): DocNodeHandler | undefined {
  return typeof node.type === "string" ? DOC_NODE_HANDLERS[node.type] : undefined;
}

/** One handler per doc-node `type` — a lookup instead of the large `switch` this file used to
 *  dispatch on, so the number of node kinds stops being what drives {@link renderDocNode}'s own
 *  complexity (every `case` in a `switch` counts as a branch; an entry in this table does not,
 *  since it's data, not control flow). A `type` with no entry (any node kind this renderer doesn't
 *  recognize) falls through to `renderDocNode`'s own default: render children, exactly the old
 *  `switch`'s `default` case. */
/**
 * Exported (2026-09-11) for the identical reason {@link MARK_RENDERERS} now is — a drift guard in
 * `features/post/agent-tools.ts`'s own test suite reads these keys directly so a node type added
 * here again cannot silently go undocumented in the schema published to the model. Still read only
 * by {@link renderDocNode} inside this module; no dispatch behavior changes.
 */
export const DOC_NODE_HANDLERS: Record<string, DocNodeHandler> = {
  doc: renderDocDocNode,
  paragraph: renderDocParagraph,
  heading: renderDocHeading,
  title: renderDocTitle,
  text: renderDocText,
  bulletList: renderDocBulletList,
  orderedList: renderDocOrderedList,
  listItem: renderDocListItem,
  taskList: renderDocTaskList,
  taskItem: renderDocTaskItem,
  table: renderDocTable,
  tableRow: renderDocTableRow,
  tableCell: renderDocTableCell,
  tableHeader: renderDocTableHeader,
  blockquote: renderDocBlockquote,
  codeBlock: renderDocCodeBlock,
  horizontalRule: renderDocHorizontalRule,
  hardBreak: renderDocHardBreak,
  image: renderDocImage,
  media: renderDocMedia,
  youtube: renderDocYoutube,
  mention: renderDocMention,
  widgetEmbed: renderDocWidgetEmbed,
};

/**
 * Renders a TipTap/ProseMirror-style doc node to HTML. Unknown nodes render children.
 *
 * `inlineResolved` (SPEC-043/ADR-047 REQ-21) is optional and defaults to empty — every pre-existing
 * caller (this file's `entryContent`, `liquid-worker.ts`'s `buildLiquidData`, and every direct test
 * call) keeps working unchanged; a `widgetEmbed` node with no matching entry in the map (embeds are
 * only resolvable when the caller threads a real `resolvePageWidgets` result through, see
 * `renderSite`) degrades to the same public-safe placeholder REQ-28 requires, never a crash or a raw
 * dump of the node's attrs.
 *
 * `mediaTransformVersions` (the frozen rendition URL contract) is the same "optional, defaults to empty, degrades to the
 * placeholder" shape for the `image` case's `{assetId, transformName}` ref path — see that case's
 * own comment for the full resolution rule and the legacy-`src` backward-compat guarantee.
 *
 * `mediaAssetMetadata` (owner-directed quick-and-dirty sizing fix) is the same optional/defaults-
 * to-empty shape, keyed by `assetId` instead of `transformName` — see
 * `SiteRenderContext.mediaAssetMetadata`'s own doc.
 *
 * `renderWidget` is the injected widget renderer (see `DocNodeRenderDeps.renderWidget`); callers use
 * `renderDocNode`, which is this function with that port bound.
 */
export function renderDocNodeWith(
  { node, renderWidget, host }: { node: JsonValue; renderWidget: DocNodeRenderDeps["renderWidget"]; host: DocNodeRenderDeps["host"] },
  {
    inlineResolved = EMPTY_INLINE_RESOLVED,
    mediaTransformVersions = EMPTY_MEDIA_TRANSFORM_VERSIONS,
    mediaAssetMetadata = EMPTY_MEDIA_ASSET_METADATA,
    depth = 0,
  }: DocRenderOptions = {}
): string {
  if (!isObject(node)) return "";
  // Checked before anything else — an over-deep node does no further work at all, which is what
  // actually stops the recursion (a `depthLimitPlaceholder()` return has no `content` to walk).
  if (depth > MAX_RENDER_DEPTH) return depthLimitPlaceholder({ classes: host.classes });
  const content = docNodeContent(node);
  const deps: DocNodeRenderDeps = { inlineResolved, mediaTransformVersions, mediaAssetMetadata, depth, renderWidget, host };
  const handler = resolveDocNodeHandler(node);
  return handler ? handler({ node, content, deps }) : renderChildNodes({ content, deps });
}
