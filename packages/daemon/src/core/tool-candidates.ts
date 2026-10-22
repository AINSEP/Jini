import type { ToolDescriptor } from '@jini-ai/core';

/** Registered prefix matches for unknown-tool diagnostics, in catalog order, capped at eight.
 * @complexity O(n) time and space over n registered tools. */
export function toolCandidates(
  { toolId, tools }: { toolId: string; tools: readonly Pick<ToolDescriptor, 'id'>[] },
  _optional: Record<string, never> = {},
): string[] {
  return tools.map((tool) => tool.id).filter((id) => id.startsWith(toolId)).slice(0, 8);
}
