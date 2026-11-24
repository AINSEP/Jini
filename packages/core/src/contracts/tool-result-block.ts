/**
 * @file The one declaration of a tool-result content block, shared by every layer that carries a tool
 * result to a model provider: the daemon's BYOK meta-tool mapping produces it and each provider
 * protocol adapter in the agent runtime consumes it. Type-only; declaring it here keeps the producer
 * and the consumer from redeclaring (and drifting from) each other's copy.
 */

/**
 * One block of a tool result that carries more than text — the MCP content-block shape
 * (`{type:'image', mimeType, data}`) a registered tool returns, e.g. `media_view_image`. Each
 * provider protocol adapter maps it onto that provider's own image part; nothing in this shape is
 * provider-specific.
 */
export type ToolResultContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string };
