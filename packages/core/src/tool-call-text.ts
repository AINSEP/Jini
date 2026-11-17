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
