/**
 * Splits a tool handler's return value into the part the MODEL may see and the parts only a HUMAN
 * may see.
 *
 * ## Why this exists
 *
 * MCP's own model is that a tool result carries content blocks and the *host* decides which blocks
 * reach the model and which are rendered for the person. Keeping them in one payload is the
 * protocol; separating them is the host's job. Jini's daemon is the only actor standing in that
 * position — the spawned coding-agent CLI is not an MCP-UI host, and `okResult()`
 * (`@jini-ai/mcp`'s `tool-protocol.ts`) `JSON.stringify`s whatever it is handed into a single text
 * block. So a UI resource left in a handler's return value becomes ordinary model-visible context.
 *
 * That is not hypothetical. Tovu's `content_post_delete` returned
 * `{ content: [textBlock, uiResource] }` where the resource's inline `<script>` held a single-use
 * confirmation token, and the tool's own description told the model the token "is never shown to
 * you". The model could read it out of its own tool result and approve its own deletion. The split
 * this module performs is what makes that structurally impossible.
 *
 * ## Whitelist, not blacklist — the security boundary
 *
 * {@link splitToolResultSurfaces} does NOT look for known UI shapes and strip them. It keeps only
 * block types explicitly known to be model-safe (`text`) and routes **everything else** to the
 * human channel, including block types that did not exist when this was written.
 *
 * The direction of that default is the whole point. A blacklist fails OPEN: the first time the
 * MCP-UI spec adds a block type this file has never heard of, an unrecognised block sails through
 * into model context — exactly the leak being fixed, reintroduced silently. A whitelist fails
 * CLOSED: an unrecognised block is withheld from the model and rendered for the human, so the worst
 * case is a surface that renders oddly rather than a secret that escapes.
 *
 * **Do not "improve" this by enumerating UI types to remove.** If a new block type is genuinely
 * model-safe, add it to {@link MODEL_VISIBLE_BLOCK_TYPES} deliberately, with a reason.
 *
 * ## What is deliberately left alone
 *
 * A return value that is not an MCP content envelope (`{ content: [...] }`) passes through
 * untouched. The overwhelming majority of registered tools return plain JSON — a list of posts, an
 * id, a count — and are not making a model-vs-human distinction at all. Rewriting those would be a
 * behavioural change to every tool in the registry in service of a problem they do not have.
 */

/**
 * Block `type` values a tool result may show the model.
 *
 * `text` only, and deliberately so — see this module's header before adding to it. Anything absent
 * from this list is treated as human-only.
 */
export const MODEL_VISIBLE_BLOCK_TYPES: readonly string[] = ['text'];

/** One entry of an MCP tool result's `content` array. Structure beyond `type` is not this module's business. */
export type ToolResultBlock = Record<string, unknown>;

export interface SplitToolResultSurfaces {
  /**
   * What may be returned to the caller and therefore reach the model. Identical to the input
   * (same reference) when the value is not an MCP content envelope.
   */
  readonly modelOutput: unknown;
  /**
   * Blocks withheld from the model, in arrival order, for the host to render to the human. Empty
   * when nothing was withheld — the common case.
   */
  readonly surfaces: readonly ToolResultBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Partitions an MCP content envelope into model-visible and human-only halves.
 *
 * @param output - A tool handler's raw return value.
 * @returns `modelOutput` (safe to return to the agent) and `surfaces` (human-only blocks). A
 *   non-envelope value is passed through by reference with no surfaces.
 * @complexity O(n) in the number of content blocks.
 */
export function splitToolResultSurfaces(output: unknown): SplitToolResultSurfaces {
  if (!isRecord(output)) return { modelOutput: output, surfaces: [] };

  const content = output['content'];
  if (!Array.isArray(content)) return { modelOutput: output, surfaces: [] };

  const modelBlocks: unknown[] = [];
  const surfaces: ToolResultBlock[] = [];

  for (const block of content) {
    // A non-record block carries no `type` to check, so it cannot be shown to be model-safe.
    // Withheld rather than passed through, per this module's fail-closed rule.
    if (!isRecord(block)) {
      surfaces.push({ type: 'unknown', value: block });
      continue;
    }
    const type = block['type'];
    if (typeof type === 'string' && MODEL_VISIBLE_BLOCK_TYPES.includes(type)) {
      modelBlocks.push(block);
      continue;
    }
    surfaces.push(block);
  }

  if (surfaces.length === 0) return { modelOutput: output, surfaces: [] };

  return { modelOutput: { ...output, content: modelBlocks }, surfaces };
}
