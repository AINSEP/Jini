import { MAX_SLUG_LENGTH, SLUG_FORMAT_PATTERN } from "./slug.js";

import { TIPTAP_TEXT_BODY_EXAMPLE } from "./post-tool-schemas.js";
import { TIPTAP_MARK_SCHEMA, TIPTAP_TEXT_NODE_SCHEMA } from "./tiptap-text-schema.js";
import { BLOCK_NODE_REF, TIPTAP_BLOCK_NODE_SCHEMA } from "./tiptap-block-schema.js";

/**
 * The full TipTap/ProseMirror doc-node vocabulary, as a recursive JSON Schema (`$defs`/`$ref`) — the
 * one part of this catalog that needed real design rather than wiring (see file header). Every
 * `type` named in `$defs.blockNode`'s `oneOf` (block-level) or `$defs.inlineContent`'s `oneOf`
 * (inline, i.e. text-run-level) is a case `renderDocNode`/`renderNodes` actually switches on; nothing
 * here is speculative.
 *
 * `widgetEmbed` is a block-level atom (no `content`) referencing an existing widget instance's
 * placement — it is inserted/removed/reordered through `widgets_insert_embed`/`widgets_remove_embed`/
 * `widgets_reorder_embeds` (see `widgets/agent-tools.ts`), not hand-authored here; it is included in
 * this schema only so a model reading an EXISTING document's `bodyJson` back (via content_post_list/
 * content_post_get) can recognize the node rather than being surprised by an unfamiliar `type`.
 *
 * 2026-09-11 expansion — owner-reported incident: asked to put an already-uploaded image inside a
 * post, the assistant said an image "cannot" go in a post body and gave up, because this schema named
 * none of `image`/`youtube`/`mention`/the table family (`table`/`tableRow`/`tableCell`/`tableHeader`)/
 * `taskList`+`taskItem`/`hardBreak` — even though `renderDocNode` has always had a correct, tested
 * case for every one of them (`tiptap-render-contract.test.ts`). Brought into line with the renderer
 * for exactly those six node families; see each entry's own `description` below for its render target
 * and the attrs the renderer actually reads.
 *
 * `media` gets particular care. Only the REF-based shape — `attrs.assetId` + `attrs.transformName`
 * (ADR-027 §4's `bodyJson` contract, one generic node that dispatches by the asset's real content
 * type at render time rather than a `video` node forcing this same "another node type, another
 * schema entry, another renderer case" conversation for every future media kind) — is published
 * here; there is deliberately no `attrs.src` field at all. To embed media here, put it in the media
 * library first (`media_upload_asset`/`media_generate_asset`/`media_import_from_url`) and reference
 * it by id — exactly the `{assetId, transformName: "public"}` shape the admin editor's own
 * `insertMediaRef`/`insertMediaEmbed` commands write, never a hand-written URL. See `media`'s own
 * `description` below for the full guidance published to the model, and `render.ts`'s
 * `renderDocMedia` for the actual dispatch.
 *
 * `attrs.cssClass`/`attrs.htmlAttributes` (2026-09-11, per-post styling; widened 2026-09-23 by the
 * widget-attrs plan's S1): both OPTIONAL, same two field names and raw-text shape as the asset's own
 * metadata fields, layered over them per field at render time (`render.ts`'s
 * `mediaNodeStyleOverride` — node value wins when set, asset value otherwise). `htmlAttributes` is
 * re-validated at render time against the shared allowlist
 * (`Jini/packages/cms/src/widgets/markers/html-attributes.ts`'s `parseEmbedHtmlAttributes`) — class/id/style/
 * data- prefix/aria- prefix and more are kept; on-prefixed handlers, javascript:/vbscript:/data:
 * URLs and unsafe style values are dropped per token (every other accepted token in the same string
 * still lands); malformed text drops all. Rejected/dropped tokens are silently omitted from the tag
 * rather than rejected up front here, so this schema does not re-encode the allowlist itself; the
 * `description` strings below just tell the model what tends to be accepted.
 *
 * `image` — this schema's OWN entry for it, added earlier the same 2026-09-11 session (the incident
 * this file's header describes) — was removed from THIS SCHEMA later that same session, owner
 * decision: `media`'s REF shape is byte-identical to `image`'s (both resolve through `render.ts`'s
 * shared `tryRenderRefImage`), and a live-db check found exactly 14 posts with an `image` node, all
 * 14 already soft-deleted (0 of 46 live posts) — so there is no reason for an agent to author a NEW
 * `image` node when `media` covers the identical ground plus real video dispatch `image` never had.
 * `render.ts` keeps `DOC_NODE_HANDLERS.image`/`renderDocImage` (and its LEGACY `attrs.src`-only
 * fallback, `safeImageSrc`) very much alive and unchanged — deliberately NOT deleted, because a real
 * undo/import path (`features/post/reverters.ts`) can resurrect one of those 14 soft-deleted posts,
 * two of which are `src`-only and cannot be migrated to `media`. Only this schema's advertisement of
 * `image` as an authorable type is gone; the renderer still recognizes and correctly renders any
 * pre-existing `image` node, including one an undo brings back. Use `media` for every new
 * image/video reference.
 *
 * One deliberate omission, not an oversight:
 * - `title` (`DOC_NODE_HANDLERS`'s `title` case) is a real node type but renders EMPTY in this
 *   generic walk by design — `post.title`/`ctx.post.title` already print the title separately on
 *   every render path (`render.ts`'s own `renderDocTitle` doc explains why: printing it again here
 *   would duplicate it). Naming it in this schema would teach a model to author a node that always
 *   renders as nothing; a post/page's title is set through the `title` field
 *   `content_post_create`/`content_post_update` already take directly, not through `bodyJson`.
 */
export const TIPTAP_DOC_SCHEMA = {
  $defs: {
    mark: TIPTAP_MARK_SCHEMA,
    textNode: TIPTAP_TEXT_NODE_SCHEMA,
    // 2026-09-11: paragraph/heading's own attrs.textAlign — `alignStyleAttr` (render.ts) reads this
    // off BOTH node types and was undocumented (neither paragraph nor heading's attrs allowed it at
    // all, `additionalProperties: false` with no such key listed) — same schema-drift defect as
    // TIPTAP_MARK_SCHEMA's own 2026-09-11 note. "left" is valid JSON but a no-op: styleForAlign never
    // emits an explicit style for it (it's the CSS/HTML default), so omitting the attr entirely is
    // equivalent and preferred.
    textAlignValue: { type: "string", enum: ["left", "center", "right", "justify"], description: "Text alignment. 'left' is the default — omit the attr entirely rather than sending it explicitly." },
    inlineContent: {
      type: "array",
      items: {
        oneOf: [
          { $ref: "#/$defs/textNode" },
          {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: { type: { const: "hardBreak" } },
            description:
              "A forced line break WITHIN a run of text (like Shift+Enter) — not a way to separate two blocks; use two " +
              "paragraph/heading nodes for that. Renders as <br/>. Carries no content or attrs.",
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "attrs"],
            properties: {
              type: { const: "mention" },
              attrs: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label"],
                properties: {
                  id: {
                    type: "string",
                    pattern: SLUG_FORMAT_PATTERN.source,
                    maxLength: MAX_SLUG_LENGTH,
                    description:
                      "The mentioned post/page's SLUG (not its id) — the same 'slug' field content_post_create/" +
                      "content_post_list/content_post_get return.",
                  },
                  label: { type: "string", minLength: 1, description: "Display text shown after '@' — typically the mentioned post/page's title." },
                },
              },
            },
            description:
              'An inline "@mention" link to another post/page, by slug. Renders as <a class="post-mention" href="/{id}">@{label}</a>. ' +
              "Re-validated at render time: an id failing the slug shape above, or an empty label, renders as NOTHING (no broken link, " +
              "no error) rather than a dead href — confirm the slug belongs to a real, non-trashed post/page before using it.",
          },
        ],
      },
      description:
        "Inline content — this codebase's renderer supports 'text' (formatted text runs), 'hardBreak' (forced line break), and " +
        "'mention' (an inline link to another post/page) here; no other inline node type.",
    },
    blockNode: TIPTAP_BLOCK_NODE_SCHEMA,
    listItemNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: { type: { const: "listItem" }, content: { type: "array", items: { $ref: BLOCK_NODE_REF } } },
      description: "One list item. content is ordinary block content (typically a single paragraph, optionally followed by a nested bulletList/orderedList).",
    },
    taskItemNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: {
        type: { const: "taskItem" },
        attrs: {
          type: "object",
          additionalProperties: false,
          properties: { checked: { type: "boolean", description: "Whether the checkbox renders checked. Defaults to unchecked when omitted." } },
        },
        content: {
          type: "array",
          items: { $ref: BLOCK_NODE_REF },
          description: "Ordinary block content — in practice a single paragraph. This renderer does not support a nested sub-checklist inside a taskItem.",
        },
      },
      description:
        "One checklist item. Renders publicly as an INERT checkbox — disabled, since there is no live toggle handler on the public " +
        "site; it reflects attrs.checked at render time only, clicking it does nothing.",
    },
    tableCellAttrs: {
      type: "object",
      additionalProperties: false,
      properties: {
        colspan: { type: "integer", minimum: 1, maximum: 1000, description: "Defaults to 1 (omitted) when unset." },
        rowspan: { type: "integer", minimum: 1, maximum: 1000, description: "Defaults to 1 (omitted) when unset." },
        align: {
          type: "string",
          enum: ["left", "center", "right"],
          description: "Text alignment for THIS cell only. 'justify' is not supported for a table cell and is ignored, same as omitting the attr. Omit for the default (left).",
        },
      },
      description: "Shared attrs shape for tableCell and tableHeader.",
    },
    tableCellNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: {
        type: { const: "tableCell" },
        attrs: { $ref: "#/$defs/tableCellAttrs" },
        content: { type: "array", items: { $ref: BLOCK_NODE_REF }, description: "Ordinary block content — typically a single paragraph." },
      },
      description: "A regular data cell. Renders as <td>.",
    },
    tableHeaderNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: {
        type: { const: "tableHeader" },
        attrs: { $ref: "#/$defs/tableCellAttrs" },
        content: { type: "array", items: { $ref: BLOCK_NODE_REF }, description: "Ordinary block content — typically a single paragraph." },
      },
      description: "A header cell. Renders as <th>. Same attrs as tableCell (colspan/rowspan/align).",
    },
    tableRowNode: {
      type: "object",
      additionalProperties: false,
      required: ["type", "content"],
      properties: {
        type: { const: "tableRow" },
        content: { type: "array", items: { oneOf: [{ $ref: "#/$defs/tableCellNode" }, { $ref: "#/$defs/tableHeaderNode" }] } },
      },
      description: "One table row. Renders as <tr>; content must be tableCell/tableHeader nodes only.",
    },
  },
  type: "object",
  additionalProperties: false,
  required: ["type", "content"],
  properties: {
    type: { const: "doc" },
    content: { type: "array", items: { $ref: BLOCK_NODE_REF } },
  },
  description:
    "A TipTap/ProseMirror document: { type: 'doc', content: [...blockNode] }. An empty document is { type: 'doc', content: [] }. " +
    `Complete text body example: ${TIPTAP_TEXT_BODY_EXAMPLE}. ` +
    "Every node type named anywhere in this schema's $defs (blockNode's oneOf for block-level nodes, inlineContent's oneOf for " +
    "inline ones) is one this codebase's renderer actually recognizes — an unrecognized type is not rejected, but silently renders " +
    "its children only, losing its own formatting (matching renderDocNode's default case).",
} as const;
