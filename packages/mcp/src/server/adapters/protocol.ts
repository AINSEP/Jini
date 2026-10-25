import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** Wire contracts come from the pinned SDK rather than a second protocol definition. */
export type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/** Parse a delegated tool's input schema at the SDK boundary; a malformed one names <toolId>.inputSchema. */
export function parseMcpToolInputSchema(
  { inputSchema, toolId }: { inputSchema: unknown; toolId: string },
  _options: Record<string, never> = {},
): Tool['inputSchema'] {
  const parsed = ToolSchema.shape.inputSchema.safeParse(inputSchema);
  if (!parsed.success) throw new Error(`${toolId}.inputSchema: ${parsed.error.message}`);
  return parsed.data;
}
