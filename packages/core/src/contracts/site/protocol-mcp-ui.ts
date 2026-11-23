/**
 * @file The `ui://` resource wire shape a tool result carries so a host knows to render a View
 * instead of handing text to the model. Types only.
 *
 * Additive copy of the declarations in `@jini-ai/protocol/mcp-ui` (`mcp-ui-resource.ts`); the
 * builders and parsers (`createUIResource`, `parseUIResource`) and the MIME constants stay there.
 * `@modelcontextprotocol/ext-apps` fixes `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"`, and
 * `@mcp-ui/server` declares the ``ui://${string}`` URI scheme and the wider MIME union reproduced in
 * {@link UIResourceMimeType}.
 */

/** The `ui://` URI scheme MCP Apps fixes for UI resources. */
export type UIResourceUri = `ui://${string}`;

/**
 * MIME types a UI resource may declare.
 *
 * `@jini-ai/protocol/mcp-ui` emits its `MCP_UI_MIME_TYPE`; the other two are accepted on the parse side because
 * the published union lists them — `text/html` for pre-standardization mcp-ui hosts and
 * `text/html+skybridge` for the Apps SDK adapter — and a resource built by some *other* server is
 * exactly the case its `parseUIResource` exists for.
 */
export type UIResourceMimeType = 'text/html' | 'text/html;profile=mcp-app' | 'text/html+skybridge';

/** The text-bearing UI resource body (mcp-ui's `HTMLTextContent`). `@jini-ai/protocol/mcp-ui` never emits the `blob` variant. */
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
