/** Gemini's legacy stream reports bare MCP names, indistinguishable from native tool names.
 * Correlation is only a candidate: the shared fold requires a real bridge row with equal input.
 * Keep native names/arguments intact for presentation and auditing. Pure, O(1). */
export function geminiToolCallReceipt({ event }: { event: Record<string, unknown> }, _options = {}): Record<string, unknown> {
  if (event.type !== 'tool_use' || typeof event.name !== 'string' || event.name.startsWith('mcp__')) return event;
  return { ...event, bridgeCall: { name: event.name, input: event.input } };
}
