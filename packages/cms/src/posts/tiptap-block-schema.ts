import type { PostSchemaToolNames } from "./post-tool-schemas.js";

export const BLOCK_NODE_REF = "#/$defs/blockNode" as const;

/** The block nodes whose copy names no host tool. */
const PLAIN_BLOCK_NODES = [
  {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { const: "paragraph" },
      attrs: {
        type: "object",
        additionalProperties: false,
        properties: { textAlign: { $ref: "#/$defs/textAlignValue" } },
        description: "Omit entirely for the default (left).",
      },
      content: { $ref: "#/$defs/inlineContent" },
    },
    // `content` is optional on the three inline-content blocks: the editor saves an empty one
    // without it, and the MCP server validates strictly, so requiring it fails a valid document.
    description: "A paragraph. Renders as <p>. Omit content for an empty paragraph.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { const: "heading" },
      attrs: {
        type: "object",
        additionalProperties: false,
        required: ["level"],
        properties: {
          level: { type: "integer", minimum: 1, maximum: 6, description: "Heading level 1-6 (h1-h6). Defaults to 2 if attrs/level is omitted entirely." },
          textAlign: { $ref: "#/$defs/textAlignValue" },
        },
      },
      content: { $ref: "#/$defs/inlineContent" },
    },
    description: "A heading. Renders as <h1>-<h6> per attrs.level.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "content"],
    properties: { type: { const: "bulletList" }, content: { type: "array", items: { $ref: "#/$defs/listItemNode" } } },
    description: "An unordered list. Renders as <ul>; content must be listItem nodes only.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "content"],
    properties: { type: { const: "orderedList" }, content: { type: "array", items: { $ref: "#/$defs/listItemNode" } } },
    description: "An ordered list. Renders as <ol>; content must be listItem nodes only.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "content"],
    properties: { type: { const: "taskList" }, content: { type: "array", items: { $ref: "#/$defs/taskItemNode" } } },
    description: "A checklist. Renders as <ul data-type=\"taskList\">; content must be taskItem nodes only.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "content"],
    properties: { type: { const: "blockquote" }, content: { type: "array", items: { $ref: BLOCK_NODE_REF } } },
    description: "A blockquote. Renders as <blockquote>, wrapping ordinary block content (typically paragraphs).",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: { const: "codeBlock" },
      attrs: {
        type: "object",
        additionalProperties: false,
        properties: {
          language: {
            type: "string",
            pattern: "^[a-zA-Z0-9-]{1,32}$",
            description:
              "A language name/alias for client-side syntax highlighting, e.g. 'python', 'objective-c' (highlight.js-style " +
              "names). Emitted as a 'language-<value>' CSS class only — this renderer does no server-side highlighting itself, " +
              "and does not check the name against a real language list, so an unrecognized-but-safe name is harmless (it just " +
              "matches no theme's highlighter). Omit for a plain, unhighlighted code block.",
          },
        },
      },
      content: { $ref: "#/$defs/inlineContent" },
    },
    description: "A preformatted code block. Renders as <pre><code>. Marks on its text nodes are typically omitted.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: { type: { const: "horizontalRule" } },
    description: "A horizontal rule. Renders as <hr/>. Carries no content or attrs.",
  },
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "content"],
    properties: { type: { const: "table" }, content: { type: "array", items: { $ref: "#/$defs/tableRowNode" } } },
    description:
      "A table. Renders as <table>; content must be tableRow nodes only. No column-resize/width state is preserved — " +
      "every column renders at its natural width (plain table-layout: auto).",
  },
] as const;

/** Media embed node; its copy points the model at the host's media tools. */
function mediaBlockNode({ tools }: { tools: PostSchemaToolNames }, _options: Record<string, never> = {}) {
  return (
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "attrs"],
      properties: {
        type: { const: "media" },
        attrs: {
          type: "object",
          additionalProperties: false,
          required: ["assetId", "transformName"],
          properties: {
            assetId: {
              type: "string",
              minLength: 1,
              description:
                `The id of an EXISTING media asset already in the library — the 'id' returned by ${tools.mediaUpload}/` +
                `${tools.mediaGenerate}/${tools.mediaImportFromUrl}, or by ${tools.mediaRead}. There is no way to embed an ` +
                "arbitrary external URL through this tool: put it in the media library first, then reference it here by id.",
            },
            transformName: {
              const: "public",
              description:
                "Always the literal string 'public' — required even for a video asset, which ignores it at render time (there is " +
                "no transform pipeline for video). The SAME value the admin editor's own media insert command always writes.",
            },
            alt: {
              type: "string",
              description:
                "Accessibility alt text for an image asset, or the <video> element's fallback text for a video asset. Also shown " +
                "as the placeholder's label if the asset can no longer be resolved. Omit for empty alt text.",
            },
            cssClass: {
              type: "string",
              description:
                "Optional CSS class applied to the rendered <img>/<video> tag for THIS post only (e.g. to left/right-align this " +
                "one usage, or resize it, without changing the asset's own default styling used elsewhere). Wins over the asset's " +
                "own class when both are set. Omit to inherit the asset's own class, if any.",
            },
            htmlAttributes: {
              type: "string",
              description:
                "Optional extra HTML attributes applied to the rendered tag for THIS post only, e.g. 'style=\"opacity:0\"', " +
                "'id=\"hero\"', 'data-kui=\"hero\"', or a bare boolean attribute like 'muted'. Wins over the asset's own " +
                "htmlAttributes when both are set. class/id/style/data-*/aria-* and more are kept; event handler attributes " +
                "(onclick, onerror, …), javascript:/vbscript:/data: URLs and unsafe style values are dropped one at a time at " +
                "render time (every other attribute in the string still lands); malformed text drops the whole string. " +
                "Omit to inherit the asset's own attributes, if any.",
            },
          },
        },
      },
      description:
        "A media embed referencing an EXISTING media asset by id — never a raw src URL (see this schema's own top-level doc for " +
        "why). Use this one node for images AND videos: the public renderer picks the real <img> or <video> tag itself " +
        "from the asset's actual stored content type, so a video asset's id renders a real, playable <video>. Check " +
        `${tools.mediaRead}'s own 'publicUrl' first if unsure: a '/original' path means video, a '/public.v….../image.….' ` +
        "path means image — either kind renders correctly through this one node either way.",
    }
  ) as const;
}

const YOUTUBE_BLOCK_NODE = (
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "attrs"],
    properties: {
      type: { const: "youtube" },
      attrs: {
        type: "object",
        additionalProperties: false,
        required: ["src"],
        properties: {
          src: {
            type: "string",
            description:
              "A YouTube URL in any common shape, e.g. 'https://www.youtube.com/watch?v=VIDEOID', 'https://youtu.be/VIDEOID', " +
              "or an already-'/embed/VIDEOID' URL. Only the video id is extracted server-side and re-embedded via " +
              "youtube-nocookie.com (privacy-enhanced mode, always on) — a URL this renderer cannot recognize as YouTube " +
              "degrades to a placeholder rather than an error.",
          },
          start: { type: "integer", minimum: 1, maximum: 999999, description: "Optional start time in seconds into the video. Omit to start at the beginning." },
        },
      },
    },
    description:
      "An embedded YouTube video. Renders as a responsive 16:9 <iframe>. width/height attrs are NOT read by this renderer " +
      "(the theme always sizes it responsively) — do not set them.",
  }
) as const;

/** Widget embed node; its copy points the model at the host's embed-insert tool. */
function widgetEmbedBlockNode({ tools }: { tools: PostSchemaToolNames }, _options: Record<string, never> = {}) {
  return (
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "attrs"],
      properties: {
        type: { const: "widgetEmbed" },
        attrs: {
          type: "object",
          additionalProperties: false,
          required: ["placementId"],
          properties: {
            placementId: { type: "string", description: `An existing embed placement id, as returned by ${tools.widgetInsertEmbed}.` },
            // B190: the admin editor stamps this on every embed it inserts; without it listed here,
            // strict validation made a model strip it and the post lost which widget it shows.
            widgetEntryId: { type: "string", description: "The widget this embed shows. Keep it when present." },
            content: { type: "object", description: "Optional per-placement Media content overriding saved config; slug items or raw HTML." },
            // Listed so strict MCP validation keeps a node that already carries them (a model would
            // otherwise strip them to pass, losing the post's styling); see the description below.
            cssClass: { type: "string", description: "Optional per-post CSS class on the embed's wrapper. Keep it when present." },
            htmlAttributes: { type: "string", description: "Optional per-post extra HTML attributes on the embed's wrapper, re-validated at render time. Keep them when present." },
          },
        },
      },
      description:
        `A block-level widget embed reference (see this schema's own top-level doc). Read-and-recognize only through this tool — author new embeds via ${tools.widgetInsertEmbed}, not by hand-writing this node. ` +
        "The node MAY also carry attrs.cssClass/attrs.htmlAttributes (2026-09-23, per-post styling, same two optional raw-text fields the media node supports — see media's own description above): " +
        "For Media widgets, attrs.content is an optional placement override: {items:[{slug:<media-slug>,alt?,caption?}],layout:single|grid|carousel|masonry} or {mode:html,html:<HTML>}. Slugs resolve through the media library; raw HTML supports {{media:slug}} and data-media-slug and uses the page-body sanitizer. " +
        "render.ts's renderDocWidgetEmbed wraps the rendered widget in a <div class=\"widget-embed …\"> carrying them when set, or renders unwrapped when both are absent. htmlAttributes is re-validated " +
        "at render time against the SAME shared allowlist the media node uses (2026-09-23 widget-attrs plan, S1) — class/id/style/data-*/aria-* and more are kept; on* handlers, javascript:/vbscript:/data: " +
        "URLs and unsafe style values are dropped one token at a time (every other accepted token in the same htmlAttributes string still lands, e.g. data-x and style survive even when onclick is present); " +
        "malformed text drops the whole string. Rejected tokens are silently omitted rather than rejected up front here. Listed in this node's attrs so a node that already carries them " +
        `validates, but authoring still goes through ${tools.widgetInsertEmbed}, not this tool — keep these attrs when you re-encounter a node that already carries them.`,
    }
  ) as const;
}

/** The recursive `blockNode` definition of the post body schema; `tools` names the host tools its copy cites. */
export function tiptapBlockNodeSchema({ tools }: { tools: PostSchemaToolNames }, _options: Record<string, never> = {}) {
  return {
    oneOf: [...PLAIN_BLOCK_NODES, mediaBlockNode({ tools }), YOUTUBE_BLOCK_NODE, widgetEmbedBlockNode({ tools })],
  } as const;
}
