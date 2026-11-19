import { ContentBlockSchema } from '@modelcontextprotocol/sdk/types.js';
export type { CallToolResult, Tool, ReadResourceResult, Resource, ListToolsResult, ListResourcesResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * True when `block` is a well-formed MCP content block this module will pass through verbatim rather
 * than JSON-stringify. Delegates to the pinned `@modelcontextprotocol/sdk`'s own `ContentBlockSchema`
 * (the same union `CallToolResultSchema.content` is defined against) instead of a hand-maintained list
 * of per-type shape checks — see this module's own doc for why that matters: a manually maintained
 * allowlist only ever covers the block types someone remembered to add, so the *next* protocol content
 * type (this SDK version already knows five: `text`, `image`, `audio`, `resource`, `resource_link`)
 * would silently fall back to the stringify path exactly like `resource` did before this fix. A block
 * that merely claims a recognized `type` but is missing/mistyping its required field(s) still fails
 * `safeParse` and falls back to the stringify path rather than being forwarded malformed.
 */
export function isPassthroughContentBlock({ block }: { block: unknown }, _optional: Record<string, never> = {}): boolean {
  return ContentBlockSchema.safeParse(block).success;
}

