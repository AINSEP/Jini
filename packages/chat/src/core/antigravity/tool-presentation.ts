/** Antigravity's saved CLI receipts use capitalized argument keys. Display only: never rewrite history. */
type Call = { name: string; input: unknown };

/** A transport envelope must name both server and tool before its arguments can be unwrapped. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Translate agy's MCP envelope and file arguments into the generic chat presentation contract.
 * Returns undefined for other shapes. Pure; O(k) when copying k file argument keys, otherwise O(1).
 */
export function antigravityToolPresentation({ name, input }: Call, _options: Record<string, never> = {}):
  (Call & { wrapper?: Call }) | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const args = input as Record<string, unknown>;
  if (name === 'read_file' && typeof args.Path === 'string') {
    return { name, input: { ...args, file_path: args.Path } };
  }
  if (name !== 'call_mcp_tool' || !nonEmptyString(args.ServerName) || !nonEmptyString(args.ToolName)) return undefined;
  const call = { name: args.ToolName, input: args.Arguments };
  return { ...call, wrapper: call };
}
