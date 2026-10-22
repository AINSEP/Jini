/**
 * Formats a tool result's text for a person to read. Tool results travel to the model as compact
 * JSON (`@jini-ai/mcp`'s `okResult` — indentation made nested results ~2.5× larger), so a view that
 * shows one re-indents it here, at render time. Only a JSON object or array is re-indented; any other
 * text (shell output, an error message, a bare JSON scalar, something that merely starts with `{`)
 * comes back unchanged.
 *
 * @param text - A `tool_result` event's flattened `content`.
 * @returns The value re-serialized with two-space indentation, or `text` as given.
 * @complexity O(n) in `text.length`.
 */
export function formatToolOutputForDisplay({ text }: { text: string }): string {
  const trimmed = text.trim();
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}
