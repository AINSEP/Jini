import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** Wire contracts come from the pinned SDK rather than a second protocol definition. */
export type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/** Parse a delegated tool's input schema at the SDK boundary; validation failures propagate. */
export function parseMcpToolInputSchema(
  { inputSchema }: { inputSchema: unknown },
  _options: Record<string, never> = {},
): Tool['inputSchema'] {
  return ToolSchema.shape.inputSchema.parse(inputSchema);
}
