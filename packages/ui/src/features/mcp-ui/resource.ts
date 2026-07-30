/**
 * @module features/mcp-ui/resource
 *
 * The `ui://` resource half of MCP-UI: the wire shape a tool result carries so a host knows to
 * render a View instead of handing text to the model, plus the parser a host uses to recognize one.
 *
 * This is the piece `@jini-ai/agentic`'s `mcp-ui-apps.ts` deliberately does not model — that module
 * owns the JSON-RPC envelope crossing the iframe boundary once a View exists; nothing there says
 * how a View comes to exist in the first place. That comes from the resource conventions:
 * `@modelcontextprotocol/ext-apps` fixes `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"` and
 * `RESOURCE_URI_META_KEY = "ui/resourceUri"`, and `@mcp-ui/server` declares the
 * ``ui://${string}`` URI scheme and the wider MIME union reproduced in
 * {@link UIResourceMimeType}.
 *
 * Ported from Tovu's `src/assistant/mcp-ui.ts`, minus that file's hand-rolled copy of the JSON-RPC
 * envelope and its `UIActionResult` union: Tovu declared those because its tsconfig's
 * `moduleResolution: "Node"` cannot read a modern package's `exports` map, and this package has no
 * such constraint — the envelope comes from `protocol.ts`'s re-exports instead. See
 * `surfaces/bridge.ts` for why the legacy `{type:'tool', payload}` action shape is not emitted.
 */

/** The `ui://` URI scheme MCP Apps fixes for UI resources. */
export type UIResourceUri = `ui://${string}`;

/**
 * MIME types a UI resource may declare.
 *
 * This package emits {@link MCP_UI_MIME_TYPE}; the other two are accepted on the parse side because
 * the published union lists them — `text/html` for pre-standardization mcp-ui hosts and
 * `text/html+skybridge` for the Apps SDK adapter — and a resource built by some *other* server is
 * exactly the case {@link parseUIResource} exists for.
 */
export type UIResourceMimeType = 'text/html' | 'text/html;profile=mcp-app' | 'text/html+skybridge';

/**
 * `RESOURCE_MIME_TYPE` from `@modelcontextprotocol/ext-apps` — the standardized MIME type for
 * sandboxed HTML, chosen over the bare legacy `text/html` because it is the one SEP-1865 fixed and
 * mcp-ui's own client accepts it either way.
 */
export const MCP_UI_MIME_TYPE: UIResourceMimeType = 'text/html;profile=mcp-app';

/** Every MIME type {@link parseUIResource} will accept, widest-first. */
export const UI_RESOURCE_MIME_TYPES: readonly UIResourceMimeType[] = [
  'text/html',
  'text/html;profile=mcp-app',
  'text/html+skybridge',
];

/**
 * `RESOURCE_URI_META_KEY` from `@modelcontextprotocol/ext-apps` — the `_meta` key a tool uses to
 * point at a *pre-registered* UI template rather than carrying the HTML inline.
 *
 * This package builds inline resources (the original mcp-ui shape), so nothing here writes this
 * key. It is exported so that a consumer adopting the template-registration flow uses the spec's
 * key rather than inventing one.
 */
export const MCP_UI_RESOURCE_URI_META_KEY = 'ui/resourceUri';

/** `UI_METADATA_PREFIX` from `@mcp-ui/server` — the namespace for mcp-ui's resource `_meta` hints. */
export const MCP_UI_METADATA_PREFIX = 'mcpui.dev/ui-';

/** The `_meta` key a host reads to size the frame instead of guessing. Value is a `[width, height]` CSS-length pair. */
export const MCP_UI_PREFERRED_FRAME_SIZE_META_KEY = `${MCP_UI_METADATA_PREFIX}preferred-frame-size`;

/** The text-bearing UI resource body (mcp-ui's `HTMLTextContent`). This package never emits the `blob` variant. */
export interface UIResourceContent {
  readonly uri: UIResourceUri;
  readonly mimeType: UIResourceMimeType;
  readonly text: string;
  readonly _meta?: Readonly<Record<string, unknown>>;
}

/**
 * An MCP `EmbeddedResource` carrying UI — the object a tool result's `content` array holds, and the
 * object a host hands to its View renderer.
 */
export interface UIResource {
  readonly type: 'resource';
  readonly resource: UIResourceContent;
}

/** An MCP text content block — the model-readable half of a tool result. */
export interface TextContent {
  readonly type: 'text';
  readonly text: string;
}

/**
 * A tool result carrying both a model-readable text block and a human-facing UI resource.
 *
 * The split between the two halves is a security boundary, not formatting. Per MCP Apps' own
 * security model a host renders the UI resource for the USER and does not feed its HTML to the
 * model — so a secret embedded in the HTML is a secret the model never sees, while anything in
 * `text` is something the model reads. `confirmation-store.ts`'s whole reason for existing depends
 * on exactly that split.
 */
export interface UIToolResult {
  readonly content: readonly [TextContent, UIResource];
  readonly _meta?: Readonly<Record<string, unknown>>;
}

/**
 * Builds a UI resource from self-contained HTML.
 *
 * @param spec.uri - The `ui://` identifier for this resource instance. A host may log, cache, or
 * show it, so it must never carry a secret — key it by entity and version instead.
 * @param spec.htmlString - Self-contained HTML. It renders in a sandboxed, opaque-origin iframe
 * with no bundler and no network, so it must inline everything it needs; use `surfaces/` to build
 * one rather than hand-rolling.
 * @param spec.preferredFrameSize - `[width, height]` CSS lengths, written to the `_meta` key mcp-ui
 * hosts read.
 * @param spec.meta - Extra `_meta` entries, merged after `preferredFrameSize` so a caller can
 * override it.
 * @returns The `EmbeddedResource` to place in a tool result's `content` array.
 * @complexity O(1).
 */
export function createUIResource(spec: {
  uri: UIResourceUri;
  htmlString: string;
  preferredFrameSize?: readonly [string, string];
  meta?: Readonly<Record<string, unknown>>;
}): UIResource {
  const meta: Record<string, unknown> = {
    ...(spec.preferredFrameSize === undefined
      ? {}
      : { [MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]: [...spec.preferredFrameSize] }),
    ...spec.meta,
  };
  return {
    type: 'resource',
    resource: {
      uri: spec.uri,
      mimeType: MCP_UI_MIME_TYPE,
      text: spec.htmlString,
      ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
    },
  };
}

/**
 * Assembles the two-part tool result: what the MODEL is told, and what the HUMAN is shown.
 *
 * @param spec.modelText - The model-readable block. Must not contain anything the UI resource keeps
 * from the model (see {@link UIToolResult}).
 * @param spec.ui - The UI resource, rendered to the human only.
 * @param spec.meta - Optional result-level `_meta`.
 * @complexity O(1).
 */
export function buildUIToolResult(spec: {
  modelText: string;
  ui: UIResource;
  meta?: Readonly<Record<string, unknown>>;
}): UIToolResult {
  return {
    content: [{ type: 'text', text: spec.modelText }, spec.ui],
    ...(spec.meta === undefined ? {} : { _meta: spec.meta }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows an arbitrary value to a {@link UIResource}.
 *
 * The host side needs this because a tool result reaches it as `unknown` — it arrives over a
 * transport from a server this package does not control, so "the resource is well-formed" is a
 * claim to be checked, not assumed. A resource that fails any check is not rendered at all rather
 * than rendered partially: a frame built from a non-string `text` would be `srcdoc="undefined"`,
 * which renders as a visible, confusing blank rather than an honest absence.
 *
 * @param value - A candidate resource, e.g. one entry of a tool result's `content` array.
 * @returns The narrowed resource, or `undefined` when the value is not one.
 * @complexity O(1) — `text` is not scanned, only type-checked.
 */
export function parseUIResource(value: unknown): UIResource | undefined {
  if (!isRecord(value) || value['type'] !== 'resource') return undefined;
  const resource = value['resource'];
  if (!isRecord(resource)) return undefined;

  const uri = resource['uri'];
  if (typeof uri !== 'string' || !uri.startsWith('ui://')) return undefined;

  const mimeType = resource['mimeType'];
  if (typeof mimeType !== 'string') return undefined;
  if (!UI_RESOURCE_MIME_TYPES.includes(mimeType as UIResourceMimeType)) return undefined;

  const text = resource['text'];
  if (typeof text !== 'string') return undefined;

  const meta = resource['_meta'];
  return {
    type: 'resource',
    resource: {
      uri: uri as UIResourceUri,
      mimeType: mimeType as UIResourceMimeType,
      text,
      ...(isRecord(meta) ? { _meta: meta } : {}),
    },
  };
}

/**
 * Reads the `[width, height]` frame-size hint a resource's `_meta` may carry.
 *
 * @returns The pair, or `undefined` when absent or malformed — a host that gets `undefined` should
 * size the frame itself rather than trusting a half-present hint.
 */
export function readPreferredFrameSize(resource: UIResource): readonly [string, string] | undefined {
  const raw = resource.resource._meta?.[MCP_UI_PREFERRED_FRAME_SIZE_META_KEY];
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const [width, height] = raw as readonly unknown[];
  if (typeof width !== 'string' || typeof height !== 'string') return undefined;
  return [width, height];
}
