/** OpenCode joins server and tool with an underscore and can emit a completed call after its
 * bridge result. Preserve the receipt; only its correlation candidate uses the remote name.
 * A native snake-case tool cannot fold without a matching canonical bridge row. Pure, O(n). */
export function openCodeToolCallReceipt({ event }: { event: Record<string, unknown> }, _options = {}): Record<string, unknown> {
  if (event.type !== 'tool_use' || typeof event.name !== 'string' || event.name.startsWith('mcp__')) return event;
  const separator = event.name.indexOf('_');
  if (separator <= 0 || separator === event.name.length - 1) return event;
  return { ...event, bridgeCall: { name: event.name.slice(separator + 1), input: event.input, buffered: true } };
}
