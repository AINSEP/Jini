/**
 * Extracts UI-renderable media blocks from a tool handler's raw MCP-style content envelope
 * (`{ content: [...] }`), for `delegated-tool-bridge.ts` and `agent-executor.ts` to attach to the
 * `tool_result` wire event's new `media` field (`@jini-ai/protocol`'s `events.ts`).
 *
 * ## Why this is not `tool-result-surfaces.ts`
 *
 * That module's whitelist governs a SECURITY property: which blocks may reach the model versus
 * which are withheld for a human-only UI resource (MCP-UI, still deferred). This module answers a
 * different question — "does this block carry displayable media a chat pane can render inline" —
 * and is deliberately narrower: it recognizes exactly one block type today (`image`), and has no
 * withhold-from-model concept of its own.
 *
 * The two DO interact, though not by pipelining: `delegated-tool-bridge.ts`'s `execute()` calls both
 * of them against the SAME raw `executed.output`, not this module's `remainder` into
 * `splitToolResultSurfaces`. That used to be pipelined — this module removed recognized image
 * blocks from `content` before the surfaces pass ran, because `splitToolResultSurfaces`'s whitelist
 * used to recognize only `text`, and an image block left in place would have been swept into
 * `surfaces` and withheld from the model. Now that `image` is itself one of
 * `tool-result-surfaces.ts`'s `MODEL_VISIBLE_BLOCK_TYPES` (a deliberate addition — see that
 * constant's own doc), the surfaces pass classifies an image block correctly on its own, so there is
 * no misclassification left to prevent by removing it first. This module's `remainder` field is
 * therefore no longer read by that caller at all (kept for this module's own tests and any future
 * caller that wants a de-imaged copy); only `media` is used, to populate the `tool_result` event's
 * sibling `media` field for a UI that wants to render inline without re-parsing `content`.
 *
 * ## Why only `image`, and why blocks are silently skipped rather than reported
 *
 * `text` blocks already reach the model (and the UI, via `content`) through the existing flattened
 * string — duplicating them into `media` would be redundant, not additive, so this module leaves
 * them in `remainder` and never collects them. A block claiming `type: 'image'` without a string
 * `mimeType`/`data` is dropped rather than surfaced as a malformed-block error: a handler's return
 * value is untrusted input to this module (it may come from an external MCP server), and the
 * contract is "render what is well-formed, ignore what isn't" — the same fail-quiet posture
 * `serializeDelegatedToolOutput` already takes on a non-serializable output.
 */

/** One MCP-style text content block. Part of the recognized envelope shape but never collected —
 *  see this module's doc for why `text` blocks stay out of `media`. Exported so a caller narrowing
 *  `ToolResultMediaBlock.type` has both arms of the union in scope. */
export interface ToolResultTextBlock {
  readonly type: 'text';
  readonly text: string;
}

/** One MCP-style image content block — the one block type this slice proves end to end.
 *  `mimeType`/`data` mirror MCP's own `ImageContent` field names deliberately, so a block copied
 *  verbatim out of an MCP tool result already matches this shape with no field renaming. */
export interface ToolResultImageBlock {
  readonly type: 'image';
  /** IANA media type, e.g. `"image/png"`. */
  readonly mimeType: string;
  /** Base64-encoded image bytes. */
  readonly data: string;
}

/** A tool result content block `media` may carry. Modeled on MCP's own content-block vocabulary —
 *  see this module's doc for why that vocabulary is reused rather than a fourth one invented. */
export type ToolResultMediaBlock = ToolResultTextBlock | ToolResultImageBlock;

export interface ExtractResultMedia {
  /**
   * `output` with every recognized image block removed from its `content` array. Identical
   * reference to the input when nothing was extracted (not an envelope, no `content` array, or no
   * well-formed `image` blocks) — mirrors `tool-result-surfaces.ts`'s `SplitToolResultSurfaces`
   * same-reference contract for the common no-op case.
   */
  readonly remainder: unknown;
  /** Recognized image blocks, in arrival order. Empty when nothing was extracted. */
  readonly media: readonly ToolResultMediaBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows one loosely-typed content-array entry to a well-formed {@link ToolResultImageBlock}, or
 *  `undefined` for anything else (wrong `type`, or a `type: 'image'` block missing/mistyping
 *  `mimeType`/`data`). */
function asImageBlock(block: unknown): ToolResultImageBlock | undefined {
  if (!isRecord(block) || block['type'] !== 'image') return undefined;
  const { mimeType, data } = block;
  if (typeof mimeType !== 'string' || typeof data !== 'string') return undefined;
  return { type: 'image', mimeType, data };
}

/**
 * Splits a tool handler's raw return value into its recognized media blocks and the remainder,
 * ready to feed onward into `splitToolResultSurfaces` (see this module's doc for why that order
 * matters).
 *
 * @param output - A tool handler's raw return value (`ToolExecutionResult.output` when
 * `status === 'completed'`). Non-envelope values (the overwhelming majority of tools, which return
 * plain JSON) pass through untouched with no media.
 * @complexity O(n) in the number of content blocks.
 */
export function extractResultMedia(output: unknown): ExtractResultMedia {
  if (!isRecord(output)) return { remainder: output, media: [] };
  const content = output['content'];
  if (!Array.isArray(content)) return { remainder: output, media: [] };

  const media: ToolResultMediaBlock[] = [];
  const kept: unknown[] = [];
  for (const entry of content) {
    const image = asImageBlock(entry);
    if (image) media.push(image);
    else kept.push(entry);
  }

  if (media.length === 0) return { remainder: output, media: [] };
  return { remainder: { ...output, content: kept }, media };
}
