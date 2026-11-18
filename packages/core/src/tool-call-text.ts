/**
 * Plain-words sentences the model reads about how to call a tool. One builder per sentence, so the
 * daemon route and an MCP host that name the same mistake say it the same way. Pure text: no I/O,
 * no ids minted, no clock, no `node:` import.
 */

/** The fixed tail of every unknown-tool answer: where the model finds a real id. */
const DISCOVERY_SENTENCE = 'Find tools with search_tools.';

/**
 * The sentence for a tool id that is not registered.
 *
 * `candidates` are the registered ids closest to what the caller typed (the caller ranks them; this
 * function only words them). The sentence never says the call was denied: nothing was refused, the
 * tool does not exist.
 *
 * @param required.toolId - The id the caller used, shown verbatim in quotes.
 * @param required.candidates - Closest registered ids, closest first; empty for none.
 * @returns `There is no tool named "x". Closest names: a, b. Find tools with search_tools.` or, with no candidates,
 *   `There is no tool named "x". Find tools with search_tools.`
 * @complexity O(c) for c candidates; no effects.
 */
export function unknownToolSentence(
  { toolId, candidates }: { readonly toolId: string; readonly candidates: readonly string[] },
  _optional: Record<string, never> = {},
): string {
  const closest = candidates.length > 0 ? ` Closest names: ${candidates.join(', ')}.` : '';
  return `There is no tool named "${toolId}".${closest} ${DISCOVERY_SENTENCE}`;
}

/**
 * The sentence for an id that names a group of tools, not one tool. The caller lists only members its own
 * registry holds; this function only words them. Like {@link unknownToolSentence} it never says the call was
 * denied: nothing was refused and nothing ran.
 *
 * @param required.familyId - The group id the caller used, shown verbatim in quotes.
 * @param required.members - The registered member ids to call instead, in the order to show them.
 * @returns `"fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.`
 * @complexity O(m) for m members; no effects.
 */
export function toolFamilySentence(
  { familyId, members }: { readonly familyId: string; readonly members: readonly string[] },
  _optional: Record<string, never> = {},
): string {
  return `"${familyId}" is a group of tools, not one tool. Call one of: ${members.join(', ')}.`;
}

/** The two gateway tools a caller falls back to when a tool is not published as its own tool. */
const GATEWAY_TOOL = 'execute_delegated_tool';
const READONLY_GATEWAY_TOOL = 'execute_readonly_delegated_tool';

/**
 * How to call one tool, written the way the model must type it.
 *
 * A published tool is called by its wire name (the name the transport assigned, which is not always its
 * registry id: ids with dots, hyphens or over the length limit are published as `tool_<readable>_<hash>`).
 * Any other tool is called through the gateway, which takes the registry id. The two forms never mix: the
 * wire name appears only in the first, the registry id only inside the gateway call.
 *
 * @param required.toolId - The registry id; used only in the gateway form.
 * @param optional.wireName - The name the publisher assigned; present means "call it directly".
 * @param optional.readOnly - A read-only tool goes through the read-only gateway.
 * @param optional.input - Arguments to show; omitted, the direct form has none and the gateway form shows `{}`.
 * @returns `name`, `name({...})`, or `execute_delegated_tool({"toolId":"id","input":{...}})`.
 * @complexity O(s) for s bytes of serialized input; no effects.
 */
export function toolCallText(
  { toolId }: { readonly toolId: string },
  { wireName, readOnly = false, input }: { readonly wireName?: string; readonly readOnly?: boolean; readonly input?: unknown } = {},
): string {
  if (wireName !== undefined) return input === undefined ? wireName : `${wireName}(${JSON.stringify(input)})`;
  const gateway = readOnly ? READONLY_GATEWAY_TOOL : GATEWAY_TOOL;
  return `${gateway}(${JSON.stringify({ toolId, input: input ?? {} })})`;
}
