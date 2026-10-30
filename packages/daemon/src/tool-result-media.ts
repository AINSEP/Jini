import { batchOutcomeFor } from '@jini-ai/core';
import type { ToolExecutionResult } from './tool-executor.js';

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
 * The surface whitelist runs on the original output first. Its model-visible result still
 * contains images for MCP/model delivery. Only the event projection below serializes this
 * module's de-imaged remainder, alongside one `media` array for rendering.
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
 * without modifying the model-facing output. Run the surface whitelist on the original first.
 *
 * @param output - A tool handler's raw return value (`ToolExecutionResult.output` when
 * `status === 'completed'`). Non-envelope values (the overwhelming majority of tools, which return
 * plain JSON) pass through untouched with no media.
 * @complexity O(n) in the number of content blocks.
 */
export function extractResultMedia({ output }: { readonly output: unknown }): ExtractResultMedia {
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

/** Converts arbitrary registered-tool output into the string-bearing run protocol. */
export function serializeDelegatedToolOutput({ output }: { readonly output: unknown }): string {
  if (typeof output === 'string') return output;
  if (output === undefined) return '';
  try {
    const serialized = JSON.stringify(output);
    return serialized === undefined ? String(output) : serialized;
  } catch {
    return String(output);
  }
}

/**
 * Maps a `ToolExecutionResult`'s status to the string a delegated-tool caller (this bridge, or
 * gap 3's stdin-tool-result injector in `agent-executor.ts`) reports back as the tool's visible
 * output/failure reason. Exported so both real callers share one mapping rather than drifting.
 */
export function resultContent({ result }: { readonly result: ToolExecutionResult }): string {
  switch (result.status) {
    case 'completed':
      return serializeDelegatedToolOutput({ output: result.output });
    case 'denied':
      return 'Tool execution denied by policy.';
    case 'confirmation-denied':
      return 'Tool execution denied during confirmation.';
    case 'timed-out':
      return 'Tool execution timed out.';
    case 'cancelled':
      return 'Tool execution cancelled.';
    case 'failed':
      return result.error ?? 'Tool execution failed.';
    default: {
      // Unreachable: every tool result status has a case above, and a new one fails typecheck here.
      const unhandled: never = result.status;
      throw new TypeError(`Unhandled tool result status: ${String(unhandled)}`);
    }
  }
}

/** Projects a model-safe result into the saved event: pixels occur only in `media`.
 * Uses the existing serializer and status mapping; callers keep the original for the model.
 * @complexity O(n) output bytes, with O(n) transient serialization space. */
export function projectToolResultEvent({ result }: { result: ToolExecutionResult }, _options = {}): { content: string; isError?: true; media?: readonly ToolResultMediaBlock[] } {
  const { remainder, media } = extractResultMedia({ output: result.output });
  const outputFlagsError = isRecord(result.output) && result.output.isError === true;
  const isError = result.status !== 'completed'
    || (batchOutcomeFor({ output: result.output }) ?? 'completed') !== 'completed'
    || outputFlagsError;
  return {
    content: resultContent({ result: { ...result, output: remainder } }),
    ...(isError ? { isError: true } : {}),
    ...(media.length > 0 ? { media } : {}),
  };
}
